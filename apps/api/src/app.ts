import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DIRECTORY_CHECKED_AT, universityDirectory, type RuntimeConfig } from '@first30/config';
import type { DatabaseConnection } from '@first30/database';
import { users, webhookInbox } from '@first30/database';
import {
  AppError,
  ApplicationWorker,
  createSessionToken,
  MaxAuthExchangeService,
  readBearerToken,
  RouteService,
  type SessionIdentity,
  verifySessionToken,
} from '@first30/application';
import { createLlmAdapter, isValidIsoDate, supportedLanguages } from '@first30/domain';
import {
  constantTimeSecretEqual,
  createShareLink,
  normalizeMaxUpdate,
  parseJsonLossless,
  RealMaxClient,
  validateMaxInitData,
} from '@first30/max-adapter';

import {
  authResponseSchema,
  nextActionResponseSchema,
  onboardingResponseSchema,
  profileResponseSchema,
  profileUpdateResponseSchema,
  reminderConsentResponseSchema,
  reminderCreatedResponseSchema,
  reminderListResponseSchema,
  responseSchemas,
  routeEnvelopeSchema,
  stepResponseSchema,
} from './response-schemas.js';

declare module 'fastify' {
  interface FastifyRequest {
    identity: SessionIdentity | null;
  }
}

export interface BuildAppOptions {
  config: RuntimeConfig;
  database: DatabaseConnection;
  logger?: boolean;
  closeDatabaseOnClose?: boolean;
}

const onboardingSchema = z.object({
  preferredLanguage: z.enum(supportedLanguages),
  universityCode: z
    .enum(['MSU', 'MEPHI', 'MIPT', 'HSE', 'NSU', 'SPBU', 'TSU', 'ITMO', 'KFU', 'RUDN', 'OTHER'])
    .default('ITMO'),
  universityName: z.string().trim().min(2).max(120).nullable().optional(),
  campusCode: z.string().min(1).max(32).optional(),
  facultyCode: z.enum(['msu_econ', 'msu_soil', 'tsu_law', 'other', 'unknown']).nullable().optional(),
  citizenshipType: z.enum(['rf', 'foreign', 'unknown']).optional(),
  citizenshipCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  entryMode: z.enum(['visa', 'visa_free', 'already_in_russia', 'unknown']).optional(),
  russiaPresence: z.enum(['yes', 'no', 'unknown']).optional(),
  studyArrival: z.enum(['yes', 'no', 'unknown']).optional(),
  russiaEntryDate: z.string().refine(isValidIsoDate, 'Invalid calendar date').nullable().optional(),
  programLevel: z.enum(['bachelor_specialist', 'masters', 'postgraduate', 'unknown']).optional(),
  mobilityStatus: z.enum(['local', 'moving', 'moved', 'unknown']).optional(),
  enrollmentState: z.enum(['admitted', 'awaiting_order', 'arrived']).optional(),
  admissionYear: z.number().int().min(2020).max(2100).nullable().optional(),
  housingStatus: z.enum(['confirmed', 'applied', 'private', 'relatives', 'unknown']).optional(),
  militaryStatus: z.enum(['yes', 'no', 'unknown', 'decline']).optional(),
  arrivalStatus: z.enum(['preparing', 'arrived']),
  arrivalDate: z.string().refine(isValidIsoDate, 'Invalid calendar date').nullable(),
  accommodationType: z.enum(['dormitory', 'private', 'relatives', 'unknown']),
  confirmRestart: z.boolean().optional().default(false),
});

const maxWebhookUpdateSchema = z.record(z.string(), z.unknown()).superRefine((raw, context) => {
  const normalized = normalizeMaxUpdate(raw);
  const supportedTypes = new Set(['bot_started', 'bot_stopped', 'message_created', 'message_callback']);
  if (!supportedTypes.has(normalized.type)) {
    context.addIssue({ code: 'custom', message: 'Unsupported or missing MAX update_type' });
  }
  if (!normalized.userId) {
    context.addIssue({ code: 'custom', message: 'MAX update has no valid user id' });
  }
  if (normalized.type === 'message_created' && !normalized.providerKey.startsWith('message:')) {
    context.addIssue({ code: 'custom', message: 'MAX message update has no message id' });
  }
  if (normalized.type === 'message_callback' && !normalized.callbackId) {
    context.addIssue({ code: 'custom', message: 'MAX callback update has no callback id' });
  }
});

const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message', 'requestId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    requestId: { type: 'string' },
  },
} as const;

const onboardingRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['preferredLanguage', 'arrivalStatus', 'arrivalDate', 'accommodationType'],
  properties: {
    preferredLanguage: { type: 'string', enum: [...supportedLanguages] },
    universityCode: {
      type: 'string',
      enum: [...universityDirectory.map((item) => item.code), 'OTHER'],
      default: 'ITMO',
    },
    universityName: { anyOf: [{ type: 'string', minLength: 2, maxLength: 120 }, { type: 'null' }] },
    campusCode: { type: 'string', minLength: 1, maxLength: 32 },
    facultyCode: {
      anyOf: [{ type: 'string', enum: ['msu_econ', 'msu_soil', 'tsu_law', 'other', 'unknown'] }, { type: 'null' }],
    },
    citizenshipType: { type: 'string', enum: ['rf', 'foreign', 'unknown'] },
    citizenshipCountry: { anyOf: [{ type: 'string', pattern: '^[A-Z]{2}$' }, { type: 'null' }] },
    entryMode: { type: 'string', enum: ['visa', 'visa_free', 'already_in_russia', 'unknown'] },
    russiaPresence: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    studyArrival: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    russiaEntryDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    programLevel: { type: 'string', enum: ['bachelor_specialist', 'masters', 'postgraduate', 'unknown'] },
    mobilityStatus: { type: 'string', enum: ['local', 'moving', 'moved', 'unknown'] },
    enrollmentState: { type: 'string', enum: ['admitted', 'awaiting_order', 'arrived'] },
    admissionYear: { anyOf: [{ type: 'integer', minimum: 2020, maximum: 2100 }, { type: 'null' }] },
    housingStatus: { type: 'string', enum: ['confirmed', 'applied', 'private', 'relatives', 'unknown'] },
    militaryStatus: { type: 'string', enum: ['yes', 'no', 'unknown', 'decline'] },
    arrivalStatus: { type: 'string', enum: ['preparing', 'arrived'] },
    arrivalDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    accommodationType: { type: 'string', enum: ['dormitory', 'private', 'relatives', 'unknown'] },
    confirmRestart: { type: 'boolean', default: false },
  },
} as const;

const genericObjectResponseSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

const idOrCodeParamsSchema = {
  type: 'object',
  required: ['idOrCode'],
  properties: {
    idOrCode: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'UUID или code шага из route.steps текущего пользователя.',
    },
  },
} as const;

const statusStepParamsSchema = {
  ...idOrCodeParamsSchema,
  properties: {
    idOrCode: {
      ...idOrCodeParamsSchema.properties.idOrCode,
      // The service treats identifiers containing a hyphen as PostgreSQL UUIDs.
      anyOf: [{ format: 'uuid' }, { pattern: '^[^-]+$' }],
    },
  },
} as const;

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new AppError(400, 'VALIDATION_ERROR', message);
  }
  return result.data;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, database } = options;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.x-max-bot-api-secret',
                'body.initData',
                '*.token',
                '*.hash',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    },
  });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, parseJsonLossless(typeof body === 'string' ? body : body.toString('utf8')));
    } catch {
      const error = new SyntaxError('Invalid JSON') as SyntaxError & { statusCode: number };
      error.statusCode = 400;
      done(error);
    }
  });
  app.decorateRequest('identity', null);
  app.addSchema({ $id: 'ErrorResponse', ...errorResponseSchema });
  app.addSchema({ $id: 'OnboardingRequest', ...onboardingRequestSchema });
  app.addSchema({ $id: 'RouteEnvelope', ...routeEnvelopeSchema });
  app.addSchema({ $id: 'AuthResponse', ...authResponseSchema });
  app.addSchema({ $id: 'EventCandidate', type: 'object', additionalProperties: true });
  for (const schema of responseSchemas) app.addSchema(schema);
  app.addSchema({ $id: 'GroundedAnswer', type: 'object', additionalProperties: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Max-Bot-Api-Secret'],
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Путь студента — программный интерфейс',
        description:
          'Личный план после зачисления для граждан России и иностранных студентов. Десять вузов представлены по открытым источникам без заявления о партнёрстве.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'session' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const llmAdapter = createLlmAdapter({
    provider: config.llmProvider,
    baseUrl: config.llmBaseUrl,
    apiKey: config.llmApiKey,
    projectId: config.llmProjectId,
    model: config.llmModel,
    timeoutMs: config.llmTimeoutMs,
    maxOutputTokens: config.llmMaxOutputTokens,
  });
  const routeService = new RouteService(database.db, llmAdapter);
  const maxAuthExchangeService = new MaxAuthExchangeService(database.db, config.sessionSecret);
  const devMode = (config.nodeEnv === 'development' || config.nodeEnv === 'test') && config.maxProvider === 'mock';
  const realMaxClient =
    config.maxProvider === 'real' && config.maxBotToken
      ? new RealMaxClient(config.maxApiBaseUrl, config.maxBotToken)
      : undefined;
  const worker = new ApplicationWorker(database.db, {
    maxProvider: config.maxProvider,
    miniAppUrl: config.miniAppPublicUrl,
    maxBotUsername: config.maxBotUsername,
    introVideoTokens: { ru: config.maxIntroVideoRuToken, en: config.maxIntroVideoEnToken },
    maxClient: realMaxClient,
    llmAdapter,
  });

  const authenticate = async (request: FastifyRequest, _reply: FastifyReply) => {
    const identity = verifySessionToken(readBearerToken(request.headers.authorization), config.sessionSecret);
    const [user] = await database.db
      .select({ maxUserId: users.maxUserId })
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1);
    if (!user || user.maxUserId !== identity.maxUserId) {
      throw new AppError(401, 'INVALID_SESSION', 'Сессия недействительна');
    }
    request.identity = identity;
  };
  const currentUserId = (request: FastifyRequest) => {
    if (!request.identity) throw new AppError(401, 'AUTH_REQUIRED', 'Требуется авторизация');
    return request.identity.userId;
  };

  app.setErrorHandler((error, request, reply) => {
    const frameworkError =
      error && typeof error === 'object' ? (error as { statusCode?: unknown; message?: unknown }) : {};
    const frameworkStatus = typeof frameworkError.statusCode === 'number' ? frameworkError.statusCode : undefined;
    const appError =
      error instanceof AppError
        ? error
        : frameworkStatus && frameworkStatus >= 400 && frameworkStatus < 500
          ? new AppError(frameworkStatus, 'VALIDATION_ERROR', 'Неверный запрос. Проверьте заполненные поля.')
          : new AppError(500, 'INTERNAL_ERROR', 'Внутренняя ошибка');
    if (!(error instanceof AppError) && (!frameworkStatus || frameworkStatus >= 500)) {
      // Database/provider exceptions may contain query parameters or credentials.
      request.log.error({ code: 'INTERNAL_ERROR' }, 'Unhandled request error');
    }
    void reply.status(appError.statusCode).send({
      code: appError.code,
      message: appError.message,
      requestId: request.id,
    });
  });

  app.get(
    '/health/live',
    { schema: { tags: ['health'], summary: 'Проверка работы', response: { 200: genericObjectResponseSchema } } },
    async () => ({ status: 'ok' }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Проверка готовности',
        response: { 200: genericObjectResponseSchema, 503: genericObjectResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        await database.pool.query('SELECT 1');
        return { status: 'ready', database: 'ok', maxProvider: config.maxProvider };
      } catch {
        return reply.status(503).send({ status: 'not_ready', database: 'unavailable' });
      }
    },
  );
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Общее состояние',
        response: { 200: genericObjectResponseSchema, 503: genericObjectResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        await database.pool.query('SELECT 1');
        return { status: 'ok' };
      } catch {
        return reply.status(503).send({ status: 'error' });
      }
    },
  );

  app.post(
    '/api/auth/dev',
    {
      schema: {
        tags: ['auth'],
        summary: 'Вход только для местной разработки',
        description: 'Доступен только при NODE_ENV=development/test и MAX_PROVIDER=mock. На production возвращает 404.',
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { devUserId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } },
        },
        response: {
          200: authResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      if (!devMode) throw new AppError(404, 'NOT_FOUND', 'Маршрут не найден');
      const body = validated(
        z.object({
          devUserId: z
            .string()
            .regex(/^[A-Za-z0-9_-]{1,64}$/)
            .default('dev-student-clean'),
        }),
        request.body ?? {},
      );
      const user = await routeService.ensureUser(body.devUserId, 'ru');
      return {
        token: createSessionToken({ userId: user.id, maxUserId: user.maxUserId }, config.sessionSecret),
        user: { id: user.id, maxUserId: user.maxUserId, preferredLanguage: user.preferredLanguage },
      };
    },
  );

  app.post(
    '/api/auth/max',
    {
      schema: {
        tags: ['auth'],
        summary: 'Проверить данные запуска MAX и создать сеанс',
        description:
          'Принимает подписанный initData из MAX WebApp. Полученный token передаётся как Authorization: Bearer <token>.',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['initData'],
          properties: { initData: { type: 'string', minLength: 1, maxLength: 16_384 } },
        },
        response: {
          200: authResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = validated(z.object({ initData: z.string().min(1).max(16_384) }), request.body);
      if (!config.maxBotToken) throw new AppError(503, 'MAX_AUTH_NOT_CONFIGURED', 'MAX-авторизация не настроена');
      const validation = validateMaxInitData({
        initData: body.initData,
        botToken: config.maxBotToken,
        ttlSeconds: config.maxInitDataTtlSeconds,
      });
      if (!validation.ok)
        throw new AppError(401, `MAX_INIT_DATA_${validation.code}`, 'Данные запуска MAX недействительны или устарели');
      const user = await routeService.ensureUser(validation.identity.maxUserId, 'ru');
      return {
        token: await maxAuthExchangeService.exchange({
          fingerprint: validation.fingerprint,
          user,
          authDate: validation.identity.authDate,
          initDataTtlSeconds: config.maxInitDataTtlSeconds,
        }),
        user: { id: user.id, maxUserId: user.maxUserId, preferredLanguage: user.preferredLanguage },
      };
    },
  );

  app.get(
    '/api/profile',
    {
      preHandler: authenticate,
      schema: {
        tags: ['profile'],
        security: [{ bearerAuth: [] }],
        response: {
          200: profileResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => routeService.getPublicProfile(currentUserId(request)),
  );
  app.get(
    '/api/universities',
    {
      schema: {
        tags: ['directory'],
        summary: 'Справочник вузов по открытым источникам',
        response: { 200: genericObjectResponseSchema },
      },
    },
    async () => ({
      sourceCheckedAt: DIRECTORY_CHECKED_AT,
      universities: universityDirectory.map((entry) => ({
        code: entry.code,
        nameRu: entry.nameRu,
        nameEn: entry.nameEn,
        cityRu: entry.cityRu,
        campuses: entry.campuses,
        partnerStatus: entry.partnerStatus,
      })),
    }),
  );
  app.patch(
    '/api/profile',
    {
      preHandler: authenticate,
      schema: {
        tags: ['profile'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['preferredLanguage'],
          properties: { preferredLanguage: { type: 'string', enum: [...supportedLanguages] } },
        },
        response: {
          200: profileUpdateResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = validated(z.object({ preferredLanguage: z.enum(supportedLanguages) }).strict(), request.body);
      const user = await routeService.updateLanguage(currentUserId(request), body.preferredLanguage);
      return { user };
    },
  );
  app.post(
    '/api/onboarding',
    {
      preHandler: authenticate,
      schema: {
        tags: ['onboarding'],
        security: [{ bearerAuth: [] }],
        body: onboardingRequestSchema,
        response: {
          200: onboardingResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          422: errorResponseSchema,
          500: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = validated(onboardingSchema, request.body);
      return routeService.onboard(currentUserId(request), body, new Date(), body.confirmRestart);
    },
  );
  app.get(
    '/api/route',
    {
      preHandler: authenticate,
      schema: {
        tags: ['route'],
        security: [{ bearerAuth: [] }],
        response: {
          200: routeEnvelopeSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => ({
      route: await routeService.getRoute(currentUserId(request)),
    }),
  );
  app.get(
    '/api/route/steps/:idOrCode',
    {
      preHandler: authenticate,
      schema: {
        tags: ['route'],
        params: idOrCodeParamsSchema,
        security: [{ bearerAuth: [] }],
        response: {
          200: stepResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const params = validated(z.object({ idOrCode: z.string().min(1).max(128) }), request.params);
      return { step: await routeService.getStep(currentUserId(request), params.idOrCode) };
    },
  );
  app.patch(
    '/api/route/steps/:code/context',
    {
      preHandler: authenticate,
      schema: {
        tags: ['route'],
        params: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1, maxLength: 128 } },
        },
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['facts', 'dates'],
          properties: {
            facts: {
              type: 'object',
              maxProperties: 100,
              additionalProperties: {
                anyOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
              },
            },
            dates: {
              type: 'object',
              maxProperties: 30,
              additionalProperties: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
            },
          },
        },
        response: {
          200: routeEnvelopeSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          422: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { code } = validated(z.object({ code: z.string().min(1).max(128) }), request.params);
      const input = validated(
        z.object({
          facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          dates: z.record(z.string(), z.string().nullable()),
        }),
        request.body,
      );
      return routeService.updateKnowledgeContext(currentUserId(request), code, input);
    },
  );
  app.patch(
    '/api/route/steps/:idOrCode/status',
    {
      preHandler: authenticate,
      schema: {
        tags: ['route'],
        params: statusStepParamsSchema,
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'string', enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] } },
        },
        response: {
          200: routeEnvelopeSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const params = validated(z.object({ idOrCode: z.string().min(1).max(128) }), request.params);
      const body = validated(z.object({ status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']) }), request.body);
      return { route: await routeService.setStepStatus(currentUserId(request), params.idOrCode, body.status) };
    },
  );
  app.get(
    '/api/next-action',
    {
      preHandler: authenticate,
      schema: {
        tags: ['route'],
        security: [{ bearerAuth: [] }],
        response: {
          200: nextActionResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const route = await routeService.getRoute(currentUserId(request));
      return { nextAction: route.nextAction, progress: route.progress };
    },
  );

  app.post(
    '/api/events/candidates',
    {
      preHandler: authenticate,
      schema: {
        tags: ['events'],
        security: [{ bearerAuth: [] }],
        body: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'arrivalDate'],
              properties: {
                type: { type: 'string', const: 'ARRIVAL_CONFIRMED' },
                arrivalDate: { type: 'string', format: 'date' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['accommodationType'],
              properties: {
                type: { type: 'string', const: 'ACCOMMODATION_CHANGED' },
                accommodationType: { type: 'string', enum: ['dormitory', 'private', 'relatives'] },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['text'],
              properties: {
                type: { type: 'string', const: 'ACCOMMODATION_CHANGED' },
                text: { type: 'string', minLength: 1, maxLength: 500 },
              },
            },
          ],
        },
        response: { 200: genericObjectResponseSchema, 400: errorResponseSchema, 422: errorResponseSchema },
      },
    },
    async (request) => {
      const body = validated(
        z.union([
          z.object({ type: z.literal('ARRIVAL_CONFIRMED'), arrivalDate: z.string() }).strict(),
          z
            .object({
              type: z.literal('ACCOMMODATION_CHANGED').optional(),
              accommodationType: z.enum(['dormitory', 'private', 'relatives']),
            })
            .strict(),
          z.object({ type: z.literal('ACCOMMODATION_CHANGED').optional(), text: z.string().min(1).max(500) }).strict(),
        ]),
        request.body,
      );
      if (body.type === 'ARRIVAL_CONFIRMED') {
        return {
          candidate: await routeService.createArrivalEventCandidate(currentUserId(request), body.arrivalDate),
        };
      }
      let accommodationType = 'accommodationType' in body ? body.accommodationType : undefined;
      if (!accommodationType && 'text' in body) {
        const extracted = await llmAdapter.extractEventCandidate({ text: body.text, language: 'ru' });
        if (extracted.status === 'supported') accommodationType = extracted.payload.accommodationType;
      }
      if (!accommodationType)
        throw new AppError(422, 'UNSUPPORTED_EVENT', 'Поддерживается только изменение типа проживания');
      return { candidate: await routeService.createEventCandidate(currentUserId(request), accommodationType) };
    },
  );
  app.post(
    '/api/events/confirm',
    {
      preHandler: authenticate,
      schema: {
        tags: ['events'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['candidateId'],
          properties: { candidateId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: routeEnvelopeSchema, 404: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request) => {
      const body = validated(z.object({ candidateId: z.uuid() }).strict(), request.body);
      return routeService.confirmEventCandidate(currentUserId(request), body.candidateId);
    },
  );
  app.post(
    '/api/events/candidates/:candidateId/cancel',
    {
      preHandler: authenticate,
      schema: {
        tags: ['events'],
        security: [{ bearerAuth: [] }],
        response: { 200: genericObjectResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request) => {
      const params = validated(z.object({ candidateId: z.uuid() }), request.params);
      return { candidate: await routeService.cancelEventCandidate(currentUserId(request), params.candidateId) };
    },
  );

  app.post(
    '/api/reminders/opt-in',
    {
      preHandler: authenticate,
      schema: {
        tags: ['reminders'],
        security: [{ bearerAuth: [] }],
        response: {
          200: reminderConsentResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => routeService.setReminderConsent(currentUserId(request), true),
  );
  app.post(
    '/api/reminders/opt-out',
    {
      preHandler: authenticate,
      schema: {
        tags: ['reminders'],
        security: [{ bearerAuth: [] }],
        response: {
          200: reminderConsentResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => routeService.setReminderConsent(currentUserId(request), false),
  );
  app.get(
    '/api/reminders',
    {
      preHandler: authenticate,
      schema: {
        tags: ['reminders'],
        security: [{ bearerAuth: [] }],
        response: { 200: reminderListResponseSchema, 401: errorResponseSchema, 500: errorResponseSchema },
      },
    },
    async (request) => ({ reminders: await routeService.listReminders(currentUserId(request)) }),
  );
  app.patch(
    '/api/reminders/:code',
    {
      preHandler: authenticate,
      schema: {
        tags: ['reminders'],
        params: {
          type: 'object',
          required: ['code'],
          properties: {
            code: {
              type: 'string',
              pattern: '^[A-Z0-9_]{1,80}$',
              description: 'code активного незавершённого шага из route.steps.',
            },
          },
        },
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['mode'],
          properties: { mode: { type: 'string', enum: ['off', 'automatic'] } },
        },
        response: {
          200: reminderListResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { code } = validated(z.object({ code: z.string().regex(/^[A-Z0-9_]{1,80}$/) }), request.params);
      const { mode } = validated(z.object({ mode: z.enum(['off', 'automatic']) }), request.body);
      return routeService.configureReminder(currentUserId(request), code, mode);
    },
  );
  app.post(
    '/api/reminders',
    {
      preHandler: authenticate,
      schema: {
        tags: ['reminders'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['stepCode'],
          properties: {
            stepCode: { type: 'string', pattern: '^[A-Z0-9_]{1,80}$' },
            scheduledFor: { type: 'string', format: 'date-time' },
            demoInSeconds: {
              type: 'integer',
              minimum: 1,
              maximum: 7200,
              description: 'Доступно только при местной разработке с имитацией отправки сообщений.',
            },
          },
          oneOf: [{ required: ['scheduledFor'] }, { required: ['demoInSeconds'] }],
        },
        response: {
          200: reminderCreatedResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = validated(
        z
          .object({
            stepCode: z.string().regex(/^[A-Z0-9_]{1,80}$/),
            scheduledFor: z.iso.datetime().optional(),
            demoInSeconds: z.number().int().min(1).max(7200).optional(),
          })
          .refine((value) => Boolean(value.scheduledFor) !== Boolean(value.demoInSeconds)),
        request.body,
      );
      if (body.demoInSeconds && !devMode) throw new AppError(404, 'NOT_FOUND', 'Маршрут не найден');
      const scheduledFor = body.scheduledFor
        ? new Date(body.scheduledFor)
        : new Date(Date.now() + (body.demoInSeconds ?? 60) * 1000);
      return { reminder: await routeService.createReminder(currentUserId(request), body.stepCode, scheduledFor) };
    },
  );

  app.post(
    '/api/knowledge/query',
    {
      preHandler: authenticate,
      schema: {
        tags: ['knowledge'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['question'],
          properties: {
            question: { type: 'string', minLength: 2, maxLength: 1000 },
            previousAnswer: { type: 'string', maxLength: 700 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['answer'],
            properties: { answer: { type: 'object', additionalProperties: true } },
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = validated(
        z.object({ question: z.string().min(2).max(1000), previousAnswer: z.string().max(700).optional() }).strict(),
        request.body,
      );
      return { answer: await routeService.answerKnowledge(currentUserId(request), body.question, body.previousAnswer) };
    },
  );
  app.post(
    '/api/feedback',
    {
      preHandler: authenticate,
      schema: {
        tags: ['knowledge'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            queryId: { type: 'string', maxLength: 128 },
            type: { type: 'string', enum: ['HELPFUL', 'NOT_FOUND', 'OUTDATED'] },
            comment: { type: 'string', maxLength: 1000 },
          },
        },
        response: { 200: genericObjectResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request) => {
      const body = validated(
        z.object({
          queryId: z.string().max(128).optional(),
          type: z.enum(['HELPFUL', 'NOT_FOUND', 'OUTDATED']),
          comment: z.string().max(1000).optional(),
        }),
        request.body,
      );
      return { feedback: await routeService.saveFeedback(currentUserId(request), body) };
    },
  );
  app.get(
    '/api/share',
    {
      preHandler: authenticate,
      schema: {
        tags: ['route'],
        security: [{ bearerAuth: [] }],
        response: { 200: genericObjectResponseSchema },
      },
    },
    async (request) => {
      const route = await routeService.getRoute(currentUserId(request));
      const text =
        `Путь студента: ${route.progress.completed}/${route.progress.total}. ${route.nextAction?.title ?? ''}`.trim();
      return { text, url: createShareLink(text) };
    },
  );
  app.get('/api/legal', { schema: { tags: ['legal'], response: { 200: genericObjectResponseSchema } } }, async () => ({
    privacy:
      '«Путь студента» — учебный проект. Для работы маршрута обрабатываются данные анкеты и сведения о выполненных шагах. Сведения об операторе и условия обработки данных ещё требуют утверждения владельцем проекта.',
    terms: 'Приложение не заменяет официальную информацию и личную консультацию.',
    support:
      'Адрес службы поддержки «Пути студента» ещё не указан владельцем проекта. Университет не является службой поддержки этого приложения.',
  }));

  app.post(
    '/webhooks/max',
    {
      schema: {
        tags: ['MAX'],
        summary: 'Приём уведомлений MAX',
        body: { type: 'object', additionalProperties: true },
        response: {
          200: genericObjectResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          415: errorResponseSchema,
        },
      },
    },
    async (request) => {
      if (config.maxProvider !== 'real' || config.maxUpdateMode !== 'webhook' || !config.maxWebhookSecret) {
        throw new AppError(404, 'NOT_FOUND', 'Маршрут не найден');
      }
      if (!request.headers['content-type']?.startsWith('application/json')) {
        throw new AppError(415, 'CONTENT_TYPE_REQUIRED', 'Отправьте данные в формате JSON');
      }
      const providedSecret = request.headers['x-max-bot-api-secret'];
      if (
        !constantTimeSecretEqual(
          typeof providedSecret === 'string' ? providedSecret : undefined,
          config.maxWebhookSecret,
        )
      ) {
        throw new AppError(401, 'INVALID_WEBHOOK_SECRET', 'Неверная подпись уведомления MAX');
      }
      const raw = validated(maxWebhookUpdateSchema, request.body);
      const normalized = normalizeMaxUpdate(raw);
      const inserted = await database.db
        .insert(webhookInbox)
        .values({ providerUpdateKey: normalized.providerKey, payload: raw })
        .onConflictDoNothing()
        .returning({ id: webhookInbox.id });
      return { ok: true, duplicate: inserted.length === 0 };
    },
  );

  if (devMode) {
    app.post(
      '/api/dev/max/updates',
      {
        preHandler: authenticate,
        schema: {
          tags: ['dev'],
          security: [{ bearerAuth: [] }],
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['bot_started', 'message_created', 'message_callback'] },
              text: { type: 'string', maxLength: 4000 },
              callbackPayload: { type: 'string', maxLength: 128 },
            },
          },
          response: { 200: genericObjectResponseSchema, 400: errorResponseSchema },
        },
      },
      async (request) => {
        const body = validated(
          z.object({
            type: z.enum(['bot_started', 'message_created', 'message_callback']),
            text: z.string().max(4000).optional(),
            callbackPayload: z.string().max(128).optional(),
          }),
          request.body,
        );
        const identity = request.identity!;
        const eventId = randomUUID();
        const raw: Record<string, unknown> =
          body.type === 'bot_started'
            ? { update_type: 'bot_started', user: { user_id: identity.maxUserId } }
            : body.type === 'message_callback'
              ? {
                  update_type: 'message_callback',
                  callback: {
                    callback_id: `dev-${eventId}`,
                    payload: body.callbackPayload ?? '',
                    user: { user_id: identity.maxUserId },
                  },
                }
              : {
                  update_type: 'message_created',
                  message: {
                    sender: { user_id: identity.maxUserId },
                    body: { mid: `dev-${eventId}`, text: body.text ?? '' },
                  },
                };
        const normalized = normalizeMaxUpdate(raw);
        const [saved] = await database.db
          .insert(webhookInbox)
          .values({ providerUpdateKey: normalized.providerKey, payload: raw })
          .onConflictDoNothing()
          .returning();
        return { accepted: Boolean(saved), providerUpdateKey: normalized.providerKey };
      },
    );
    app.get(
      '/api/dev/max/inbox',
      {
        preHandler: authenticate,
        schema: {
          tags: ['dev'],
          security: [{ bearerAuth: [] }],
          response: { 200: genericObjectResponseSchema },
        },
      },
      async (request) => {
        const identity = request.identity!;
        const items = await database.db.select().from(webhookInbox).orderBy(desc(webhookInbox.receivedAt)).limit(100);
        return {
          items: items.filter((item) => normalizeMaxUpdate(item.payload).userId === identity.maxUserId),
        };
      },
    );
    app.get(
      '/api/dev/max/deliveries',
      {
        preHandler: authenticate,
        schema: {
          tags: ['dev'],
          security: [{ bearerAuth: [] }],
          response: { 200: genericObjectResponseSchema },
        },
      },
      async (request) => ({
        items: await routeService.listMockDeliveries(currentUserId(request)),
      }),
    );
    app.post(
      '/api/dev/worker/tick',
      {
        preHandler: authenticate,
        schema: {
          tags: ['dev'],
          security: [{ bearerAuth: [] }],
          response: { 200: genericObjectResponseSchema },
        },
      },
      async () => worker.tick(),
    );
    app.delete(
      '/api/dev/users/me',
      {
        preHandler: authenticate,
        schema: {
          tags: ['dev'],
          security: [{ bearerAuth: [] }],
          response: { 200: genericObjectResponseSchema },
        },
      },
      async (request) => {
        const [deleted] = await database.db
          .delete(users)
          .where(eq(users.id, currentUserId(request)))
          .returning({ id: users.id });
        return { deleted: Boolean(deleted) };
      },
    );
  }

  if (options.closeDatabaseOnClose !== false) app.addHook('onClose', async () => database.close());
  return app;
}

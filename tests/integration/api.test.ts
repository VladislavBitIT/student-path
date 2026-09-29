import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig, type RuntimeConfig } from '@first30/config';
import { MockLlmAdapter } from '@first30/domain';
import { t } from '@first30/i18n';
import {
  createDatabase,
  conversationStates,
  eventCandidates,
  events,
  feedback,
  knowledgeDocuments,
  maxAuthExchanges,
  mockDeliveries,
  outbox,
  reminders,
  stepDefinitions,
  userProfiles,
  userSteps,
  webhookInbox,
  type DatabaseConnection,
} from '@first30/database';
import { ApplicationWorker, BotUpdateHandler, RouteService } from '@first30/application';
import { computeMaxInitDataHash, MaxTransportError, normalizeMaxUpdate, parseJsonLossless } from '@first30/max-adapter';
import { buildApp } from '../../apps/api/src/app.js';
import { runMigrations } from '../../apps/api/src/migrate.js';
import { runSeed } from '../../apps/api/src/seed.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required; integration tests must never be silently skipped');
}

function json<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

describe('P0/P1 PostgreSQL integration', () => {
  let connection: DatabaseConnection;
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let worker: ApplicationWorker;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    await runSeed(databaseUrl);
    await runSeed(databaseUrl);
    config = loadRuntimeConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      APP_BASE_URL: 'http://localhost:3000',
      MINIAPP_PUBLIC_URL: 'http://localhost:4173',
      ALLOWED_ORIGINS: 'http://localhost:4173',
      SESSION_SECRET: 'integration-test-session-secret-value-123456',
      MAX_PROVIDER: 'mock',
      MAX_UPDATE_MODE: 'mock',
      LLM_PROVIDER: 'none',
    });
    connection = createDatabase(databaseUrl!);
    app = await buildApp({ config, database: connection, logger: false, closeDatabaseOnClose: false });
    await app.ready();
    worker = new ApplicationWorker(connection.db, {
      maxProvider: 'mock',
      miniAppUrl: config.miniAppPublicUrl,
      batchSize: 500,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await connection?.close();
  });

  async function inject<T>(options: InjectOptions, expectedStatus = 200): Promise<T> {
    const response = await app.inject(options);
    expect(response.statusCode, response.body).toBe(expectedStatus);
    return json<T>(response);
  }

  async function auth(devUserId: string) {
    return inject<{ token: string; user: { id: string; maxUserId: string; preferredLanguage: string } }>({
      method: 'POST',
      url: '/api/auth/dev',
      payload: { devUserId },
    });
  }

  it('serves honest Russian legal information without presenting ITMO as product support', async () => {
    const legal = await inject<{ privacy: string; terms: string; support: string }>({
      method: 'GET',
      url: '/api/legal',
    });
    expect(legal.privacy).toContain('требуют утверждения владельцем');
    expect(legal.privacy).toContain('«Путь студента»');
    expect(legal.privacy).not.toContain('StudyWay');
    expect(legal.privacy).not.toContain('demo');
    expect(legal.support).not.toContain('int.students@');
    expect(legal.support).toContain('не указан');
    const invalid = await inject<{ message: string }>(
      { method: 'POST', url: '/api/auth/dev', headers: { 'content-type': 'application/json' }, payload: '{' },
      400,
    );
    expect(invalid.message).toMatch(/[А-Яа-я]/);
  });

  async function onboard(token: string, accommodationType: 'dormitory' | 'private' = 'dormitory') {
    return inject<{
      route: {
        id: string;
        version: number;
        progress: { completed: number; total: number; percent: number };
        nextAction: { code: string } | null;
        steps: Array<{ id: string; code: string; status: string; source: { url: string } | null }>;
      };
    }>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferredLanguage: 'en',
        universityCode: 'ITMO',
        arrivalStatus: 'preparing',
        arrivalDate: '2026-09-25',
        accommodationType,
      },
    });
  }

  it('reports liveness and readiness against PostgreSQL', async () => {
    expect((await inject<{ status: string }>({ method: 'GET', url: '/health/live' })).status).toBe('ok');
    expect((await inject<{ status: string }>({ method: 'GET', url: '/health/ready' })).status).toBe('ready');
    const invalid = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { devUserId: 'bad id!' } });
    expect(invalid.statusCode).toBe(400);
    expect(json<{ code: string; requestId: string }>(invalid)).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(json<{ code: string; requestId: string }>(invalid).requestId).toBeTruthy();
  });

  it('preserves the complete service DTOs through documented Fastify response serialization', async () => {
    const user = await auth(`serialization-${randomUUID().slice(0, 8)}`);
    const headers = { authorization: `Bearer ${user.token}` };
    const service = new RouteService(connection.db);
    const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
    expect(await inject({ method: 'GET', url: '/api/profile', headers })).toEqual(
      jsonValue(await service.getPublicProfile(user.user.id)),
    );
    const created = await inject<{ route: Awaited<ReturnType<RouteService['getRoute']>> }>({
      method: 'POST',
      url: '/api/onboarding',
      headers,
      payload: {
        preferredLanguage: 'en',
        universityCode: 'SPBU',
        campusCode: 'main',
        citizenshipType: 'foreign',
        entryMode: 'visa',
        russiaPresence: 'no',
        mobilityStatus: 'moving',
        enrollmentState: 'admitted',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'private',
      },
    });
    expect(created).toHaveProperty('diff.hasMeaningfulChanges');
    const expectedRoute = await service.getRoute(user.user.id);
    expect(created.route).toEqual(jsonValue(expectedRoute));
    expect(expectedRoute.steps.some((step) => step.knowledge?.instructions.length)).toBe(true);
    expect(await inject({ method: 'GET', url: '/api/profile', headers })).toEqual(
      jsonValue(await service.getPublicProfile(user.user.id)),
    );
    expect(await inject({ method: 'GET', url: '/api/route', headers })).toEqual({ route: jsonValue(expectedRoute) });
    expect(await inject({ method: 'GET', url: '/api/next-action', headers })).toEqual({
      nextAction: jsonValue(expectedRoute.nextAction),
      progress: expectedRoute.progress,
    });
    const step = expectedRoute.steps.find((item) => item.knowledge)!;
    expect(await inject({ method: 'GET', url: `/api/route/steps/${step.id}`, headers })).toEqual({
      step: jsonValue(step),
    });
    const changed = await inject({
      method: 'PATCH',
      url: `/api/route/steps/${step.code}/status`,
      headers,
      payload: { status: 'IN_PROGRESS' },
    });
    expect(changed).toEqual({ route: jsonValue(await service.getRoute(user.user.id)) });
    expect(await inject({ method: 'POST', url: '/api/reminders/opt-in', headers })).toEqual({ remindersEnabled: true });
    const scheduledFor = new Date(Date.now() + 86_400_000).toISOString();
    const saved = await inject<{ reminder: { id: string } }>({
      method: 'POST',
      url: '/api/reminders',
      headers,
      payload: { stepCode: step.code, scheduledFor },
    });
    const [stored] = await connection.db.select().from(reminders).where(eq(reminders.id, saved.reminder.id));
    expect(saved).toEqual({ reminder: jsonValue(stored) });
    expect(await inject({ method: 'GET', url: '/api/reminders', headers })).toEqual({
      reminders: jsonValue(await service.listReminders(user.user.id)),
    });
    expect(await inject({ method: 'GET', url: '/api/profile', headers })).toEqual(
      jsonValue(await service.getPublicProfile(user.user.id)),
    );
    const disabled = await inject({
      method: 'PATCH',
      url: `/api/reminders/${step.code}`,
      headers,
      payload: { mode: 'off' },
    });
    expect(disabled).toEqual({ reminders: jsonValue(await service.listReminders(user.user.id)) });
    const language = await inject({
      method: 'PATCH',
      url: '/api/profile',
      headers,
      payload: { preferredLanguage: 'ru' },
    });
    expect(language).toEqual({ user: jsonValue((await service.getProfile(user.user.id)).user) });
  });

  it('requires a session for every main-scenario protected method', async () => {
    const requests: InjectOptions[] = [
      { method: 'GET', url: '/api/profile' },
      { method: 'PATCH', url: '/api/profile', payload: { preferredLanguage: 'ru' } },
      {
        method: 'POST',
        url: '/api/onboarding',
        payload: {
          preferredLanguage: 'ru',
          arrivalStatus: 'preparing',
          arrivalDate: null,
          accommodationType: 'unknown',
        },
      },
      { method: 'GET', url: '/api/route' },
      { method: 'GET', url: '/api/next-action' },
      { method: 'GET', url: '/api/route/steps/EXAMPLE_STEP' },
      { method: 'PATCH', url: '/api/route/steps/EXAMPLE_STEP/status', payload: { status: 'IN_PROGRESS' } },
      { method: 'PATCH', url: '/api/route/steps/EXAMPLE_STEP/context', payload: { facts: {}, dates: {} } },
      { method: 'GET', url: '/api/reminders' },
      { method: 'POST', url: '/api/reminders/opt-in' },
      { method: 'POST', url: '/api/reminders/opt-out' },
      {
        method: 'POST',
        url: '/api/reminders',
        payload: { stepCode: 'EXAMPLE_STEP', scheduledFor: new Date(Date.now() + 86_400_000).toISOString() },
      },
      { method: 'PATCH', url: '/api/reminders/EXAMPLE_STEP', payload: { mode: 'off' } },
    ];
    for (const request of requests) {
      expect(await inject(request, 401)).toMatchObject({
        code: 'AUTH_REQUIRED',
        message: expect.any(String),
        requestId: expect.any(String),
      });
    }
  });

  it('does not expose or mutate another profile through step IDs and reminder lists', async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await auth(`owner-${suffix}`);
    const other = await auth(`other-${suffix}`);
    const route = (await onboard(owner.token)).route;
    const otherRoute = (await onboard(other.token)).route;
    const ownerHeaders = { authorization: `Bearer ${owner.token}` };
    const otherHeaders = { authorization: `Bearer ${other.token}` };
    const step = route.steps[0]!;
    expect(otherRoute.id).not.toBe(route.id);
    expect(otherRoute.steps.some((item) => item.id === step.id)).toBe(false);
    for (const request of [
      { method: 'GET' as const, url: `/api/route/steps/${step.id}`, headers: otherHeaders },
      {
        method: 'PATCH' as const,
        url: `/api/route/steps/${step.id}/status`,
        headers: otherHeaders,
        payload: { status: 'COMPLETED' },
      },
    ])
      expect(await inject(request, 404)).toMatchObject({ code: 'STEP_NOT_FOUND' });
    const unchanged = await inject<{ route: typeof route }>({
      method: 'GET',
      url: '/api/route',
      headers: ownerHeaders,
    });
    expect(unchanged.route.progress.completed).toBe(0);
    expect(await inject({ method: 'GET', url: '/api/profile', headers: otherHeaders })).toMatchObject({
      user: { id: other.user.id },
      profile: { userId: other.user.id },
    });
    await inject({ method: 'POST', url: '/api/reminders/opt-in', headers: ownerHeaders });
    await inject({
      method: 'POST',
      url: '/api/reminders',
      headers: ownerHeaders,
      payload: { stepCode: step.code, scheduledFor: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(await inject({ method: 'GET', url: '/api/reminders', headers: otherHeaders })).toEqual({ reminders: [] });
  });

  it('returns a validation error for a malformed step UUID instead of a database error', async () => {
    const user = await auth(`invalid-step-${randomUUID().slice(0, 8)}`);
    await onboard(user.token);
    expect(
      await inject(
        {
          method: 'PATCH',
          url: '/api/route/steps/not-a-uuid/status',
          headers: { authorization: `Bearer ${user.token}` },
          payload: { status: 'IN_PROGRESS' },
        },
        400,
      ),
    ).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) });
  });

  it('invalidates the old mini-app session after /reset while allowing a fresh start', async () => {
    const maxUserId = `reset-session-${randomUUID().slice(0, 8)}`;
    const before = await auth(maxUserId);
    await inject({
      method: 'POST',
      url: '/api/dev/max/updates',
      headers: { authorization: `Bearer ${before.token}` },
      payload: { type: 'message_created', text: '/reset' },
    });
    await worker.processInbox();
    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${before.token}` },
    });
    expect(oldSession.statusCode).toBe(401);
    expect(json<{ code: string }>(oldSession).code).toBe('INVALID_SESSION');

    const after = await auth(maxUserId);
    expect(after.user.id).not.toBe(before.user.id);
    const profile = await inject<{ profile: unknown }>({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${after.token}` },
    });
    expect(profile.profile).toBeNull();
    await inject({
      method: 'POST',
      url: '/api/dev/max/updates',
      headers: { authorization: `Bearer ${after.token}` },
      payload: { type: 'message_created', text: '/start' },
    });
    await worker.processInbox();
    const state = await connection.db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.userId, after.user.id));
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ questionId: 'intro_language', completed: false, cancelled: false });
    const welcome = await connection.db.select().from(outbox).where(eq(outbox.recipient, maxUserId));
    expect(welcome.some((row) => JSON.stringify(row.payload).includes('intro_lang:ru'))).toBe(true);
  });

  it('builds isolated routes for all ten directory universities without invented deadlines or partner status', async () => {
    const directory = await inject<{
      sourceCheckedAt: string;
      universities: Array<{ code: string; partnerStatus: string; campuses: Array<{ code: string }> }>;
    }>({
      method: 'GET',
      url: '/api/universities',
    });
    expect(directory.sourceCheckedAt).toBe('2026-09-24');
    expect(directory.universities.map((entry) => entry.code)).toEqual([
      'MSU',
      'MEPHI',
      'MIPT',
      'HSE',
      'NSU',
      'SPBU',
      'TSU',
      'ITMO',
      'KFU',
      'RUDN',
    ]);
    for (const university of directory.universities) {
      expect(university.partnerStatus).toBe('directory_public');
      const user = await auth(`directory-${university.code.toLowerCase()}-${randomUUID().slice(0, 8)}`);
      const created = await inject<{
        route: {
          partnerStatus: string;
          steps: Array<{
            code: string;
            deadline: string | null;
            scope: string;
            source: { id: string; metadata?: { partnerStatus: string } } | null;
          }>;
        };
      }>({
        method: 'POST',
        url: '/api/onboarding',
        headers: { authorization: `Bearer ${user.token}` },
        payload: {
          preferredLanguage: 'ru',
          universityCode: university.code,
          campusCode: university.campuses[0]!.code,
          citizenshipType: 'rf',
          mobilityStatus: 'moving',
          militaryStatus: 'unknown',
          admissionYear: 2027,
          arrivalStatus: 'preparing',
          arrivalDate: null,
          accommodationType: 'dormitory',
          housingStatus: 'applied',
        },
      });
      expect(created.route.partnerStatus).toBe('directory_public');
      expect(created.route.steps.some((step) => step.scope === 'general')).toBe(true);
      expect(created.route.steps.some((step) => step.scope === 'university')).toBe(true);
      expect(created.route.steps.every((step) => step.deadline === null)).toBe(true);
      const otherPrefixes = directory.universities
        .filter((entry) => entry.code !== university.code)
        .map((entry) => `uni_${entry.code.toLowerCase()}_`);
      expect(
        created.route.steps.every(
          (step) => !step.source || !otherPrefixes.some((prefix) => step.source!.id.startsWith(prefix)),
        ),
      ).toBe(true);
      expect(
        created.route.steps.every((step) => !step.source || step.source.metadata?.partnerStatus === 'directory_public'),
      ).toBe(true);
      if (university.code === 'HSE' || university.code === 'KFU' || university.code === 'NSU') {
        expect(created.route.steps.some((step) => /_2026|2026_/.test(step.code))).toBe(false);
      }
      if (university.code === 'ITMO') {
        expect(created.route.steps.some((step) => step.code === 'CHECK_ENTRY_REQUIREMENTS')).toBe(false);
      }
    }
  });

  it('serves a sourced, situation-specific action for all ten universities', async () => {
    const cases = [
      ['MSU', 'MSU_FACULTY_BEFORE', 'preparing'],
      ['MEPHI', 'MEPHI_VISA_SUPPORT', 'preparing'],
      ['MIPT', 'MIPT_VISA_INVITATION', 'preparing'],
      ['HSE', 'HSE_MOSCOW_FOREIGN_INTAKE', 'preparing'],
      ['NSU', 'NSU_STUDENT_ACCOUNT', 'preparing'],
      ['SPBU', 'SPBU_NOTIFY_ENTRY', 'arrived'],
      ['TSU', 'TSU_FOREIGN_SUPPORT', 'preparing'],
      ['ITMO', 'CHECK_ENTRY_REQUIREMENTS', 'preparing'],
      ['KFU', 'KFU_PRIVATE_HOST', 'arrived'],
      ['RUDN', 'RUDN_PRIVATE_HODATAYSTVO', 'arrived'],
    ] as const;
    for (const [universityCode, code, arrivalStatus] of cases) {
      const user = await auth(`sourced-route-${universityCode.toLowerCase()}-${randomUUID().slice(0, 8)}`);
      const result = await inject<{
        route: {
          steps: Array<{ code: string; description: string; source: { url: string } | null; deadline: string | null }>;
        };
      }>({
        method: 'POST',
        url: '/api/onboarding',
        headers: { authorization: `Bearer ${user.token}` },
        payload: {
          preferredLanguage: 'ru',
          universityCode,
          campusCode: 'main',
          citizenshipType: 'foreign',
          entryMode: 'visa',
          russiaPresence: arrivalStatus === 'arrived' ? 'yes' : 'no',
          mobilityStatus: arrivalStatus === 'arrived' ? 'moved' : 'moving',
          enrollmentState: 'admitted',
          arrivalStatus,
          arrivalDate: null,
          accommodationType: 'private',
          admissionYear: 2026,
        },
      });
      const action = result.route.steps.find((step) => step.code === code);
      expect(action, universityCode).toBeDefined();
      expect(action?.description.length).toBeGreaterThan(70);
      expect(action?.source?.url).toMatch(/^https:\/\//);
      expect(action?.deadline).toBeNull();
      expect(result.route.steps.some((step) => step.code === 'CHECK_HOUSING_STATUS')).toBe(false);
    }
  });

  it.each(['kk', 'uz', 'tk', 'zh-CN', 'hi'] as const)(
    'persists the %s route and queues a reminder in the saved language',
    async (language) => {
      const devUserId = `localized-${language.replace('-', '')}-${randomUUID().slice(0, 8)}`;
      const user = await auth(devUserId);
      const created = await inject<{
        route: { steps: Array<{ code: string; title: string; description: string; source: { url: string } | null }> };
      }>({
        method: 'POST',
        url: '/api/onboarding',
        headers: { authorization: `Bearer ${user.token}` },
        payload: {
          preferredLanguage: language,
          universityCode: 'NSU',
          campusCode: 'main',
          citizenshipType: 'foreign',
          entryMode: 'visa',
          mobilityStatus: 'moving',
          enrollmentState: 'admitted',
          arrivalStatus: 'preparing',
          arrivalDate: null,
          accommodationType: 'private',
          admissionYear: 2026,
        },
      });
      const expectedTitle = t(language, 'steps.research.nsu_student_account.title');
      const action = created.route.steps.find((step) => step.code === 'NSU_STUDENT_ACCOUNT');
      expect(action?.title).toBe(expectedTitle);
      expect(action?.description).toBe(t(language, 'steps.research.nsu_student_account.description'));
      expect(action?.source?.url).toMatch(/^https:\/\//);

      const reentered = await auth(devUserId);
      const profile = await inject<{ user: { preferredLanguage: string } }>({
        method: 'GET',
        url: '/api/profile',
        headers: { authorization: `Bearer ${reentered.token}` },
      });
      expect(profile.user.preferredLanguage).toBe(language);
      const route = await inject<{ route: { steps: Array<{ code: string; title: string }> } }>({
        method: 'GET',
        url: '/api/route',
        headers: { authorization: `Bearer ${reentered.token}` },
      });
      expect(route.route.steps.find((step) => step.code === 'NSU_STUDENT_ACCOUNT')?.title).toBe(expectedTitle);

      await inject({
        method: 'POST',
        url: '/api/reminders/opt-in',
        headers: { authorization: `Bearer ${reentered.token}` },
        payload: {},
      });
      await inject({
        method: 'POST',
        url: '/api/reminders',
        headers: { authorization: `Bearer ${reentered.token}` },
        payload: { stepCode: 'NSU_STUDENT_ACCOUNT', demoInSeconds: 1 },
      });
      await worker.enqueueDueReminders(new Date(Date.now() + 2_000));
      const [message] = await connection.db
        .select({ payload: outbox.payload })
        .from(outbox)
        .where(and(eq(outbox.recipient, user.user.maxUserId), eq(outbox.sourceType, 'reminder')));
      expect((message?.payload as { text?: string })?.text).toBe(
        t(language, 'reminders.notification', { title: expectedTitle }),
      );
    },
  );

  it('puts the archive action in the regular route and preserves it on repeat entry', async () => {
    const devUserId = `archive-route-${randomUUID().slice(0, 8)}`;
    const user = await auth(devUserId);
    const created = await inject<{
      route: {
        progress: { total: number };
        steps: Array<{
          code: string;
          title: string;
          deadline: string | null;
          source: { url: string } | null;
          knowledge?: { sources: Array<{ url: string }> };
        }>;
        possibleSteps: Array<{ code: string }>;
      };
    }>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        preferredLanguage: 'en',
        universityCode: 'SPBU',
        campusCode: 'main',
        citizenshipType: 'foreign',
        entryMode: 'visa',
        russiaPresence: 'no',
        mobilityStatus: 'moving',
        enrollmentState: 'admitted',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'private',
      },
    });
    const archiveStep = created.route.steps.find((step) => step.code === 'FED_ENTRY_RULE_CHECK');
    expect(archiveStep?.title).toContain('въезда');
    expect(archiveStep?.deadline).toBeNull();
    expect(archiveStep?.knowledge?.sources.some((source) => source.url.startsWith('https://'))).toBe(true);
    expect(created.route.possibleSteps.length).toBeGreaterThan(0);
    await inject({
      method: 'PATCH',
      url: '/api/route/steps/FED_ENTRY_RULE_CHECK/status',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { status: 'COMPLETED' },
    });
    const reentered = await auth(devUserId);
    const reopened = await inject<typeof created>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${reentered.token}` },
    });
    expect(reopened.route.steps.find((step) => step.code === 'FED_ENTRY_RULE_CHECK')).toMatchObject({
      code: 'FED_ENTRY_RULE_CHECK',
    });
    expect(reopened.route.progress.total).toBe(created.route.progress.total);
    const russian = await auth(`archive-rf-${randomUUID().slice(0, 8)}`);
    const russianRoute = await inject<typeof created>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${russian.token}` },
      payload: {
        preferredLanguage: 'ru',
        universityCode: 'SPBU',
        campusCode: 'main',
        citizenshipType: 'rf',
        mobilityStatus: 'moving',
        enrollmentState: 'admitted',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'private',
      },
    });
    expect(russianRoute.route.steps.some((step) => step.code === 'FED_ENTRY_RULE_CHECK')).toBe(false);
    expect(russianRoute.route.possibleSteps.some((step) => step.code === 'FED_ENTRY_RULE_CHECK')).toBe(false);
  });

  it('separates RF and foreign guidance and restores completed steps after a university switch', async () => {
    const user = await auth(`switch-university-${randomUUID().slice(0, 8)}`);
    const payload = (universityCode: string, citizenshipType: 'rf' | 'foreign', confirmRestart = false) => ({
      preferredLanguage: 'ru',
      universityCode,
      campusCode: 'main',
      citizenshipType,
      mobilityStatus: 'moving',
      militaryStatus: 'unknown',
      admissionYear: 2026,
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'private',
      housingStatus: 'private',
      confirmRestart,
    });
    const first = await inject<{
      route: { steps: Array<{ code: string; status: string; source: { id: string } | null }> };
    }>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: payload('MSU', 'rf'),
    });
    expect(first.route.steps.some((step) => step.code === 'MSU_FACULTY_BEFORE')).toBe(false);
    const firstCode = 'CHECK_UNIVERSITY_FIRST_STEPS';
    await inject({
      method: 'PATCH',
      url: `/api/route/steps/${firstCode}/status`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { status: 'COMPLETED' },
    });
    const second = await inject<{ route: { steps: Array<{ code: string; source: { id: string } | null }> } }>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: payload('HSE', 'foreign', true),
    });
    expect(second.route.steps.some((step) => step.code === 'HSE_MOSCOW_FOREIGN_INTAKE')).toBe(true);
    expect(second.route.steps.every((step) => !step.source?.id.startsWith('uni_msu_'))).toBe(true);
    const restored = await inject<{ route: { steps: Array<{ code: string; status: string }> } }>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: payload('MSU', 'rf', true),
    });
    expect(restored.route.steps.find((step) => step.code === firstCode)?.status).toBe('COMPLETED');

    const rfAnswer = await new RouteService(connection.db).answerKnowledge(
      user.user.id,
      'зачисление кампус университет',
    );
    expect(rfAnswer.status).toBe('grounded');
    expect(rfAnswer.sources.every((source) => source.id.startsWith('uni_msu_'))).toBe(true);
    expect(rfAnswer.sources.some((source) => source.id.endsWith('_guide'))).toBe(false);
  });

  it('keeps 2026-only and other-university material out of Alice context', async () => {
    const user = await auth(`alice-year-filter-${randomUUID().slice(0, 8)}`);
    await inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        preferredLanguage: 'ru',
        universityCode: 'KFU',
        campusCode: 'main',
        citizenshipType: 'foreign',
        entryMode: 'visa',
        mobilityStatus: 'moving',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'dormitory',
        admissionYear: 2027,
      },
    });
    const adapter = new MockLlmAdapter();
    const providerCall = vi.spyOn(adapter, 'answerFromContext').mockResolvedValue({
      status: 'general',
      answer: 'Уточните порядок заселения на официальной странице КФУ.',
      nextAction: null,
      usedSourceIds: [],
      validAsOf: null,
    });
    await new RouteService(connection.db, adapter).answerKnowledge(user.user.id, 'Как заселиться в общежитие?');
    expect(providerCall).toHaveBeenCalledOnce();
    const sourceIds = providerCall.mock.calls[0]![0].context.map((item) => item.sourceId);
    expect(sourceIds.every((id) => id.startsWith('uni_kfu_') || id.startsWith('rf_'))).toBe(true);
    expect(sourceIds).not.toContain('uni_kfu_kfu_2026_housing');
    expect(sourceIds).not.toContain('uni_kfu_housing');
  });

  it('passes only selected-university material and safe profile, and accepts a source-free general answer', async () => {
    const user = await auth(`alice-context-${randomUUID().slice(0, 8)}`);
    await inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        preferredLanguage: 'ru',
        universityCode: 'MSU',
        campusCode: 'main',
        citizenshipType: 'rf',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'private',
      },
    });
    const llmAdapter = new MockLlmAdapter();
    const providerCall = vi.spyOn(llmAdapter, 'answerFromContext').mockResolvedValue({
      status: 'general',
      answer: 'Сначала составьте список дел и проверьте детали в своём университете.',
      nextAction: null,
      usedSourceIds: [],
      validAsOf: null,
    });
    const service = new RouteService(connection.db, llmAdapter);
    const general = await service.answerKnowledge(user.user.id, 'Как подготовиться к переезду?');
    expect(general).toMatchObject({ status: 'general', sources: [], validAsOf: null, contact: null });
    expect(providerCall).toHaveBeenCalledOnce();
    expect(providerCall.mock.calls[0]?.[0].profile).toMatchObject({
      university: 'МГУ имени М. В. Ломоносова',
      citizenship: 'rf',
      accommodation: 'private',
    });
    expect(providerCall.mock.calls[0]?.[0].profile).not.toHaveProperty('userId');
    providerCall.mockClear();
    await service.answerKnowledge(user.user.id, 'зачисление кампус университет');
    const context = providerCall.mock.calls[0]?.[0].context ?? [];
    expect(context.length).toBeGreaterThan(0);
    expect(context.every((item) => item.sourceId.startsWith('uni_msu_'))).toBe(true);
    expect(context.every((item) => !item.sourceId.startsWith('uni_hse_'))).toBe(true);
  });

  it('rejects an old situation change after profile circumstances were edited', async () => {
    const user = await auth(`stale-profile-${randomUUID().slice(0, 8)}`);
    const payload = (citizenshipType: 'rf' | 'foreign', confirmRestart = false) => ({
      preferredLanguage: 'ru',
      universityCode: 'MSU',
      campusCode: 'main',
      citizenshipType,
      mobilityStatus: 'moving',
      enrollmentState: 'admitted',
      militaryStatus: 'unknown',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'private',
      confirmRestart,
    });
    await inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: payload('rf'),
    });
    const candidate = await inject<{ candidate: { id: string } }>({
      method: 'POST',
      url: '/api/events/candidates',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { type: 'ACCOMMODATION_CHANGED', accommodationType: 'dormitory' },
    });
    await inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: payload('foreign', true),
    });
    const stale = await inject<{ code: string }>(
      {
        method: 'POST',
        url: '/api/events/confirm',
        headers: { authorization: `Bearer ${user.token}` },
        payload: { candidateId: candidate.candidate.id },
      },
      409,
    );
    expect(stale.code).toBe('CANDIDATE_STALE');
  });

  it('creates a 7–10 step route, completes idempotently, preserves it across reconnect and isolates owners', async () => {
    const suffix = randomUUID().slice(0, 8);
    const userA = await auth(`integration-a-${suffix}`);
    const userB = await auth(`integration-b-${suffix}`);
    const created = await onboard(userA.token, 'dormitory');
    await onboard(userB.token, 'private');
    expect(created.route.steps.length).toBeGreaterThanOrEqual(7);
    expect(created.route.steps.length).toBeLessThanOrEqual(15);
    expect(created.route.steps.every((step) => step.source?.url.startsWith('https://'))).toBe(true);
    const first = created.route.steps[0]!;
    const completeRequest: InjectOptions = {
      method: 'PATCH',
      url: `/api/route/steps/${first.code}/status`,
      headers: { authorization: `Bearer ${userA.token}` },
      payload: { status: 'COMPLETED' },
    };
    const completed = await inject<{ route: { progress: { completed: number }; nextAction: { code: string } | null } }>(
      completeRequest,
    );
    const repeated = await inject<{ route: { progress: { completed: number }; nextAction: { code: string } | null } }>(
      completeRequest,
    );
    expect(completed.route.progress.completed).toBe(1);
    expect(repeated.route.progress.completed).toBe(1);
    expect(completed.route.nextAction?.code).toBe(repeated.route.nextAction?.code);
    await inject(
      {
        ...completeRequest,
        payload: { status: 'IN_PROGRESS' },
      },
      409,
    );
    await inject(
      {
        method: 'POST',
        url: '/api/onboarding',
        headers: { authorization: `Bearer ${userA.token}` },
        payload: {
          preferredLanguage: 'en',
          universityCode: 'ITMO',
          arrivalStatus: 'arrived',
          arrivalDate: '2026-09-26',
          accommodationType: 'private',
        },
      },
      409,
    );

    const candidate = await inject<{ candidate: { id: string } }>({
      method: 'POST',
      url: '/api/events/candidates',
      headers: { authorization: `Bearer ${userA.token}` },
      payload: { type: 'ACCOMMODATION_CHANGED', accommodationType: 'private' },
    });
    await inject(
      {
        method: 'POST',
        url: '/api/events/confirm',
        headers: { authorization: `Bearer ${userB.token}` },
        payload: { candidateId: candidate.candidate.id },
      },
      404,
    );
    const changed = await inject<{
      route: { version: number; steps: Array<{ code: string; status: string }> };
      diff: { added: string[]; deactivated: string[]; preservedCompleted: string[] };
    }>({
      method: 'POST',
      url: '/api/events/confirm',
      headers: { authorization: `Bearer ${userA.token}` },
      payload: { candidateId: candidate.candidate.id },
    });
    expect(changed.diff.added).toContain('REGISTER_PRIVATE_RESIDENCE');
    expect(changed.diff.deactivated).toContain('ITMO_DORM_APPLICATION');
    expect(new Set(changed.route.steps.map((step) => step.code)).size).toBe(changed.route.steps.length);
    expect(changed.route.steps.find((step) => step.code === first.code)?.status).toBe('COMPLETED');
    const repeatedEvent = await inject<{ alreadyConfirmed: boolean; route: { version: number } }>({
      method: 'POST',
      url: '/api/events/confirm',
      headers: { authorization: `Bearer ${userA.token}` },
      payload: { candidateId: candidate.candidate.id },
    });
    expect(repeatedEvent.alreadyConfirmed).toBe(true);
    expect(repeatedEvent.route.version).toBe(changed.route.version);

    const secondConnection = createDatabase(databaseUrl!);
    try {
      const persisted = await new RouteService(secondConnection.db).getRoute(userA.user.id);
      expect(persisted.steps.find((step) => step.code === first.code)?.status).toBe('COMPLETED');
      expect(persisted.steps.some((step) => step.code === 'REGISTER_PRIVATE_RESIDENCE')).toBe(true);
    } finally {
      await secondConnection.close();
    }
  });

  it('keeps the seed demo profile, completed state and confirmed event across repeated seed/restart setup', async () => {
    const cleanDemo = await auth('dev-student-clean');
    expect(cleanDemo.user.preferredLanguage).toBe('ru');
    const cleanProfile = await inject<{ profile: unknown | null }>({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${cleanDemo.token}` },
    });
    expect(cleanProfile.profile).toBeNull();
    const completedDemo = await auth('dev-student-completed');
    expect(completedDemo.user.preferredLanguage).toBe('ru');
    const prebuilt = await inject<{ route: { steps: Array<{ status: string }> } }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${completedDemo.token}` },
    });
    expect(prebuilt.route.steps.some((step) => step.status === 'COMPLETED')).toBe(true);

    const demo = await auth(`seed-lifecycle-${randomUUID().slice(0, 8)}`);
    const reset = await inject<{
      route: { id: string; steps: Array<{ code: string; status: string }> };
    }>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${demo.token}` },
      payload: {
        preferredLanguage: 'en',
        universityCode: 'ITMO',
        arrivalStatus: 'preparing',
        arrivalDate: '2026-09-25',
        accommodationType: 'dormitory',
        confirmRestart: true,
      },
    });
    const stableStep = reset.route.steps.find((step) => step.code === 'CHECK_ENTRY_REQUIREMENTS')!;
    await inject({
      method: 'PATCH',
      url: `/api/route/steps/${stableStep.code}/status`,
      headers: { authorization: `Bearer ${demo.token}` },
      payload: { status: 'COMPLETED' },
    });
    const candidate = await inject<{ candidate: { id: string } }>({
      method: 'POST',
      url: '/api/events/candidates',
      headers: { authorization: `Bearer ${demo.token}` },
      payload: { accommodationType: 'private' },
    });
    await inject({
      method: 'POST',
      url: '/api/events/confirm',
      headers: { authorization: `Bearer ${demo.token}` },
      payload: { candidateId: candidate.candidate.id },
    });

    const obsoleteCode = `OBSOLETE_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const [obsoleteDefinition] = await connection.db
      .insert(stepDefinitions)
      .values({
        code: obsoleteCode,
        universityCode: 'ITMO',
        stage: 'first_30_days',
        titleKey: 'route.archived.title',
        descriptionKey: 'route.archived.description',
        whyKey: 'route.archived.why',
        preparationKeys: [],
        contactKey: 'contact.official.instruction',
        deadlineNoteKey: 'deadline.to_be_confirmed',
        sourceId: null,
        validAsOf: '2026-09-21',
        verificationStatus: 'needs_confirmation',
        sortOrder: 999,
        applicability: {},
        prerequisites: [],
        deadlineRule: null,
        attention: 'normal',
        active: true,
      })
      .returning();
    const [obsoleteUserStep] = await connection.db
      .insert(userSteps)
      .values({
        routeId: reset.route.id,
        stepDefinitionId: obsoleteDefinition!.id,
        deadlineNoteKey: 'deadline.to_be_confirmed',
        isActive: true,
      })
      .returning();
    const [obsoleteReminder] = await connection.db
      .insert(reminders)
      .values({
        userId: demo.user.id,
        userStepId: obsoleteUserStep!.id,
        scheduledFor: new Date(Date.now() + 86_400_000),
        idempotencyKey: `obsolete-seed:${obsoleteUserStep!.id}`,
      })
      .returning();

    const directoryUser = await auth(`directory-seed-${randomUUID().slice(0, 8)}`);
    const directoryRoute = await inject<{ route: { id: string; steps: Array<{ code: string }> } }>({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${directoryUser.token}` },
      payload: {
        preferredLanguage: 'ru',
        universityCode: 'HSE',
        campusCode: 'main',
        citizenshipType: 'foreign',
        admissionYear: 2026,
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'private',
      },
    });
    await inject({
      method: 'PATCH',
      url: '/api/route/steps/HSE_ACCOUNT_MAIL/status',
      headers: { authorization: `Bearer ${directoryUser.token}` },
      payload: { status: 'COMPLETED' },
    });
    const [newDefinition] = await connection.db
      .select({ id: stepDefinitions.id })
      .from(stepDefinitions)
      .where(eq(stepDefinitions.code, 'HSE_MOSCOW_FOREIGN_INTAKE'));
    expect(newDefinition).toBeDefined();
    await connection.db
      .update(userSteps)
      .set({ isActive: false })
      .where(and(eq(userSteps.routeId, directoryRoute.route.id), eq(userSteps.stepDefinitionId, newDefinition!.id)));

    await runSeed(databaseUrl);

    const persisted = await inject<{
      route: { steps: Array<{ code: string; status: string }> };
    }>({ method: 'GET', url: '/api/route', headers: { authorization: `Bearer ${demo.token}` } });
    expect(persisted.route.steps.find((step) => step.code === stableStep.code)?.status).toBe('COMPLETED');
    expect(persisted.route.steps.some((step) => step.code === 'REGISTER_PRIVATE_RESIDENCE')).toBe(true);
    // Omission alone no longer retires a definition or loses its progress.
    expect(persisted.route.steps.some((step) => step.code === obsoleteCode)).toBe(true);
    const refreshedDirectory = await inject<{
      route: {
        steps: Array<{
          code: string;
          status: string;
          preparation: string[];
          source: { languages: string[] } | null;
        }>;
      };
    }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${directoryUser.token}` },
    });
    expect(refreshedDirectory.route.steps.some((step) => step.code === 'HSE_MOSCOW_FOREIGN_INTAKE')).toBe(true);
    expect(refreshedDirectory.route.steps.find((step) => step.code === 'HSE_MOSCOW_FOREIGN_INTAKE')).toMatchObject({
      preparation: [expect.stringContaining('паспорт')],
      source: { languages: ['en'] },
    });
    expect(refreshedDirectory.route.steps.find((step) => step.code === 'HSE_ACCOUNT_MAIL')?.status).toBe('COMPLETED');
    expect(
      (await connection.db.select().from(stepDefinitions).where(eq(stepDefinitions.id, obsoleteDefinition!.id)))[0]
        ?.active,
    ).toBe(true);
    expect(
      (await connection.db.select().from(userSteps).where(eq(userSteps.id, obsoleteUserStep!.id)))[0]?.isActive,
    ).toBe(true);
    expect(
      (await connection.db.select().from(reminders).where(eq(reminders.id, obsoleteReminder!.id)))[0]?.status,
    ).toBe('scheduled');
    await connection.db.delete(userSteps).where(eq(userSteps.stepDefinitionId, obsoleteDefinition!.id));
    await connection.db.delete(stepDefinitions).where(eq(stepDefinitions.id, obsoleteDefinition!.id));
  }, 90_000);

  it('keeps an existing completion and scheduled reminder through repeated archive seeds', async () => {
    const user = await auth(`draft-seed-${randomUUID().slice(0, 8)}`);
    const created = await onboard(user.token);
    const [completed, reminderTarget] = created.route.steps;
    expect(completed).toBeDefined();
    expect(reminderTarget).toBeDefined();
    await inject({
      method: 'PATCH',
      url: `/api/route/steps/${completed!.code}/status`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { status: 'COMPLETED' },
    });
    await inject({
      method: 'POST',
      url: '/api/reminders/opt-in',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {},
    });
    await inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { stepCode: reminderTarget!.code, demoInSeconds: 3600 },
    });
    const before = await connection.db.select().from(reminders).where(eq(reminders.userId, user.user.id));
    expect(before).toHaveLength(1);
    expect(before[0]?.status).toBe('scheduled');

    await runSeed(databaseUrl);
    await runSeed(databaseUrl);

    const route = await inject<{
      route: { steps: Array<{ code: string; status: string }>; possibleSteps: Array<{ code: string }> };
    }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${user.token}` },
    });
    const after = await connection.db.select().from(reminders).where(eq(reminders.userId, user.user.id));
    expect(route.route.steps.find((step) => step.code === completed!.code)?.status).toBe('COMPLETED');
    expect(after.map((item) => [item.id, item.userStepId, item.status])).toEqual(
      before.map((item) => [item.id, item.userStepId, item.status]),
    );
    expect(route.route.possibleSteps.some((step) => step.code.startsWith('FED_') || step.code.startsWith('UNI_'))).toBe(
      true,
    );
  }, 90_000);

  it('rejects expired and cancelled candidates while persisting terminal state', async () => {
    const user = await auth(`candidate-terminal-${randomUUID().slice(0, 8)}`);
    await onboard(user.token);
    const service = new RouteService(connection.db);
    const expired = await service.createEventCandidate(user.user.id, 'private', new Date('2020-01-01T00:00:00Z'));
    await expect(
      service.confirmEventCandidate(user.user.id, expired.id, new Date('2020-01-02T00:00:00Z')),
    ).rejects.toMatchObject({
      code: 'CANDIDATE_EXPIRED',
    });
    const expiredRow = (
      await connection.db.select().from(eventCandidates).where(eq(eventCandidates.id, expired.id)).limit(1)
    )[0];
    expect(expiredRow?.status).toBe('EXPIRED');

    const cancelled = await service.createEventCandidate(user.user.id, 'private');
    await service.cancelEventCandidate(user.user.id, cancelled.id);
    await expect(service.confirmEventCandidate(user.user.id, cancelled.id)).rejects.toMatchObject({
      code: 'CANDIDATE_NOT_PENDING',
    });
  });

  it('confirms an arrival date once, recalculates the route, and survives a new database connection', async () => {
    const user = await auth(`arrival-${randomUUID().slice(0, 8)}`);
    const initial = await onboard(user.token);
    const completedCode = initial.route.steps[0]!.code;
    await inject({
      method: 'PATCH',
      url: `/api/route/steps/${completedCode}/status`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { status: 'COMPLETED' },
    });
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await inject(
      {
        method: 'POST',
        url: '/api/events/candidates',
        headers: { authorization: `Bearer ${user.token}` },
        payload: { type: 'ARRIVAL_CONFIRMED', arrivalDate: tomorrow },
      },
      422,
    );
    await inject(
      {
        method: 'POST',
        url: '/api/events/candidates',
        headers: { authorization: `Bearer ${user.token}` },
        payload: { type: 'ACCOMMODATION_CHANGED', arrivalDate: '2026-09-20' },
      },
      400,
    );

    const arrivalDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const candidate = await inject<{ candidate: { id: string; type: string; payload: { arrivalDate: string } } }>({
      method: 'POST',
      url: '/api/events/candidates',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { type: 'ARRIVAL_CONFIRMED', arrivalDate },
    });
    expect(candidate.candidate).toMatchObject({ type: 'ARRIVAL_CONFIRMED', payload: { arrivalDate } });
    const confirmed = await inject<{
      route: { version: number; archivedCompleted: string[]; steps: Array<{ code: string }> };
      diff: { preservedCompleted: string[] };
      alreadyConfirmed: boolean;
    }>({
      method: 'POST',
      url: '/api/events/confirm',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { candidateId: candidate.candidate.id },
    });
    expect(confirmed.alreadyConfirmed).toBe(false);
    expect([...confirmed.diff.preservedCompleted, ...confirmed.route.archivedCompleted]).toContain(completedCode);
    const profile = await inject<{ profile: { arrivalStatus: string; arrivalDate: string } }>({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(profile.profile).toMatchObject({ arrivalStatus: 'arrived', arrivalDate });
    const repeated = await inject<{ alreadyConfirmed: boolean; route: { version: number } }>({
      method: 'POST',
      url: '/api/events/confirm',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { candidateId: candidate.candidate.id },
    });
    expect(repeated.alreadyConfirmed).toBe(true);
    expect(repeated.route.version).toBe(confirmed.route.version);

    const restarted = createDatabase(databaseUrl!);
    try {
      const persisted = await new RouteService(restarted.db).getProfile(user.user.id);
      expect(persisted.profile).toMatchObject({ arrivalStatus: 'arrived', arrivalDate });
    } finally {
      await restarted.close();
    }
  });

  it('allows only one of two conflicting candidates and marks the loser stale', async () => {
    const user = await auth(`candidate-race-${randomUUID().slice(0, 8)}`);
    await onboard(user.token);
    const service = new RouteService(connection.db);
    const first = await service.createEventCandidate(user.user.id, 'private');
    const second = await service.createEventCandidate(user.user.id, 'relatives');
    const confirm = (candidateId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/events/confirm',
        headers: { authorization: `Bearer ${user.token}` },
        payload: { candidateId },
      });
    const results = await Promise.all([confirm(first.id), confirm(second.id)]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const rejected = results.find((result) => result.statusCode === 409)!;
    expect(json<{ code: string }>(rejected).code).toBe('CANDIDATE_STALE');
    const candidates = await connection.db
      .select()
      .from(eventCandidates)
      .where(eq(eventCandidates.userId, user.user.id));
    expect(candidates.filter((candidate) => candidate.status === 'CONFIRMED')).toHaveLength(1);
    expect(candidates.filter((candidate) => candidate.status === 'CONFLICTED')).toHaveLength(1);
    const confirmedEvents = await connection.db.select().from(events).where(eq(events.userId, user.user.id));
    expect(confirmedEvents).toHaveLength(1);
    const profile = (
      await connection.db.select().from(userProfiles).where(eq(userProfiles.userId, user.user.id)).limit(1)
    )[0]!;
    expect(['private', 'relatives']).toContain(profile.accommodationType);
    const stale = candidates.find((candidate) => candidate.status === 'CONFLICTED')!;
    await inject(
      {
        method: 'POST',
        url: '/api/events/confirm',
        headers: { authorization: `Bearer ${user.token}` },
        payload: { candidateId: stale.id },
      },
      409,
    );
  });

  it('returns grounded answers only from seed sources and safe fallback for unknown questions', async () => {
    const user = await auth(`knowledge-${randomUUID().slice(0, 8)}`);
    await onboard(user.token);
    const known = await inject<{
      answer: { queryId: string; status: string; sources: Array<{ id: string }>; validAsOf: string };
    }>({
      method: 'POST',
      url: '/api/knowledge/query',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { question: 'How do I arrange a dormitory booking?' },
    });
    expect(known.answer.status).toBe('grounded');
    expect(known.answer.sources).toHaveLength(1);
    expect(known.answer.validAsOf).toBe('2026-09-21');
    await new RouteService(connection.db).updateLanguage(user.user.id, 'ru');
    const russianRoute = await inject<{
      route: { steps: Array<{ code: string; source: { title: string; authority: string } | null }> };
    }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(russianRoute.route.steps.find((step) => step.code === 'CHECK_ENTRY_REQUIREMENTS')?.source).toMatchObject({
      title: 'Памятка ИТМО о приезде первокурсников',
      authority: 'ИТМО',
    });
    const russian = await inject<{
      answer: { status: string; sources: Array<{ id: string; url: string; title: string; authority: string }> };
    }>({
      method: 'POST',
      url: '/api/knowledge/query',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { question: 'Какие миграционные документы проверить в ИТМО после въезда?' },
    });
    expect(russian.answer.status).toBe('grounded');
    expect(russian.answer.sources).toContainEqual(
      expect.objectContaining({
        id: 'itmo_migration_documents_ru',
        title: 'Миграционные документы',
        authority: 'ИТМО',
        url: 'https://int.itmo.ru/ru/important_documents',
      }),
    );
    const identity = await inject<{
      answer: { status: string; answer: string | null; sources: unknown[]; contact: string | null };
    }>({
      method: 'POST',
      url: '/api/knowledge/query',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { question: 'кто ты' },
    });
    expect(identity.answer).toMatchObject({
      status: 'product_help',
      sources: [],
      contact: null,
    });
    expect(identity.answer.answer).toContain('Пути студента');
    const greeting = await inject<{
      answer: { status: string; answer: string | null; sources: unknown[]; contact: string | null };
    }>({
      method: 'POST',
      url: '/api/knowledge/query',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { question: 'привет' },
    });
    expect(greeting.answer).toMatchObject({ status: 'product_help', sources: [], contact: null });
    expect(greeting.answer.answer).toContain('Здравствуйте!');
    const llmAdapter = new MockLlmAdapter();
    const providerCall = vi.spyOn(llmAdapter, 'answerFromContext');
    expect((await new RouteService(connection.db, llmAdapter).answerKnowledge(user.user.id, 'привет')).status).toBe(
      'product_help',
    );
    expect(providerCall).not.toHaveBeenCalled();
    const naturalQuestion = await new RouteService(connection.db, llmAdapter).answerKnowledge(
      user.user.id,
      'как мне оформить миграционный учет',
    );
    expect(naturalQuestion.status).toBe('grounded');
    expect(providerCall).toHaveBeenCalledOnce();
    expect(providerCall.mock.calls[0]?.[0].context.length).toBeGreaterThan(0);
    providerCall.mockClear();
    const hindi = await new RouteService(connection.db, llmAdapter).answerKnowledge(
      user.user.id,
      'आईटीएमओ में प्रवास पंजीकरण के दस्तावेज़ कहाँ देखें?',
    );
    expect(providerCall).toHaveBeenCalledOnce();
    expect(providerCall.mock.calls[0]?.[0].context.some((item) => item.sourceId.startsWith('itmo_'))).toBe(true);
    expect(
      hindi.sources.every(
        (source) => source.id.startsWith('itmo_') || source.id.startsWith('uni_itmo_') || source.id.startsWith('rf_'),
      ),
    ).toBe(true);
    await new RouteService(connection.db).updateLanguage(user.user.id, 'en');
    const unknown = await inject<{
      answer: { status: string; answer: string | null; sources: unknown[]; contact: string | null };
    }>({
      method: 'POST',
      url: '/api/knowledge/query',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { question: 'Where can I park my quantum submarine?' },
    });
    expect(unknown.answer.status).toBe('not_found');
    expect(unknown.answer.answer).toBeNull();
    expect(unknown.answer.sources).toEqual([]);
    expect(unknown.answer.contact).toContain('int.students@itmo.ru');

    const savedFeedback = await inject<{ feedback: { id: string; type: string } }>({
      method: 'POST',
      url: '/api/feedback',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { queryId: known.answer.queryId, type: 'HELPFUL' },
    });
    expect(savedFeedback.feedback.type).toBe('HELPFUL');
    const feedbackRows = await connection.db
      .select()
      .from(feedback)
      .where(and(eq(feedback.userId, user.user.id), eq(feedback.queryId, known.answer.queryId)));
    expect(feedbackRows).toHaveLength(1);

    const share = await inject<{ text: string; url: string }>({
      method: 'GET',
      url: '/api/share',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(share.url).toBe(`https://max.ru/:share?text=${encodeURIComponent(share.text)}`);
    expect(share.text).not.toContain(user.user.maxUserId);

    const retiredId = `removed-${randomUUID()}`;
    await connection.db.insert(knowledgeDocuments).values({
      id: retiredId,
      title: 'Removed test document',
      content: 'zeppelinpermit zeppelinpermit is a retired test-only instruction.',
      sourceId: 'itmo_arrival_guide',
      language: 'en',
      tags: ['zeppelinpermit'],
      active: true,
    });
    const service = new RouteService(connection.db);
    expect((await service.answerKnowledge(user.user.id, 'zeppelinpermit')).status).toBe('grounded');
    await runSeed(databaseUrl);
    expect((await service.answerKnowledge(user.user.id, 'zeppelinpermit')).status).toBe('not_found');
    const retired = await connection.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, retiredId));
    expect(retired).toHaveLength(1);
    expect(retired[0]?.active).toBe(false);
  }, 45_000);

  it('keeps citizenship and study arrival when the student temporarily leaves Russia', async () => {
    const user = await auth(`registry-arrival-${randomUUID().slice(0, 8)}`);
    const headers = { authorization: `Bearer ${user.token}` };
    await inject({
      method: 'POST',
      url: '/api/onboarding',
      headers,
      payload: {
        preferredLanguage: 'ru',
        universityCode: 'ITMO',
        campusCode: 'main',
        citizenshipType: 'foreign',
        citizenshipCountry: 'IN',
        entryMode: 'visa',
        studyArrival: 'yes',
        russiaPresence: 'no',
        russiaEntryDate: '2026-09-01',
        arrivalStatus: 'arrived',
        arrivalDate: '2026-09-02',
        mobilityStatus: 'moved',
        accommodationType: 'private',
      },
    });
    const saved = await inject<{
      profile: { countryOrRegion: string; arrivalStatus: string; attributes: Record<string, unknown> };
    }>({ method: 'GET', url: '/api/profile', headers });
    expect(saved.profile.countryOrRegion).toBe('IN');
    expect(saved.profile.arrivalStatus).toBe('arrived');
    expect(saved.profile.attributes).toMatchObject({
      studyArrival: 'yes',
      russiaPresence: 'no',
      russiaEntryDate: '2026-09-01',
    });
    const route = await inject<{
      route: { steps: Array<{ isActive: boolean; status: string }>; progress: { total: number; completed: number } };
    }>({ method: 'GET', url: '/api/route', headers });
    expect(route.route.progress.total).toBe(route.route.steps.filter((s) => s.isActive).length);
    expect(route.route.progress.completed).toBe(
      route.route.steps.filter((s) => s.isActive && s.status === 'COMPLETED').length,
    );
  });

  it('replaces, lists and cancels a reminder without restoring it on recalculation or opt-in', async () => {
    const user = await auth(`registry-reminder-${randomUUID().slice(0, 8)}`);
    const headers = { authorization: `Bearer ${user.token}` };
    const created = await onboard(user.token);
    const stepCode = created.route.steps[0]!.code;
    await inject({ method: 'POST', url: '/api/reminders/opt-in', headers });
    const scheduledFor = new Date(Date.now() + 86400000).toISOString();
    const replacement = new Date(Date.now() + 172800000).toISOString();
    for (const time of [scheduledFor, scheduledFor, replacement])
      await inject({ method: 'POST', url: '/api/reminders', headers, payload: { stepCode, scheduledFor: time } });
    const list = () =>
      inject<{ reminders: Array<{ stepCode: string; scheduledFor: string }> }>({
        method: 'GET',
        url: '/api/reminders',
        headers,
      });
    expect((await list()).reminders.filter((r) => r.stepCode === stepCode)).toEqual([
      { stepCode, scheduledFor: replacement },
    ]);
    const stranger = await auth(`registry-other-${randomUUID().slice(0, 8)}`);
    expect(
      (
        await inject<{ reminders: unknown[] }>({
          method: 'GET',
          url: '/api/reminders',
          headers: { authorization: `Bearer ${stranger.token}` },
        })
      ).reminders,
    ).toEqual([]);
    await inject({ method: 'PATCH', url: `/api/reminders/${stepCode}`, headers, payload: { mode: 'off' } });
    const service = new RouteService(connection.db);
    await service.getRoute(user.user.id);
    await service.setReminderConsent(user.user.id, false);
    await service.setReminderConsent(user.user.id, true);
    expect((await list()).reminders.filter((r) => r.stepCode === stepCode)).toEqual([]);
    await inject({ method: 'POST', url: '/api/reminders', headers, payload: { stepCode, scheduledFor } });
    expect((await list()).reminders.filter((r) => r.stepCode === stepCode)).toEqual([{ stepCode, scheduledFor }]);
    await inject({
      method: 'PATCH',
      url: `/api/route/steps/${stepCode}/status`,
      headers,
      payload: { status: 'IN_PROGRESS' },
    });
    const completed = await inject<{ route: { steps: Array<{ code: string; status: string }> } }>({
      method: 'PATCH',
      url: `/api/route/steps/${stepCode}/status`,
      headers,
      payload: { status: 'COMPLETED' },
    });
    expect(completed.route.steps.find((s) => s.code === stepCode)?.status).toBe('COMPLETED');
    expect((await list()).reminders.filter((r) => r.stepCode === stepCode)).toEqual([]);
  });

  it('creates and delivers a reminder exactly once under concurrent worker ticks', async () => {
    const user = await auth(`reminder-${randomUUID().slice(0, 8)}`);
    const created = await onboard(user.token);
    await inject({
      method: 'POST',
      url: '/api/reminders/opt-in',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {},
    });
    const stepCode = created.route.nextAction?.code ?? created.route.steps[0]!.code;
    await inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { stepCode, demoInSeconds: 1 },
    });
    const dueAt = new Date(Date.now() + 2_000);
    await Promise.all([worker.enqueueDueReminders(dueAt), worker.enqueueDueReminders(dueAt)]);
    await Promise.all([worker.deliverOutbox(dueAt), worker.deliverOutbox(dueAt)]);
    const deliveries = await connection.db
      .select({ total: count() })
      .from(mockDeliveries)
      .where(eq(mockDeliveries.recipient, user.user.maxUserId));
    expect(deliveries[0]?.total).toBe(1);
    await worker.enqueueDueReminders(new Date(dueAt.getTime() + 60_000));
    await worker.deliverOutbox(new Date(dueAt.getTime() + 60_000));
    const repeated = await connection.db
      .select({ total: count() })
      .from(mockDeliveries)
      .where(eq(mockDeliveries.recipient, user.user.maxUserId));
    expect(repeated[0]?.total).toBe(1);

    const raceUser = await auth(`reminder-race-${randomUUID().slice(0, 8)}`);
    const raceRoute = await onboard(raceUser.token);
    await inject({
      method: 'POST',
      url: '/api/reminders/opt-in',
      headers: { authorization: `Bearer ${raceUser.token}` },
      payload: {},
    });
    await inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { authorization: `Bearer ${raceUser.token}` },
      payload: { stepCode: raceRoute.route.nextAction!.code, demoInSeconds: 1 },
    });
    const raceDueAt = new Date(Date.now() + 2_000);
    await worker.enqueueDueReminders(raceDueAt);

    let releaseSend!: () => void;
    let markSendStarted!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sentRecipients: string[] = [];
    const realWorker = new ApplicationWorker(connection.db, {
      maxProvider: 'real',
      maxBotUsername: 'studyway_test_bot',
      miniAppUrl: config.miniAppPublicUrl,
      batchSize: 500,
      maxClient: {
        async sendToUser(recipient) {
          sentRecipients.push(recipient);
          if (recipient === raceUser.user.maxUserId) {
            markSendStarted();
            await release;
          }
          return {};
        },
        async answerCallback() {},
      },
    });
    const delivery = realWorker.deliverOutbox(raceDueAt);
    await sendStarted;
    let optOutSettled = false;
    const routeService = new RouteService(connection.db);
    const optOut = routeService.setReminderConsent(raceUser.user.id, false).then(() => {
      optOutSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(optOutSettled).toBe(false);
    releaseSend();
    expect(await delivery).toBeGreaterThanOrEqual(1);
    await optOut;
    expect(sentRecipients.filter((recipient) => recipient === raceUser.user.maxUserId)).toHaveLength(1);
    expect((await routeService.getProfile(raceUser.user.id)).profile?.remindersEnabled).toBe(false);
  });

  it('completes only the pinned current reminder step through the bot and keeps the app progress in sync', async () => {
    const user = await auth(`reminder-action-${randomUUID().slice(0, 8)}`);
    const created = await onboard(user.token);
    const target = created.route.nextAction?.code ?? created.route.steps[0]!.code;
    await inject({
      method: 'POST',
      url: '/api/reminders/opt-in',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {},
    });
    await inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { stepCode: target, demoInSeconds: 1 },
    });
    const dueAt = new Date(Date.now() + 2_000);
    await worker.enqueueDueReminders(dueAt);
    await worker.deliverOutbox(dueAt);
    const [reminder] = await connection.db.select().from(reminders).where(eq(reminders.userId, user.user.id));
    expect(reminder?.status).toBe('sent');
    const [notification] = await connection.db.select().from(outbox).where(eq(outbox.sourceId, reminder!.id));
    const callback = `reminder_done:${reminder!.id}:${reminder!.userStepId}:${created.route.version}`;
    expect(JSON.stringify(notification?.payload)).toContain(callback);
    expect(JSON.stringify(notification?.payload)).toContain(`step_${target}`);

    const bot = new BotUpdateHandler(connection.db, { miniAppUrl: 'http://localhost:4173' });
    const press = async (maxUserId: string, payload = callback) => {
      const sourceId = randomUUID();
      await bot.handle(
        { type: 'message_callback', userId: maxUserId, callbackPayload: payload, providerKey: sourceId, raw: {} },
        sourceId,
      );
      return (await connection.db.select().from(outbox).where(eq(outbox.sourceId, sourceId))).find(
        (row) => row.sourceType === 'bot_update',
      );
    };
    const stranger = await auth(`reminder-stranger-${randomUUID().slice(0, 8)}`);
    await onboard(stranger.token);
    expect(JSON.stringify((await press(stranger.user.maxUserId))?.payload)).toContain('outdated');
    const before = await inject<{ route: { progress: { completed: number } } }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(JSON.stringify((await press(user.user.maxUserId))?.payload)).toContain('marked as completed');
    const after = await inject<{ route: { progress: { completed: number } } }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(after.route.progress.completed).toBe(before.route.progress.completed + 1);
    expect(JSON.stringify((await press(user.user.maxUserId))?.payload)).toContain('already completed');
    const repeated = await inject<{ route: { progress: { completed: number } } }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(repeated.route.progress.completed).toBe(after.route.progress.completed);

    const next = (await new RouteService(connection.db).getRoute(user.user.id)).nextAction;
    expect(next).toBeTruthy();
    await inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { stepCode: next!.code, demoInSeconds: 1 },
    });
    const secondDueAt = new Date(Date.now() + 2_000);
    await worker.enqueueDueReminders(secondDueAt);
    await worker.deliverOutbox(secondDueAt);
    const sent = (await connection.db.select().from(reminders).where(eq(reminders.userId, user.user.id))).find(
      (item) => item.userStepId !== reminder!.userStepId,
    );
    expect(sent?.status).toBe('sent');
    const oldVersion = (await new RouteService(connection.db).getRoute(user.user.id)).version;
    await inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        preferredLanguage: 'en',
        universityCode: 'ITMO',
        arrivalStatus: 'preparing',
        arrivalDate: '2026-09-25',
        accommodationType: 'private',
        confirmRestart: true,
      },
    });
    const changed = await new RouteService(connection.db).getRoute(user.user.id);
    expect(changed.version).toBeGreaterThan(oldVersion);
    const staleCallback = `reminder_done:${sent!.id}:${sent!.userStepId}:${oldVersion}`;
    expect(JSON.stringify((await press(user.user.maxUserId, staleCallback))?.payload)).toContain('outdated');
    const step = (await connection.db.select().from(userSteps).where(eq(userSteps.id, sent!.userStepId)))[0];
    expect(step?.status).not.toBe('COMPLETED');
  });

  it('separates today from the next step and keeps the app as the bot entry point', async () => {
    const user = await auth(`bot-menu-${randomUUID().slice(0, 8)}`);
    const bot = new BotUpdateHandler(connection.db, { miniAppUrl: 'http://localhost:4173' });
    const send = async (type: string, callbackPayload?: string, text?: string) => {
      const sourceId = randomUUID();
      await bot.handle(
        { type, userId: user.user.maxUserId, callbackPayload, text, providerKey: sourceId, raw: {} },
        sourceId,
      );
      return (await connection.db.select().from(outbox).where(eq(outbox.sourceId, sourceId))).find(
        (row) => row.sourceType === 'bot_update',
      );
    };
    const welcome = await send('message_created', undefined, '/start');
    expect(JSON.stringify(welcome?.payload)).toContain('intro_lang:ru');
    await onboard(user.token);
    const returned = await send('message_created', undefined, '/start');
    expect(JSON.stringify(returned?.payload)).toContain('intro_lang:en');
    const today = await send('message_callback', 'menu_today');
    expect(JSON.stringify(today?.payload)).toContain('No steps have a confirmed deadline today');
    const next = await send('message_callback', 'menu_next');
    expect(JSON.stringify(next?.payload)).toContain('Next action');
    expect(JSON.stringify(next?.payload)).not.toContain('No steps have a confirmed deadline today');
    expect(JSON.stringify(await send('message_callback', 'menu_ask'))).toContain('Send your question');
    expect(JSON.stringify(await send('message_callback', 'menu_reminders'))).toContain('reminders');
    await inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        preferredLanguage: 'en',
        universityCode: 'OTHER',
        universityName: 'Test university',
        campusCode: 'main',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'private',
        confirmRestart: true,
      },
    });
    expect(JSON.stringify(await send('message_callback', 'menu_human'))).toContain('No verified contact');
  });

  it('does not enqueue or deliver reminders whose step definition was withdrawn', async () => {
    const user = await auth(`reminder-withdrawn-${randomUUID().slice(0, 8)}`);
    const created = await onboard(user.token);
    await inject({
      method: 'POST',
      url: '/api/reminders/opt-in',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {},
    });
    const code = `WITHDRAWN_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const [definition] = await connection.db
      .insert(stepDefinitions)
      .values({
        code,
        universityCode: 'ITMO',
        stage: 'first_30_days',
        titleKey: 'route.archived.title',
        descriptionKey: 'route.archived.description',
        whyKey: 'route.archived.why',
        preparationKeys: [],
        contactKey: 'contact.official.instruction',
        deadlineNoteKey: 'deadline.to_be_confirmed',
        sourceId: null,
        validAsOf: '2026-09-21',
        verificationStatus: 'needs_confirmation',
        sortOrder: 999,
        applicability: {},
        prerequisites: [],
        deadlineRule: null,
        attention: 'normal',
        active: false,
      })
      .returning();
    const [step] = await connection.db
      .insert(userSteps)
      .values({
        routeId: created.route.id,
        stepDefinitionId: definition!.id,
        deadlineNoteKey: 'deadline.to_be_confirmed',
        isActive: true,
      })
      .returning();
    const scheduledFor = new Date(Date.now() + 1_000);
    const [reminder] = await connection.db
      .insert(reminders)
      .values({
        userId: user.user.id,
        userStepId: step!.id,
        scheduledFor,
        idempotencyKey: `withdrawn-definition:${step!.id}`,
      })
      .returning();
    const dueAt = new Date(scheduledFor.getTime() + 1_000);

    await worker.enqueueDueReminders(dueAt);
    expect((await connection.db.select().from(reminders).where(eq(reminders.id, reminder!.id)))[0]?.status).toBe(
      'scheduled',
    );
    expect(await connection.db.select().from(outbox).where(eq(outbox.sourceId, reminder!.id))).toHaveLength(0);

    await connection.db.update(stepDefinitions).set({ active: true }).where(eq(stepDefinitions.id, definition!.id));
    await worker.enqueueDueReminders(dueAt);
    await connection.db.update(stepDefinitions).set({ active: false }).where(eq(stepDefinitions.id, definition!.id));
    await worker.deliverOutbox(dueAt);

    expect((await connection.db.select().from(reminders).where(eq(reminders.id, reminder!.id)))[0]?.status).toBe(
      'cancelled',
    );
    expect((await connection.db.select().from(outbox).where(eq(outbox.sourceId, reminder!.id)))[0]?.status).toBe(
      'cancelled',
    );
    expect(
      (
        await connection.db
          .select({ total: count() })
          .from(mockDeliveries)
          .where(eq(mockDeliveries.recipient, user.user.maxUserId))
      )[0]?.total,
    ).toBe(0);
  });

  it('cancels a pending reminder on opt-out before any mock delivery', async () => {
    const user = await auth(`reminder-optout-${randomUUID().slice(0, 8)}`);
    const created = await onboard(user.token);
    await inject({
      method: 'POST',
      url: '/api/reminders/opt-in',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {},
    });
    await inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { stepCode: created.route.nextAction!.code, demoInSeconds: 1 },
    });
    await inject({
      method: 'POST',
      url: '/api/reminders/opt-out',
      headers: { authorization: `Bearer ${user.token}` },
      payload: {},
    });
    await worker.enqueueDueReminders(new Date(Date.now() + 2_000));
    await worker.deliverOutbox(new Date(Date.now() + 2_000));
    const deliveries = await connection.db
      .select({ total: count() })
      .from(mockDeliveries)
      .where(eq(mockDeliveries.recipient, user.user.maxUserId));
    expect(deliveries[0]?.total).toBe(0);
  });

  it('moves reminders to matching terminal states after permanent and ambiguous delivery failures', async () => {
    const service = new RouteService(connection.db);
    const suffix = randomUUID().slice(0, 8);
    const permanentUser = await service.ensureUser(`reminder-permanent-${suffix}`, 'en');
    const ambiguousUser = await service.ensureUser(`reminder-ambiguous-${suffix}`, 'en');
    for (const user of [permanentUser, ambiguousUser]) {
      await service.onboard(user.id, {
        preferredLanguage: 'en',
        universityCode: 'ITMO',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'dormitory',
      });
      await service.setReminderConsent(user.id, true);
    }
    const scheduledFor = new Date(Date.now() + 1_000);
    const permanentRoute = await service.getRoute(permanentUser.id);
    const ambiguousRoute = await service.getRoute(ambiguousUser.id);
    const permanentReminder = await service.createReminder(
      permanentUser.id,
      permanentRoute.nextAction!.code,
      scheduledFor,
    );
    const ambiguousReminder = await service.createReminder(
      ambiguousUser.id,
      ambiguousRoute.nextAction!.code,
      scheduledFor,
    );
    const dueAt = new Date(scheduledFor.getTime() + 1_000);
    const failingWorker = new ApplicationWorker(connection.db, {
      maxProvider: 'real',
      maxBotUsername: 'studyway_test_bot',
      miniAppUrl: config.miniAppPublicUrl,
      batchSize: 500,
      maxClient: {
        async sendToUser(recipient) {
          if (recipient === permanentUser.maxUserId) {
            throw new MaxTransportError('permanent rejection', 'permanent', 400);
          }
          if (recipient === ambiguousUser.maxUserId) {
            throw new MaxTransportError('ambiguous timeout', 'ambiguous');
          }
          return {};
        },
        async answerCallback() {},
      },
    });
    await failingWorker.enqueueDueReminders(dueAt);
    await failingWorker.deliverOutbox(dueAt);

    const [permanentState] = await connection.db
      .select({ reminderStatus: reminders.status, outboxStatus: outbox.status })
      .from(reminders)
      .innerJoin(outbox, eq(reminders.outboxId, outbox.id))
      .where(eq(reminders.id, permanentReminder.id));
    expect(permanentState).toEqual({ reminderStatus: 'failed', outboxStatus: 'failed' });

    const [ambiguousState] = await connection.db
      .select({ reminderStatus: reminders.status, outboxStatus: outbox.status })
      .from(reminders)
      .innerJoin(outbox, eq(reminders.outboxId, outbox.id))
      .where(eq(reminders.id, ambiguousReminder.id));
    expect(ambiguousState).toEqual({ reminderStatus: 'unknown', outboxStatus: 'unknown' });
  });

  it('deduplicates webhook updates, verifies secrets, processes bot flow through inbox/outbox', async () => {
    const devUser = await auth(`bot-${randomUUID().slice(0, 8)}`);
    const realConfig = loadRuntimeConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      APP_BASE_URL: 'http://localhost:3000',
      MINIAPP_PUBLIC_URL: 'http://localhost:4173',
      ALLOWED_ORIGINS: 'http://localhost:4173',
      SESSION_SECRET: 'integration-real-session-secret-value-123456',
      MAX_PROVIDER: 'real',
      MAX_UPDATE_MODE: 'webhook',
      MAX_BOT_TOKEN: 'test-token-2026',
      MAX_BOT_USERNAME: 'first30_test_bot',
      MAX_WEBHOOK_PUBLIC_URL: 'https://example.test/webhooks/max',
      MAX_WEBHOOK_SECRET: 'valid-secret-2026',
    });
    const realApp = await buildApp({
      config: realConfig,
      database: connection,
      logger: false,
      closeDatabaseOnClose: false,
    });
    await realApp.ready();
    try {
      const disabledDevAuth = await realApp.inject({
        method: 'POST',
        url: '/api/auth/dev',
        payload: { devUserId: devUser.user.maxUserId },
      });
      expect(disabledDevAuth.statusCode).toBe(404);
      const raw = { update_type: 'bot_started', user: { user_id: devUser.user.maxUserId }, timestamp: 123 };
      const invalid = await realApp.inject({
        method: 'POST',
        url: '/webhooks/max',
        headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': 'wrong-secret' },
        payload: raw,
      });
      expect(invalid.statusCode).toBe(401);
      const invalidShape = await realApp.inject({
        method: 'POST',
        url: '/webhooks/max',
        headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': 'valid-secret-2026' },
        payload: {},
      });
      expect(invalidShape.statusCode).toBe(400);
      for (let index = 0; index < 2; index += 1) {
        const response = await realApp.inject({
          method: 'POST',
          url: '/webhooks/max',
          headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': 'valid-secret-2026' },
          payload: raw,
        });
        expect(response.statusCode).toBe(200);
      }
      const key = normalizeMaxUpdate(raw).providerKey;
      const inboxRows = await connection.db.select().from(webhookInbox).where(eq(webhookInbox.providerUpdateKey, key));
      expect(inboxRows.length).toBeLessThanOrEqual(1);
      await worker.processInbox();
      await worker.deliverOutbox();
      const botOutbox = await connection.db
        .select({ total: count() })
        .from(outbox)
        .where(and(eq(outbox.recipient, devUser.user.maxUserId), eq(outbox.sourceType, 'bot_update')));
      expect(botOutbox[0]?.total).toBe(1);

      const losslessRaw =
        '{"update_type":"bot_stopped","user":{"user_id":9223372036854775807},"timestamp":9223372036854775806}';
      const losslessUpdate = parseJsonLossless(losslessRaw) as Record<string, unknown>;
      const losslessWebhook = await realApp.inject({
        method: 'POST',
        url: '/webhooks/max',
        headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': 'valid-secret-2026' },
        payload: losslessRaw,
      });
      expect(losslessWebhook.statusCode, losslessWebhook.body).toBe(200);
      const losslessInbox = await connection.db
        .select()
        .from(webhookInbox)
        .where(eq(webhookInbox.providerUpdateKey, normalizeMaxUpdate(losslessUpdate).providerKey));
      expect(normalizeMaxUpdate(losslessInbox[0]!.payload).userId).toBe('9223372036854775807');

      const authDate = Math.floor(Date.now() / 1000);
      const maxAuthUserId = `9007199254${String(Date.now()).slice(-9)}`;
      const encodedUser = encodeURIComponent(`{"id":${maxAuthUserId},"language_code":"en"}`);
      const unsigned = `auth_date=${authDate}&query_id=${randomUUID()}&user=${encodedUser}`;
      const hash = computeMaxInitDataHash(unsigned, 'test-token-2026');
      const exchangeRequest = () =>
        realApp.inject({
          method: 'POST',
          url: '/api/auth/max',
          payload: { initData: `${unsigned}&hash=${hash}` },
        });
      const [maxAuth, concurrentMaxAuth] = await Promise.all([exchangeRequest(), exchangeRequest()]);
      expect(maxAuth.statusCode, maxAuth.body).toBe(200);
      expect(concurrentMaxAuth.statusCode, concurrentMaxAuth.body).toBe(200);
      const replayedMaxAuth = await exchangeRequest();
      expect(replayedMaxAuth.statusCode, replayedMaxAuth.body).toBe(200);
      expect(json<{ token: string }>(concurrentMaxAuth).token).toBe(json<{ token: string }>(maxAuth).token);
      expect(json<{ token: string }>(replayedMaxAuth).token).toBe(json<{ token: string }>(maxAuth).token);
      const maxAuthUser = json<{ user: { id: string } }>(maxAuth).user;
      const exchangeRows = await connection.db.select().from(maxAuthExchanges);
      expect(exchangeRows.filter((row) => row.userId === maxAuthUser.id)).toHaveLength(1);

      // The signed MAX identity must resolve to the same profile that the bot just built.
      const bot = new BotUpdateHandler(connection.db, {
        miniAppUrl: 'http://localhost:4173',
        maxBotUsername: 'first30_test_bot',
      });
      const botMessage = async (type: string, callbackPayload?: string) => {
        await bot.handle(
          {
            type,
            userId: maxAuthUserId,
            callbackPayload,
            providerKey: `signed-flow:${randomUUID()}`,
            raw: {},
          },
          randomUUID(),
        );
      };
      await botMessage('bot_started');
      for (const payload of [
        'onb_lang_en',
        'onb_answer:ONB_02_UNIVERSITY:ITMO',
        'onb_answer:ONB_03_CITIZENSHIP:India',
        'onb_answer:ONB_04_SPECIAL_STATUS:none',
        'onb_status_preparing',
        'onb_answer:ONB_06_PLANNED_DATE:__skip__',
        'onb_home_dormitory',
        'onb_answer:ONB_08_ADMISSION_YEAR:2026',
        'onb_answer:ONB_09_ENTRY_MODE:visa',
        'onb_answer:ONB_10_HOUSING_STATUS:applied',
        'onb_answer:ONB_11_MOBILITY:moving',
        'onb_answer:ONB_12_PROGRAM_LEVEL:bachelor_specialist',
      ])
        await botMessage('message_callback', payload);
      const signedToken = json<{ token: string }>(maxAuth).token;
      const signedRoute = await realApp.inject({
        method: 'GET',
        url: '/api/route',
        headers: { authorization: `Bearer ${signedToken}` },
      });
      expect(signedRoute.statusCode, signedRoute.body).toBe(200);
      const firstCode = json<{ route: { nextAction: { code: string } } }>(signedRoute).route.nextAction.code;
      const firstDetail = await realApp.inject({
        method: 'GET',
        url: `/api/route/steps/${firstCode}`,
        headers: { authorization: `Bearer ${signedToken}` },
      });
      expect(firstDetail.statusCode, firstDetail.body).toBe(200);
      const marked = await realApp.inject({
        method: 'PATCH',
        url: `/api/route/steps/${firstCode}/status`,
        headers: { authorization: `Bearer ${signedToken}` },
        payload: { status: 'COMPLETED' },
      });
      expect(marked.statusCode, marked.body).toBe(200);
      const reentry = await exchangeRequest();
      expect(reentry.statusCode, reentry.body).toBe(200);
      const restoredRoute = await realApp.inject({
        method: 'GET',
        url: '/api/route',
        headers: { authorization: `Bearer ${json<{ token: string }>(reentry).token}` },
      });
      expect(json<{ route: { progress: { completed: number } } }>(restoredRoute).route.progress.completed).toBe(1);

      const nullableUser = encodeURIComponent(
        JSON.stringify({
          id: '42',
          first_name: 'Max',
          last_name: null,
          username: null,
          language_code: 'ru',
          photo_url: null,
        }),
      );
      const nullableUnsigned = `auth_date=${authDate}&query_id=${randomUUID()}&user=${nullableUser}`;
      const nullableHash = computeMaxInitDataHash(nullableUnsigned, 'test-token-2026');
      const nullableResponse = await realApp.inject({
        method: 'POST',
        url: '/api/auth/max',
        payload: { initData: `${nullableUnsigned}&hash=${nullableHash}` },
      });
      expect(nullableResponse.statusCode, nullableResponse.body).toBe(200);
    } finally {
      await realApp.close();
    }
  });

  it('runs configured RU/EN bot onboarding with resume state and no direct mutation before confirm', async () => {
    const user = await auth(`bot-flow-${randomUUID().slice(0, 8)}`);
    const send = async (payload: { type: string; callbackPayload?: string; text?: string }) => {
      await inject({
        method: 'POST',
        url: '/api/dev/max/updates',
        headers: { authorization: `Bearer ${user.token}` },
        payload,
      });
      await worker.processInbox();
      await worker.deliverOutbox();
    };
    await send({ type: 'bot_started' });
    await send({ type: 'message_callback', callbackPayload: 'onb_lang_en' });
    await send({ type: 'message_callback', callbackPayload: 'onb_answer:ONB_02_UNIVERSITY:ITMO' });
    await send({ type: 'message_callback', callbackPayload: 'onb_answer:ONB_03_CITIZENSHIP:India' });
    await send({ type: 'message_callback', callbackPayload: 'onb_answer:ONB_04_SPECIAL_STATUS:none' });
    await send({ type: 'message_callback', callbackPayload: 'onb_status_preparing' });
    await send({ type: 'message_callback', callbackPayload: 'onb_answer:ONB_06_PLANNED_DATE:__skip__' });
    await send({ type: 'message_callback', callbackPayload: 'onb_home_dormitory' });
    for (const callbackPayload of [
      'onb_answer:ONB_08_ADMISSION_YEAR:2026',
      'onb_answer:ONB_09_ENTRY_MODE:visa',
      'onb_answer:ONB_10_HOUSING_STATUS:applied',
      'onb_answer:ONB_11_MOBILITY:moving',
      'onb_answer:ONB_12_PROGRAM_LEVEL:bachelor_specialist',
    ]) {
      await send({ type: 'message_callback', callbackPayload });
    }
    const route = await inject<{ route: { steps: unknown[] } }>({
      method: 'GET',
      url: '/api/route',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(route.route.steps.length).toBeGreaterThanOrEqual(7);
  });

  it('builds a sourced first action for four distinct location and move situations', async () => {
    const service = new RouteService(connection.db);
    const cases = [
      {
        name: 'already in the study city',
        citizenshipType: 'foreign',
        russiaPresence: 'yes',
        mobilityStatus: 'moved',
        arrivalStatus: 'arrived',
        entryMode: 'visa_free',
        first: 'CHECK_FOREIGN_STAY',
      },
      {
        name: 'Russian student before moving',
        citizenshipType: 'rf',
        russiaPresence: 'yes',
        mobilityStatus: 'moving',
        arrivalStatus: 'preparing',
        entryMode: 'unknown',
        first: 'NSU_FRESHMAN_MEETING',
      },
      {
        name: 'foreign student abroad',
        citizenshipType: 'foreign',
        russiaPresence: 'no',
        mobilityStatus: 'moving',
        arrivalStatus: 'preparing',
        entryMode: 'visa',
        first: 'CHECK_VISA_ENTRY',
      },
      {
        name: 'foreign student in Russia outside the study city',
        citizenshipType: 'foreign',
        russiaPresence: 'yes',
        mobilityStatus: 'moving',
        arrivalStatus: 'preparing',
        entryMode: 'visa',
        first: 'CHECK_FOREIGN_STAY',
      },
    ] as const;
    for (const item of cases) {
      const user = await service.ensureUser(`journey-${randomUUID()}`, 'ru');
      const created = await service.onboard(user.id, {
        preferredLanguage: 'ru',
        universityCode: 'NSU',
        campusCode: 'main',
        citizenshipType: item.citizenshipType,
        russiaPresence: item.russiaPresence,
        mobilityStatus: item.mobilityStatus,
        arrivalStatus: item.arrivalStatus,
        entryMode: item.entryMode,
        arrivalDate: null,
        accommodationType: 'unknown',
      });
      expect(created.route.nextAction?.code, item.name).toBe(item.first);
      expect(created.route.nextAction?.source?.url, item.name).toMatch(/^https:\/\//);
      expect(created.route.nextAction?.source?.verificationStatus, item.name).toBe('verified');
      const reopened = await service.getRoute(user.id);
      expect(reopened.id).toBe(created.route.id);
      expect(reopened.nextAction?.code).toBe(item.first);
      if (item.russiaPresence === 'yes') {
        expect(reopened.steps.some((step) => step.code === 'CHECK_VISA_ENTRY')).toBe(false);
      }
    }
    const inconsistent = await service.ensureUser(`journey-inconsistent-${randomUUID()}`, 'ru');
    await expect(
      service.onboard(inconsistent.id, {
        preferredLanguage: 'ru',
        universityCode: 'NSU',
        campusCode: 'main',
        citizenshipType: 'foreign',
        russiaPresence: 'no',
        studyArrival: 'no',
        mobilityStatus: 'moved',
        arrivalStatus: 'arrived',
        arrivalDate: null,
        accommodationType: 'unknown',
      }),
    ).rejects.toMatchObject({ code: 'INCONSISTENT_LOCATION' });
    expect((await service.getProfile(inconsistent.id)).profile).toBeNull();
  });

  it('keeps an old Russia-entry date separate from the city date through editing and reconnecting', async () => {
    const service = new RouteService(connection.db);
    const user = await service.ensureUser(`journey-legacy-${randomUUID()}`, 'ru');
    await service.onboard(user.id, {
      preferredLanguage: 'ru',
      universityCode: 'NSU',
      campusCode: 'main',
      citizenshipType: 'foreign',
      entryMode: 'already_in_russia',
      mobilityStatus: 'moving',
      arrivalStatus: 'arrived',
      arrivalDate: '2026-09-23',
      accommodationType: 'unknown',
    });
    const before = await service.getPublicProfile(user.id);
    expect(before.profile?.arrivalStatus).toBe('preparing');
    expect(before.profile?.arrivalDate).toBeNull();
    expect(before.profile?.attributes.legacyArrivalDate).toBe('2026-09-23');
    const oldRoute = await service.getRoute(user.id);
    expect(oldRoute.steps.some((step) => step.code === 'CHECK_VISA_ENTRY')).toBe(false);

    const updated = await service.onboard(
      user.id,
      {
        preferredLanguage: 'ru',
        universityCode: 'NSU',
        campusCode: 'main',
        citizenshipType: 'foreign',
        russiaPresence: 'yes',
        russiaEntryDate: '2026-09-23',
        entryMode: 'visa_free',
        mobilityStatus: 'moving',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'unknown',
      },
      new Date(),
      true,
    );
    expect(updated.route.steps.some((step) => step.code === 'CHECK_VISA_ENTRY')).toBe(false);
    expect(updated.route.nextAction?.source?.url).toMatch(/^https:\/\//);
    await service.setStepStatus(user.id, 'CHECK_FOREIGN_STAY', 'COMPLETED');
    await service.onboard(
      user.id,
      {
        preferredLanguage: 'ru',
        universityCode: 'NSU',
        campusCode: 'main',
        citizenshipType: 'foreign',
        russiaPresence: 'yes',
        russiaEntryDate: '2026-09-23',
        entryMode: 'visa_free',
        mobilityStatus: 'moved',
        arrivalStatus: 'arrived',
        arrivalDate: '2026-09-25',
        accommodationType: 'unknown',
      },
      new Date(),
      true,
    );

    const reopenedConnection = createDatabase(databaseUrl!);
    try {
      const reopenedService = new RouteService(reopenedConnection.db);
      const profile = await reopenedService.getPublicProfile(user.id);
      const route = await reopenedService.getRoute(user.id);
      expect(profile.profile?.arrivalDate).toBe('2026-09-25');
      expect((profile.profile?.attributes as Record<string, unknown>).russiaEntryDate).toBe('2026-09-23');
      expect(profile.profile?.attributes.legacyArrivalDate).toBe('2026-09-23');
      expect(route.steps.find((step) => step.code === 'CHECK_FOREIGN_STAY')?.status).toBe('COMPLETED');
    } finally {
      await reopenedConnection.close();
    }
  });
});

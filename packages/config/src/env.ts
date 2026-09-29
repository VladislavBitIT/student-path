import { z } from 'zod';

const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().optional());
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.url().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  MINIAPP_PUBLIC_URL: z.url().default('http://localhost:4173'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:4173,http://localhost:5173'),
  SESSION_SECRET: optionalString,
  MAX_PROVIDER: z.enum(['mock', 'real']).default('mock'),
  MAX_API_BASE_URL: z.url().default('https://platform-api2.max.ru'),
  MAX_BOT_TOKEN: optionalString,
  MAX_BOT_USERNAME: optionalString,
  MAX_INTRO_VIDEO_RU_TOKEN: optionalString,
  MAX_INTRO_VIDEO_EN_TOKEN: optionalString,
  MAX_UPDATE_MODE: z.enum(['mock', 'long_polling', 'webhook']).default('mock'),
  MAX_WEBHOOK_PUBLIC_URL: optionalUrl,
  MAX_WEBHOOK_SECRET: optionalString,
  MAX_INIT_DATA_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  LLM_PROVIDER: z.enum(['none', 'mock', 'alice']).default('none'),
  LLM_BASE_URL: z.url().default('https://ai.api.cloud.yandex.net/v1'),
  LLM_API_KEY: optionalString,
  LLM_PROJECT_ID: optionalString,
  LLM_MODEL: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,100}$/)
    .default('aliceai-llm-flash'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4096).default(512),
  DEFAULT_UNIVERSITY: z.literal('ITMO').default('ITMO'),
  DEFAULT_TIMEZONE: z.literal('Europe/Moscow').default('Europe/Moscow'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
});

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  databaseUrl: string;
  appBaseUrl: string;
  miniAppPublicUrl: string;
  allowedOrigins: string[];
  sessionSecret: string;
  maxProvider: 'mock' | 'real';
  maxApiBaseUrl: string;
  maxBotToken?: string;
  maxBotUsername?: string;
  maxIntroVideoRuToken?: string;
  maxIntroVideoEnToken?: string;
  maxUpdateMode: 'mock' | 'long_polling' | 'webhook';
  maxWebhookPublicUrl?: string;
  maxWebhookSecret?: string;
  maxInitDataTtlSeconds: number;
  llmProvider: 'none' | 'mock' | 'alice';
  llmBaseUrl: string;
  llmApiKey?: string;
  llmProjectId?: string;
  llmModel: string;
  llmModelUri?: string;
  llmTimeoutMs: number;
  llmMaxOutputTokens: number;
  defaultUniversity: 'ITMO';
  defaultTimezone: 'Europe/Moscow';
  logLevel: string;
  apiPort: number;
  workerPollIntervalMs: number;
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const env = parsed.data;
  const productionLike = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
  const sessionSecret =
    env.SESSION_SECRET ?? (productionLike ? undefined : 'dev-only-first30-session-secret-not-for-production');
  if (!sessionSecret || sessionSecret.length < 32)
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  if (productionLike && /dev-only|change-in-production/i.test(sessionSecret)) {
    throw new Error('Production SESSION_SECRET must not use a documented development sentinel');
  }

  if (env.MAX_PROVIDER === 'mock' && env.MAX_UPDATE_MODE !== 'mock') {
    throw new Error('MAX_PROVIDER=mock requires MAX_UPDATE_MODE=mock');
  }
  if (env.MAX_PROVIDER === 'real') {
    if (!env.MAX_BOT_TOKEN || !env.MAX_BOT_USERNAME)
      throw new Error('Real MAX mode requires MAX_BOT_TOKEN and MAX_BOT_USERNAME');
    const maxApiUrl = new URL(env.MAX_API_BASE_URL);
    if (
      maxApiUrl.origin !== 'https://platform-api2.max.ru' ||
      maxApiUrl.pathname !== '/' ||
      maxApiUrl.search ||
      maxApiUrl.hash ||
      maxApiUrl.username ||
      maxApiUrl.password
    ) {
      throw new Error('Real MAX mode requires the official https://platform-api2.max.ru API base URL');
    }
    if (env.MAX_UPDATE_MODE === 'mock') throw new Error('Real MAX mode cannot use mock updates');
    if (env.MAX_UPDATE_MODE === 'webhook') {
      if (!env.MAX_WEBHOOK_PUBLIC_URL || new URL(env.MAX_WEBHOOK_PUBLIC_URL).protocol !== 'https:') {
        throw new Error('MAX webhook mode requires an HTTPS MAX_WEBHOOK_PUBLIC_URL');
      }
      if (!env.MAX_WEBHOOK_SECRET || !/^[A-Za-z0-9_-]{5,256}$/.test(env.MAX_WEBHOOK_SECRET)) {
        throw new Error('MAX_WEBHOOK_SECRET must match the safe subset [A-Za-z0-9_-]{5,256}');
      }
    }
  }
  let llmModelUri: string | undefined;
  if (env.LLM_PROVIDER === 'alice') {
    if (!env.LLM_API_KEY || !env.LLM_PROJECT_ID) {
      throw new Error('Alice LLM mode requires LLM_API_KEY and LLM_PROJECT_ID');
    }
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(env.LLM_PROJECT_ID)) {
      throw new Error('LLM_PROJECT_ID contains unsupported characters');
    }
    const llmBaseUrl = new URL(env.LLM_BASE_URL);
    if (
      llmBaseUrl.origin !== 'https://ai.api.cloud.yandex.net' ||
      llmBaseUrl.pathname !== '/v1' ||
      llmBaseUrl.search ||
      llmBaseUrl.hash ||
      llmBaseUrl.username ||
      llmBaseUrl.password
    ) {
      throw new Error('Alice LLM mode requires the official https://ai.api.cloud.yandex.net/v1 base URL');
    }
    llmModelUri = `gpt://${env.LLM_PROJECT_ID}/${env.LLM_MODEL}`;
  }
  if (productionLike) {
    if (env.MAX_PROVIDER !== 'real' || env.MAX_UPDATE_MODE !== 'webhook') {
      throw new Error('Production requires MAX_PROVIDER=real and MAX_UPDATE_MODE=webhook (also enforced in staging)');
    }
    if (new URL(env.APP_BASE_URL).protocol !== 'https:' || new URL(env.MINIAPP_PUBLIC_URL).protocol !== 'https:') {
      throw new Error('Production APP_BASE_URL and MINIAPP_PUBLIC_URL must use HTTPS (also enforced in staging)');
    }
    if (!environment.ALLOWED_ORIGINS?.trim()) {
      throw new Error('Production requires an explicit ALLOWED_ORIGINS value (also enforced in staging)');
    }
  }
  const configuredOrigins = env.ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configuredOrigins.length === 0 || configuredOrigins.includes('*'))
    throw new Error('ALLOWED_ORIGINS must be an explicit non-empty allowlist');
  const allowedOrigins = configuredOrigins.map((value) => {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(value);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid URL: ${value}`);
    }
    if (parsedOrigin.origin !== value.replace(/\/$/, '') || parsedOrigin.username || parsedOrigin.password) {
      throw new Error(`ALLOWED_ORIGINS entries must be origin-only URLs: ${value}`);
    }
    if (productionLike && parsedOrigin.protocol !== 'https:') {
      throw new Error(`Production ALLOWED_ORIGINS entries must use HTTPS: ${value}`);
    }
    return parsedOrigin.origin;
  });

  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    appBaseUrl: env.APP_BASE_URL,
    miniAppPublicUrl: env.MINIAPP_PUBLIC_URL,
    allowedOrigins,
    sessionSecret,
    maxProvider: env.MAX_PROVIDER,
    maxApiBaseUrl: env.MAX_API_BASE_URL.replace(/\/$/, ''),
    maxBotToken: env.MAX_BOT_TOKEN,
    maxBotUsername: env.MAX_BOT_USERNAME,
    maxIntroVideoRuToken: env.MAX_INTRO_VIDEO_RU_TOKEN,
    maxIntroVideoEnToken: env.MAX_INTRO_VIDEO_EN_TOKEN,
    maxUpdateMode: env.MAX_UPDATE_MODE,
    maxWebhookPublicUrl: env.MAX_WEBHOOK_PUBLIC_URL?.toString(),
    maxWebhookSecret: env.MAX_WEBHOOK_SECRET,
    maxInitDataTtlSeconds: env.MAX_INIT_DATA_TTL_SECONDS,
    llmProvider: env.LLM_PROVIDER,
    llmBaseUrl: env.LLM_BASE_URL.replace(/\/$/, ''),
    llmApiKey: env.LLM_API_KEY,
    llmProjectId: env.LLM_PROJECT_ID,
    llmModel: env.LLM_MODEL,
    llmModelUri,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    llmMaxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    defaultUniversity: env.DEFAULT_UNIVERSITY,
    defaultTimezone: env.DEFAULT_TIMEZONE,
    logLevel: env.LOG_LEVEL,
    apiPort: env.API_PORT,
    workerPollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
  };
}

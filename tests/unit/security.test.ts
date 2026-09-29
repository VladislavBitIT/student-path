import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig } from '@first30/config';
import { createSessionToken, verifySessionToken } from '@first30/application';
import {
  computeMaxInitDataHash,
  createAppMenuKeyboard,
  createOpenAppKeyboard,
  normalizeMaxUpdate,
  RealMaxClient,
  RealMaxUpdatePoller,
  validateMaxInitData,
} from '@first30/max-adapter';

const TOKEN = 'test-token-2026';
const INIT_DATA_WITH_OPENSSL_VECTOR =
  'user=%7B%22id%22%3A9223372036854775807%2C%22first_name%22%3A%22Test%22%2C%22language_code%22%3A%22en%22%7D&query_id=test-query&auth_date=1700000000&hash=eec290361c1272f19b23c6e85b333f4d0e6315169a99515ae08580076621c2c2';

describe('MAX initData security', () => {
  it('accepts an independently calculated OpenSSL known-answer vector and preserves int64 identity', () => {
    const result = validateMaxInitData({
      initData: INIT_DATA_WITH_OPENSSL_VECTOR,
      botToken: TOKEN,
      ttlSeconds: 3600,
      now: new Date(1_700_000_000_000),
    });
    expect(result).toMatchObject({
      ok: true,
      identity: {
        maxUserId: '9223372036854775807',
        authDate: 1_700_000_000,
        queryId: 'test-query',
        languageCode: 'en',
      },
    });
    expect(result.ok && result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate, tampered, stale and future values', () => {
    const duplicate = validateMaxInitData({
      initData: `${INIT_DATA_WITH_OPENSSL_VECTOR}&auth_date=1700000000`,
      botToken: TOKEN,
      ttlSeconds: 3600,
      now: new Date(1_700_000_000_000),
    });
    expect(duplicate).toEqual({ ok: false, code: 'DUPLICATE_KEY' });
    expect(
      validateMaxInitData({
        initData: INIT_DATA_WITH_OPENSSL_VECTOR.replace('Test', 'Mallory'),
        botToken: TOKEN,
        ttlSeconds: 3600,
        now: new Date(1_700_000_000_000),
      }),
    ).toEqual({ ok: false, code: 'INVALID_HASH' });
    expect(
      validateMaxInitData({
        initData: INIT_DATA_WITH_OPENSSL_VECTOR,
        botToken: TOKEN,
        ttlSeconds: 60,
        now: new Date(1_700_000_061_000),
      }),
    ).toEqual({ ok: false, code: 'STALE' });
    expect(
      validateMaxInitData({
        initData: INIT_DATA_WITH_OPENSSL_VECTOR,
        botToken: TOKEN,
        ttlSeconds: 3600,
        now: new Date(1_699_999_969_000),
      }),
    ).toEqual({ ok: false, code: 'FUTURE' });
  });

  it('strictly parses the top-level user schema and rejects invalid int64 identities', () => {
    const validateUser = (userJson: string) => {
      const unsigned = `auth_date=1700000000&query_id=strict-user&user=${encodeURIComponent(userJson)}`;
      const hash = computeMaxInitDataHash(unsigned, TOKEN);
      return validateMaxInitData({
        initData: `${unsigned}&hash=${hash}`,
        botToken: TOKEN,
        ttlSeconds: 3600,
        now: new Date(1_700_000_000_000),
      });
    };

    expect(validateUser('{"profile":{"id":42}}')).toEqual({ ok: false, code: 'MALFORMED' });
    expect(validateUser('{"id":42} trailing')).toEqual({ ok: false, code: 'MALFORMED' });
    expect(validateUser('{"id":1.5}')).toEqual({ ok: false, code: 'MISSING_USER' });
    expect(validateUser('{"id":9223372036854775808}')).toEqual({ ok: false, code: 'MISSING_USER' });
    expect(validateUser('{"id":9223372036854775807,"language_code":false}')).toEqual({
      ok: false,
      code: 'MALFORMED',
    });
    expect(
      validateUser(
        '{"id":42,"first_name":"Max","last_name":null,"username":null,"language_code":"ru","photo_url":null}',
      ),
    ).toMatchObject({
      ok: true,
      identity: { maxUserId: '42', languageCode: 'ru' },
    });
    expect(validateUser('{"id":42,"username":123}')).toEqual({ ok: false, code: 'MALFORMED' });
  });
});

describe('internal sessions and production config', () => {
  it('signs, verifies, expires and rejects tampered sessions', () => {
    const now = new Date('2026-09-21T12:00:00Z');
    const secret = 'a-secure-test-session-secret-value-123456';
    const token = createSessionToken({ userId: 'user-a', maxUserId: '42' }, secret, now, 60);
    expect(verifySessionToken(token, secret, now).maxUserId).toBe('42');
    expect(() => verifySessionToken(`${token}x`, secret, now)).toThrow();
    expect(() => verifySessionToken(token, secret, new Date(now.getTime() + 61_000))).toThrow();
  });

  it('runs mock without a token and fails closed in production', () => {
    const mock = loadRuntimeConfig({
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      NODE_ENV: 'test',
      MAX_PROVIDER: 'mock',
      MAX_UPDATE_MODE: 'mock',
    });
    expect(mock.maxProvider).toBe('mock');
    expect(mock.maxBotToken).toBeUndefined();
    expect(mock.llmProvider).toBe('none');
    expect(mock.llmModel).toBe('aliceai-llm-flash');
    expect(() =>
      loadRuntimeConfig({
        DATABASE_URL: 'postgresql://test:test@localhost/test',
        NODE_ENV: 'production',
        SESSION_SECRET: 'a-production-session-secret-value-long-enough',
        APP_BASE_URL: 'https://api.example.test',
        MINIAPP_PUBLIC_URL: 'https://app.example.test',
        ALLOWED_ORIGINS: 'https://app.example.test',
        MAX_PROVIDER: 'mock',
        MAX_UPDATE_MODE: 'mock',
      }),
    ).toThrow(/Production requires/);
    expect(() =>
      loadRuntimeConfig({
        DATABASE_URL: 'postgresql://test:test@localhost/test',
        NODE_ENV: 'test',
        MAX_PROVIDER: 'real',
        MAX_UPDATE_MODE: 'webhook',
      }),
    ).toThrow(/MAX_BOT_TOKEN/);
    expect(() =>
      loadRuntimeConfig({
        DATABASE_URL: 'postgresql://test:test@localhost/test',
        NODE_ENV: 'development',
        MAX_PROVIDER: 'real',
        MAX_UPDATE_MODE: 'long_polling',
        MAX_BOT_TOKEN: 'token',
        MAX_BOT_USERNAME: 'bot',
        MAX_API_BASE_URL: 'https://attacker.example.test',
      }),
    ).toThrow(/official https:\/\/platform-api2\.max\.ru/);
    expect(() =>
      loadRuntimeConfig({
        DATABASE_URL: 'postgresql://test:test@localhost/test',
        NODE_ENV: 'production',
        SESSION_SECRET: 'dev-only-first30-session-secret-change-in-production',
        APP_BASE_URL: 'https://api.example.test',
        MINIAPP_PUBLIC_URL: 'https://app.example.test',
        ALLOWED_ORIGINS: 'https://app.example.test',
        MAX_PROVIDER: 'real',
        MAX_UPDATE_MODE: 'webhook',
        MAX_BOT_TOKEN: 'token',
        MAX_BOT_USERNAME: 'bot',
        MAX_WEBHOOK_PUBLIC_URL: 'https://api.example.test/webhooks/max',
        MAX_WEBHOOK_SECRET: 'valid_secret-2026',
      }),
    ).toThrow(/development sentinel/);
    expect(() =>
      loadRuntimeConfig({
        DATABASE_URL: 'postgresql://test:test@localhost/test',
        NODE_ENV: 'staging',
        SESSION_SECRET: 'a-staging-session-secret-value-long-enough',
        MAX_PROVIDER: 'mock',
        MAX_UPDATE_MODE: 'mock',
      }),
    ).toThrow(/Production requires/);
    const secure = loadRuntimeConfig({
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-production-session-secret-value-long-enough',
      APP_BASE_URL: 'https://api.example.test',
      MINIAPP_PUBLIC_URL: 'https://app.example.test',
      ALLOWED_ORIGINS: 'https://app.example.test',
      MAX_PROVIDER: 'real',
      MAX_UPDATE_MODE: 'webhook',
      MAX_BOT_TOKEN: 'token',
      MAX_BOT_USERNAME: 'bot',
      MAX_WEBHOOK_PUBLIC_URL: 'https://api.example.test/webhooks/max',
      MAX_WEBHOOK_SECRET: 'valid_secret-2026',
    });
    expect(secure.maxWebhookSecret).toBe('valid_secret-2026');
  });

  it('validates Alice credentials, endpoint and model URI without exposing the key', () => {
    const base = {
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      NODE_ENV: 'test',
      MAX_PROVIDER: 'mock',
      MAX_UPDATE_MODE: 'mock',
      LLM_PROVIDER: 'alice',
    } as const;
    expect(() => loadRuntimeConfig(base)).toThrow(/LLM_API_KEY and LLM_PROJECT_ID/);
    expect(() =>
      loadRuntimeConfig({
        ...base,
        LLM_API_KEY: 'secret-value',
        LLM_PROJECT_ID: 'project-id',
        LLM_BASE_URL: 'https://attacker.example.test/v1',
      }),
    ).toThrow(/official https:\/\/ai\.api\.cloud\.yandex\.net\/v1/);
    const alice = loadRuntimeConfig({
      ...base,
      LLM_API_KEY: 'secret-value',
      LLM_PROJECT_ID: 'project-id',
    });
    expect(alice.llmModelUri).toBe('gpt://project-id/aliceai-llm-flash');
    expect(alice.llmTimeoutMs).toBe(15_000);
    expect(alice.llmMaxOutputTokens).toBe(512);
  });
});

describe('MAX adapter contract', () => {
  it('losslessly parses int64 ids received through long polling', async () => {
    const poller = new RealMaxUpdatePoller(
      'https://platform-api2.max.ru',
      'test-token',
      (async () =>
        new Response(
          '{"updates":[{"update_type":"bot_started","user":{"user_id":9223372036854775807}}],"marker":9223372036854775806}',
          { status: 200 },
        )) as typeof fetch,
    );
    const page = await poller.poll();
    expect(normalizeMaxUpdate(page.updates[0]!).userId).toBe('9223372036854775807');
    expect(page.marker).toBe('9223372036854775806');
  });

  it('uses stable event-specific deduplication keys', () => {
    const message = normalizeMaxUpdate({
      update_type: 'message_created',
      message: { sender: { user_id: '42' }, body: { mid: 'm-1', text: '/start' } },
    });
    expect(message.providerKey).toBe('message:m-1');
    expect(message.userId).toBe('42');
    const callback = normalizeMaxUpdate({
      update_type: 'message_callback',
      callback: { callback_id: 'c-1', payload: 'onb_lang_en', user: { user_id: '42' } },
      message: { sender: { user_id: '99', is_bot: true }, body: { mid: 'bot-message' } },
    });
    expect(callback.providerKey).toBe('callback:c-1');
    expect(callback.userId).toBe('42');
    expect(
      normalizeMaxUpdate({ update_type: 'message_callback', message: { sender: { user_id: '99' } } }).userId,
    ).toBeUndefined();
  });

  it('builds open_app through the official SDK', () => {
    expect(() => createOpenAppKeyboard('Open', 'https://example.test/app')).toThrow();
    expect(createOpenAppKeyboard('Open', 'studyway_test_bot', 'STEP_ONE')).toMatchObject({
      type: 'inline_keyboard',
      payload: {
        buttons: [[{ type: 'open_app', text: 'Open', web_app: 'studyway_test_bot', payload: 'step_STEP_ONE' }]],
      },
    });
  });

  it('puts mini app and actions into one MAX inline keyboard', () => {
    const keyboard = createAppMenuKeyboard('Открыть маршрут', 'studyway_test_bot', [
      [{ text: 'Следующий шаг', payload: 'menu_next' }],
    ]);
    expect(keyboard).toMatchObject({
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [{ type: 'open_app', text: 'Открыть маршрут', web_app: 'studyway_test_bot' }],
          [{ type: 'callback', text: 'Следующий шаг', payload: 'menu_next' }],
        ],
      },
    });
    expect(() =>
      createAppMenuKeyboard('Open', 'studyway_test_bot', [[{ text: 'X', payload: 'bad payload' }]]),
    ).toThrow();
  });

  it('never blindly retries ambiguous MAX POST failures and honors explicit 429 retry guidance', async () => {
    const serverFailure = new RealMaxClient(
      'https://platform-api2.max.ru',
      'test-token',
      (async () => new Response('{"message":"temporary"}', { status: 503 })) as typeof fetch,
    );
    await expect(serverFailure.sendToUser('42', { text: 'hello' })).rejects.toMatchObject({
      kind: 'ambiguous',
      status: 503,
    });

    const throttled = new RealMaxClient(
      'https://platform-api2.max.ru',
      'test-token',
      (async () =>
        new Response('{"message":"slow down"}', { status: 429, headers: { 'Retry-After': '2' } })) as typeof fetch,
    );
    await expect(throttled.sendToUser('42', { text: 'hello' })).rejects.toMatchObject({
      kind: 'transient',
      status: 429,
      retryAfterMs: 2000,
    });
  });

  it('treats a video still being processed by MAX as retryable', async () => {
    for (const status of [400, 200]) {
      const client = new RealMaxClient(
        'https://platform-api2.max.ru',
        'test-token',
        (async () => new Response('{"code":"attachment.not.ready"}', { status })) as typeof fetch,
      );
      await expect(
        client.sendToUser('42', {
          text: 'Open mini app',
          attachments: [{ type: 'video', payload: { token: 'test-video' } }],
        }),
      ).rejects.toMatchObject({ kind: 'transient', status, retryAfterMs: 30_000 });
    }
  });

  it('keeps welcome text and buttons if MAX rejects the optional image', async () => {
    const bodies: Array<{ text: string; attachments: Array<{ type: string }> }> = [];
    const client = new RealMaxClient('https://platform-api2.max.ru', 'test-token', async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return bodies.length === 1
        ? new Response('{}', { status: 400 })
        : new Response(JSON.stringify({ message: { body: { text: 'hello' } } }));
    });
    await client.sendToUser('42', {
      text: 'hello',
      attachments: [
        { type: 'image', payload: { url: 'https://example.com/welcome.jpg' } },
        { type: 'inline_keyboard', payload: { buttons: [] } },
      ],
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.attachments.map((attachment) => attachment.type)).toEqual(['image', 'inline_keyboard']);
    expect(bodies[1]).toEqual({ text: 'hello', attachments: [{ type: 'inline_keyboard', payload: { buttons: [] } }] });
  });

  it('does not resend an image message after an ambiguous MAX failure', async () => {
    const request = vi.fn(async () => new Response('{}', { status: 503 }));
    const client = new RealMaxClient('https://platform-api2.max.ru', 'test-token', request);
    await expect(
      client.sendToUser('42', {
        text: 'hello',
        attachments: [{ type: 'image', payload: { url: 'https://example.com/welcome.jpg' } }],
      }),
    ).rejects.toMatchObject({ kind: 'ambiguous', status: 503 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps the welcome text when MAX explicitly rejects the image with success false', async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) =>
      request.mock.calls.length === 1
        ? new Response('{"success":false}', { status: 200 })
        : new Response('{"success":true}', { status: 200 }),
    );
    const client = new RealMaxClient('https://platform-api2.max.ru', 'test-token', request);
    await client.sendToUser('42', {
      text: 'Welcome',
      attachments: [
        { type: 'image', payload: { url: 'https://example.com/welcome.jpg' } },
        { type: 'inline_keyboard', payload: { buttons: [] } },
      ],
    });
    expect(request).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body));
    expect(retryBody).toEqual({
      text: 'Welcome',
      attachments: [{ type: 'inline_keyboard', payload: { buttons: [] } }],
    });
  });

  it('acknowledges buttons with a nonempty localized body and never persists provider response content', async () => {
    let sentBody = '';
    const client = new RealMaxClient('https://platform-api2.max.ru', 'test-token', async (_url, options) => {
      sentBody = String(options?.body);
      return new Response(JSON.stringify({ success: false, message: 'sensitive-provider-content' }));
    });
    await expect(client.answerCallback('test-callback', undefined, 'Done')).rejects.toThrow('MAX API rejected request');
    expect(JSON.parse(sentBody)).toEqual({ notification: 'Done' });
  });
});

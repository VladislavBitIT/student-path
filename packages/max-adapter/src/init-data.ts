import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { parseJsonLossless } from './json.js';

export interface MaxIdentity {
  maxUserId: string;
  languageCode?: 'ru' | 'en';
  authDate: number;
  queryId?: string;
}

export type InitDataValidationResult =
  | { ok: true; identity: MaxIdentity; fingerprint: string }
  | { ok: false; code: 'MALFORMED' | 'DUPLICATE_KEY' | 'INVALID_HASH' | 'STALE' | 'FUTURE' | 'MISSING_USER' };

const maxUserSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    first_name: z.string().max(256).nullish(),
    last_name: z.string().max(256).nullish(),
    username: z.string().max(256).nullish(),
    language_code: z.string().min(2).max(16).nullish(),
    is_bot: z.boolean().nullish(),
  })
  .passthrough();

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

function normalizeMaxUserId(value: string | number): string | undefined {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,18}$/.test(raw)) return undefined;
  try {
    return BigInt(raw) <= MAX_SIGNED_INT64 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function parseUniquePairs(
  raw: string,
): { ok: true; values: Map<string, string> } | { ok: false; code: 'MALFORMED' | 'DUPLICATE_KEY' } {
  if (!raw || raw.length > 16_384) return { ok: false, code: 'MALFORMED' };
  const values = new Map<string, string>();
  for (const part of raw.split('&')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return { ok: false, code: 'MALFORMED' };
    const key = part.slice(0, separator);
    if (values.has(key)) return { ok: false, code: 'DUPLICATE_KEY' };
    try {
      values.set(key, decodeURIComponent(part.slice(separator + 1).replace(/\+/g, '%20')));
    } catch {
      return { ok: false, code: 'MALFORMED' };
    }
  }
  return { ok: true, values };
}

function safeHexEqual(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function computeMaxInitDataHash(rawWithoutHash: string, botToken: string): string {
  const parsed = parseUniquePairs(rawWithoutHash);
  if (!parsed.ok) throw new Error(parsed.code);
  const launchParams = [...parsed.values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(launchParams).digest('hex');
}

export function validateMaxInitData(input: {
  initData: string;
  botToken: string;
  ttlSeconds: number;
  now?: Date;
}): InitDataValidationResult {
  const parsed = parseUniquePairs(input.initData);
  if (!parsed.ok) return parsed;
  const hash = parsed.values.get('hash');
  if (!hash || [...parsed.values.keys()].filter((key) => key === 'hash').length !== 1)
    return { ok: false, code: 'MALFORMED' };

  const valuesWithoutHash = [...parsed.values.entries()].filter(([key]) => key !== 'hash');
  const launchParams = valuesWithoutHash
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(input.botToken).digest();
  const expected = createHmac('sha256', secretKey).update(launchParams).digest('hex');
  if (!safeHexEqual(hash, expected)) return { ok: false, code: 'INVALID_HASH' };

  const authDate = Number(parsed.values.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return { ok: false, code: 'MALFORMED' };
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (authDate > nowSeconds + 30) return { ok: false, code: 'FUTURE' };
  if (nowSeconds - authDate > input.ttlSeconds) return { ok: false, code: 'STALE' };

  const userJson = parsed.values.get('user');
  if (!userJson) return { ok: false, code: 'MISSING_USER' };
  let parsedUser: unknown;
  try {
    parsedUser = parseJsonLossless(userJson);
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }
  const user = maxUserSchema.safeParse(parsedUser);
  if (!user.success) return { ok: false, code: 'MALFORMED' };
  const maxUserId = normalizeMaxUserId(user.data.id);
  if (!maxUserId) return { ok: false, code: 'MISSING_USER' };
  const languageCode =
    user.data.language_code === 'ru' || user.data.language_code === 'en' ? user.data.language_code : undefined;

  return {
    ok: true,
    fingerprint: createHash('sha256').update(launchParams).digest('hex'),
    identity: {
      maxUserId,
      authDate,
      queryId: parsed.values.get('query_id'),
      languageCode,
    },
  };
}

export function constantTimeSecretEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualHash = createHmac('sha256', 'first30-webhook-secret').update(actual).digest();
  const expectedHash = createHmac('sha256', 'first30-webhook-secret').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

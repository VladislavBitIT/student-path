import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

export interface SessionIdentity {
  userId: string;
  maxUserId: string;
  expiresAt: number;
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload).digest();
}

export function createSessionToken(
  identity: Omit<SessionIdentity, 'expiresAt'>,
  secret: string,
  now = new Date(),
  ttlSeconds = 15 * 60,
): string {
  const payload: SessionIdentity = {
    ...identity,
    expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, secret).toString('base64url')}`;
}

export function verifySessionToken(token: string, secret: string, now = new Date()): SessionIdentity {
  const [encoded, providedSignature, ...rest] = token.split('.');
  if (!encoded || !providedSignature || rest.length > 0)
    throw new AppError(401, 'INVALID_SESSION', 'Сессия недействительна');
  const expected = signature(encoded, secret);
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSignature, 'base64url');
  } catch {
    throw new AppError(401, 'INVALID_SESSION', 'Сессия недействительна');
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AppError(401, 'INVALID_SESSION', 'Сессия недействительна');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(401, 'INVALID_SESSION', 'Сессия недействительна');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as SessionIdentity).userId !== 'string' ||
    typeof (payload as SessionIdentity).maxUserId !== 'string' ||
    !Number.isSafeInteger((payload as SessionIdentity).expiresAt)
  ) {
    throw new AppError(401, 'INVALID_SESSION', 'Сессия недействительна');
  }
  const identity = payload as SessionIdentity;
  if (identity.expiresAt < Math.floor(now.getTime() / 1000))
    throw new AppError(401, 'SESSION_EXPIRED', 'Сессия истекла');
  return identity;
}

export function readBearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith('Bearer ')) throw new AppError(401, 'AUTH_REQUIRED', 'Требуется авторизация');
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'Требуется авторизация');
  return token;
}

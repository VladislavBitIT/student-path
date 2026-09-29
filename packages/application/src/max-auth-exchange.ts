import { and, eq, lte } from 'drizzle-orm';
import { maxAuthExchanges, type Database } from '@first30/database';
import { createSessionToken } from './auth.js';
import { AppError } from './errors.js';

const SESSION_TTL_SECONDS = 15 * 60;

export interface MaxAuthExchangeInput {
  fingerprint: string;
  user: { id: string; maxUserId: string };
  authDate: number;
  initDataTtlSeconds: number;
  now?: Date;
}

/**
 * Idempotent MAX initData exchange ledger.
 *
 * A replay inside the signed initData validity window receives the same token
 * until that token expires. A replacement token may be minted only while the
 * original initData remains valid, and never extends beyond that boundary.
 * The database stores neither initData nor bearer tokens.
 */
export class MaxAuthExchangeService {
  constructor(
    private readonly db: Database,
    private readonly sessionSecret: string,
  ) {}

  async exchange(input: MaxAuthExchangeInput): Promise<string> {
    const now = input.now ?? new Date();
    const exchangeExpiresAt = new Date((input.authDate + input.initDataTtlSeconds) * 1000);
    if (exchangeExpiresAt.getTime() <= now.getTime()) {
      throw new AppError(401, 'MAX_INIT_DATA_STALE', 'Данные запуска MAX устарели');
    }

    return this.db.transaction(async (tx) => {
      await tx.delete(maxAuthExchanges).where(lte(maxAuthExchanges.exchangeExpiresAt, now));

      const initialSessionExpiresAt = new Date(
        Math.min(now.getTime() + SESSION_TTL_SECONDS * 1000, exchangeExpiresAt.getTime()),
      );
      await tx
        .insert(maxAuthExchanges)
        .values({
          fingerprint: input.fingerprint,
          userId: input.user.id,
          sessionIssuedAt: now,
          sessionExpiresAt: initialSessionExpiresAt,
          exchangeExpiresAt,
        })
        .onConflictDoNothing();

      let exchange = (
        await tx
          .select()
          .from(maxAuthExchanges)
          .where(eq(maxAuthExchanges.fingerprint, input.fingerprint))
          .limit(1)
          .for('update')
      )[0];
      if (!exchange || exchange.userId !== input.user.id) {
        throw new AppError(401, 'MAX_INIT_DATA_REPLAY_CONFLICT', 'Данные запуска MAX уже использованы');
      }
      if (exchange.exchangeExpiresAt.getTime() <= now.getTime()) {
        throw new AppError(401, 'MAX_INIT_DATA_STALE', 'Данные запуска MAX устарели');
      }

      if (exchange.sessionExpiresAt.getTime() < now.getTime()) {
        const sessionExpiresAt = new Date(
          Math.min(now.getTime() + SESSION_TTL_SECONDS * 1000, exchange.exchangeExpiresAt.getTime()),
        );
        exchange = (
          await tx
            .update(maxAuthExchanges)
            .set({ sessionIssuedAt: now, sessionExpiresAt, updatedAt: now })
            .where(and(eq(maxAuthExchanges.fingerprint, input.fingerprint), eq(maxAuthExchanges.userId, input.user.id)))
            .returning()
        )[0];
      }
      if (!exchange) {
        throw new AppError(401, 'MAX_INIT_DATA_REPLAY_CONFLICT', 'Данные запуска MAX уже использованы');
      }

      const ttlSeconds = Math.max(
        1,
        Math.floor((exchange.sessionExpiresAt.getTime() - exchange.sessionIssuedAt.getTime()) / 1000),
      );
      return createSessionToken(
        { userId: input.user.id, maxUserId: input.user.maxUserId },
        this.sessionSecret,
        exchange.sessionIssuedAt,
        ttlSeconds,
      );
    });
  }
}

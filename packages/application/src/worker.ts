import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Database } from '@first30/database';
import {
  outbox,
  reminders,
  mockDeliveries,
  routes,
  stepDefinitions,
  users,
  userProfiles,
  userSteps,
  webhookInbox,
} from '@first30/database';
import { t } from '@first30/i18n';
import type { LlmAdapter } from '@first30/domain';
import {
  createAppMenuKeyboard,
  MaxTransportError,
  normalizeMaxUpdate,
  type MaxClient,
  type OutboundMessage,
} from '@first30/max-adapter';
import { BotUpdateHandler, reminderDoneLabel } from './bot-handler.js';
import { RouteService } from './route-service.js';

export interface WorkerOptions {
  maxProvider: 'mock' | 'real';
  miniAppUrl: string;
  maxBotUsername?: string;
  introVideoTokens?: { ru?: string; en?: string };
  maxClient?: MaxClient;
  llmAdapter?: LlmAdapter;
  batchSize?: number;
}

export interface WorkerTickResult {
  remindersEnqueued: number;
  inboxProcessed: number;
  deliveriesSent: number;
}

export class ApplicationWorker {
  private readonly batchSize: number;
  private readonly lastDeliveryAt = new Map<string, number>();
  private lastGlobalDeliveryAt = 0;

  constructor(
    private readonly db: Database,
    private readonly options: WorkerOptions,
  ) {
    this.batchSize = options.batchSize ?? 20;
    if (options.maxProvider === 'real' && !options.maxBotUsername) throw new Error('MAX_BOT_USERNAME is required');
  }

  async tick(now = new Date()): Promise<WorkerTickResult> {
    const inboxProcessed = await this.processInbox(now);
    const remindersEnqueued = await this.enqueueDueReminders(now);
    const deliveriesSent = await this.deliverOutbox(now);
    return { remindersEnqueued, inboxProcessed, deliveriesSent };
  }

  async enqueueDueReminders(now = new Date()): Promise<number> {
    const candidates = await this.db
      .select({ userId: reminders.userId })
      .from(reminders)
      .innerJoin(userSteps, eq(reminders.userStepId, userSteps.id))
      .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
      .where(
        and(
          eq(reminders.status, 'scheduled'),
          lte(reminders.scheduledFor, now),
          sql`${stepDefinitions.knowledgeCard} is not null`,
        ),
      )
      .limit(this.batchSize);
    for (const userId of new Set(candidates.map((r) => r.userId))) {
      await new RouteService(this.db).recalculateRoute(userId, now);
    }
    const due = await this.db
      .select({
        reminder: reminders,
        user: users,
        step: userSteps,
        definition: stepDefinitions,
        routeVersion: routes.version,
      })
      .from(reminders)
      .innerJoin(users, eq(reminders.userId, users.id))
      .innerJoin(userProfiles, eq(reminders.userId, userProfiles.userId))
      .innerJoin(userSteps, eq(reminders.userStepId, userSteps.id))
      .innerJoin(routes, eq(userSteps.routeId, routes.id))
      .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
      .where(
        and(
          eq(reminders.status, 'scheduled'),
          lte(reminders.scheduledFor, now),
          eq(userProfiles.remindersEnabled, true),
          eq(routes.isCurrent, true),
          eq(userSteps.isActive, true),
          eq(stepDefinitions.active, true),
          ne(userSteps.status, 'COMPLETED'),
        ),
      )
      .orderBy(asc(reminders.scheduledFor))
      .limit(this.batchSize);
    let enqueued = 0;
    for (const item of due) {
      await this.db.transaction(async (tx) => {
        const profile = (
          await tx
            .select({ remindersEnabled: userProfiles.remindersEnabled })
            .from(userProfiles)
            .where(eq(userProfiles.userId, item.reminder.userId))
            .limit(1)
            .for('update')
        )[0];
        const currentStep = (
          await tx
            .select({
              active: userSteps.isActive,
              status: userSteps.status,
              current: routes.isCurrent,
              definitionActive: stepDefinitions.active,
            })
            .from(userSteps)
            .innerJoin(routes, eq(userSteps.routeId, routes.id))
            .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
            .where(eq(userSteps.id, item.reminder.userStepId))
            .limit(1)
            .for('update')
        )[0];
        if (
          !profile?.remindersEnabled ||
          !currentStep?.active ||
          !currentStep.current ||
          !currentStep.definitionActive ||
          currentStep.status === 'COMPLETED'
        ) {
          await tx
            .update(reminders)
            .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
            .where(and(eq(reminders.id, item.reminder.id), eq(reminders.status, 'scheduled')));
          return;
        }
        const [claimed] = await tx
          .update(reminders)
          .set({ status: 'processing', updatedAt: now })
          .where(and(eq(reminders.id, item.reminder.id), eq(reminders.status, 'scheduled')))
          .returning();
        if (!claimed) return;
        const card = item.definition.knowledgeCard;
        const title = card
          ? card.title.startsWith('FED_')
            ? card.actions[0]!
            : card.title
          : t(item.user.preferredLanguage, item.definition.titleKey);
        const message = t(item.user.preferredLanguage, 'reminders.notification', { title });
        let outbound = (
          await tx
            .insert(outbox)
            .values({
              sourceType: 'reminder',
              sourceId: item.reminder.id,
              recipient: item.user.maxUserId,
              payload: {
                kind: 'message',
                text: message,
                stepCode: item.definition.code,
                attachments: [
                  createAppMenuKeyboard(
                    t(item.user.preferredLanguage, 'reminders.open_step'),
                    this.options.maxBotUsername ?? 'studyway_test_bot',
                    [
                      [
                        {
                          text: reminderDoneLabel(item.user.preferredLanguage),
                          payload: `reminder_done:${item.reminder.id}:${item.reminder.userStepId}:${item.routeVersion}`,
                        },
                      ],
                    ],
                    item.definition.code,
                  ),
                ],
              },
              idempotencyKey: `reminder:${item.reminder.id}`,
            })
            .onConflictDoNothing()
            .returning()
        )[0];
        outbound ??= (
          await tx
            .select()
            .from(outbox)
            .where(eq(outbox.idempotencyKey, `reminder:${item.reminder.id}`))
            .limit(1)
        )[0];
        if (outbound) {
          await tx
            .update(reminders)
            .set({ outboxId: outbound.id, updatedAt: now })
            .where(eq(reminders.id, item.reminder.id));
          enqueued += 1;
        }
      });
    }
    return enqueued;
  }

  async processInbox(now = new Date()): Promise<number> {
    const items = await this.db
      .select()
      .from(webhookInbox)
      .where(eq(webhookInbox.status, 'pending'))
      .orderBy(asc(webhookInbox.receivedAt))
      .limit(this.batchSize);
    let processed = 0;
    for (const item of items) {
      const [claimed] = await this.db
        .update(webhookInbox)
        .set({ status: 'processing', lockedAt: now, attempts: item.attempts + 1, error: null })
        .where(and(eq(webhookInbox.id, item.id), eq(webhookInbox.status, 'pending')))
        .returning();
      if (!claimed) continue;
      try {
        await this.db.transaction(async (tx) => {
          const normalized = normalizeMaxUpdate(item.payload);
          if (normalized.userId) {
            // Serialize updates for one MAX account, including /reset on another worker.
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${normalized.userId}, 0))`);
          }
          const [current] = await tx
            .select({ status: webhookInbox.status })
            .from(webhookInbox)
            .where(eq(webhookInbox.id, item.id))
            .limit(1);
          if (current?.status !== 'processing') return;
          const transactionalHandler = new BotUpdateHandler(tx as unknown as Database, {
            miniAppUrl: this.options.miniAppUrl,
            maxBotUsername: this.options.maxBotUsername,
            introVideoTokens: this.options.introVideoTokens,
            llmAdapter: this.options.llmAdapter,
          });
          await transactionalHandler.handle(normalized, item.id);
          await tx
            .update(webhookInbox)
            .set({ status: 'processed', processedAt: now, lockedAt: null, error: null })
            .where(eq(webhookInbox.id, item.id));
        });
        processed += 1;
      } catch {
        const attempts = item.attempts + 1;
        await this.db
          .update(webhookInbox)
          .set({
            status: attempts >= 3 ? 'failed' : 'pending',
            lockedAt: null,
            error: 'Inbox processing failed',
          })
          .where(eq(webhookInbox.id, item.id));
      }
    }
    return processed;
  }

  async deliverOutbox(now = new Date()): Promise<number> {
    const items = await this.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.status, 'pending'),
          lte(outbox.availableAt, now),
          // Welcome and video can share a transaction timestamp. Wait for the welcome,
          // including its retries, before delivering the separate video or fallback.
          sql<boolean>`not exists (
            select 1 from outbox as intro_welcome
            where intro_welcome.idempotency_key = 'bot:' || ${outbox.sourceId} || ':intro-welcome'
              and intro_welcome.status in ('pending', 'processing')
              and ${outbox.idempotencyKey} in (
                'bot:' || ${outbox.sourceId} || ':intro-video',
                'bot:' || ${outbox.sourceId} || ':intro-video-fallback'
              )
          )`,
        ),
      )
      .orderBy(asc(outbox.availableAt), asc(outbox.createdAt))
      .limit(this.batchSize);
    let sent = 0;
    for (const item of items) {
      const [claimed] = await this.db
        .update(outbox)
        .set({ status: 'processing', lockedAt: now, attempts: item.attempts + 1, updatedAt: now })
        .where(and(eq(outbox.id, item.id), eq(outbox.status, 'pending')))
        .returning();
      if (!claimed) continue;
      if (this.options.maxProvider === 'mock') {
        let delivered = false;
        await this.db.transaction(async (tx) => {
          if (item.sourceType === 'reminder') {
            const reminder = (await tx.select().from(reminders).where(eq(reminders.id, item.sourceId)).limit(1))[0];
            const profile = reminder
              ? (
                  await tx
                    .select({ remindersEnabled: userProfiles.remindersEnabled })
                    .from(userProfiles)
                    .where(eq(userProfiles.userId, reminder.userId))
                    .limit(1)
                    .for('update')
                )[0]
              : undefined;
            const step = reminder
              ? (
                  await tx
                    .select({
                      active: userSteps.isActive,
                      status: userSteps.status,
                      current: routes.isCurrent,
                      definitionActive: stepDefinitions.active,
                    })
                    .from(userSteps)
                    .innerJoin(routes, eq(userSteps.routeId, routes.id))
                    .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
                    .where(eq(userSteps.id, reminder.userStepId))
                    .limit(1)
                    .for('update')
                )[0]
              : undefined;
            if (
              !reminder ||
              reminder.status !== 'processing' ||
              !profile?.remindersEnabled ||
              !step?.active ||
              !step.current ||
              !step.definitionActive ||
              step.status === 'COMPLETED'
            ) {
              await tx
                .update(outbox)
                .set({ status: 'cancelled', lockedAt: null, updatedAt: now })
                .where(and(eq(outbox.id, item.id), eq(outbox.status, 'processing')));
              if (reminder && reminder.status === 'processing') {
                await tx
                  .update(reminders)
                  .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
                  .where(eq(reminders.id, reminder.id));
              }
              return;
            }
          }
          const [markedSent] = await tx
            .update(outbox)
            .set({ status: 'sent', sentAt: now, lockedAt: null, lastError: null, updatedAt: now })
            .where(and(eq(outbox.id, item.id), eq(outbox.status, 'processing')))
            .returning({ id: outbox.id });
          if (!markedSent) return;
          await tx
            .insert(mockDeliveries)
            .values({ outboxId: item.id, recipient: item.recipient, payload: item.payload })
            .onConflictDoNothing();
          await tx
            .update(reminders)
            .set({ status: 'sent', updatedAt: now })
            .where(and(eq(reminders.outboxId, item.id), eq(reminders.status, 'processing')));
          delivered = true;
        });
        if (delivered) sent += 1;
        continue;
      }
      await this.respectPerRecipientRateLimit(item.recipient);
      try {
        if (item.sourceType === 'reminder') {
          if (await this.deliverReminderWithConsentLock(item, now)) sent += 1;
          continue;
        }
        await this.sendRealPayload(item);
        const deliveredAt = new Date();
        const [markedSent] = await this.db
          .update(outbox)
          .set({ status: 'sent', sentAt: deliveredAt, lockedAt: null, lastError: null, updatedAt: deliveredAt })
          .where(and(eq(outbox.id, item.id), eq(outbox.status, 'processing')))
          .returning({ id: outbox.id });
        if (markedSent) sent += 1;
      } catch (error) {
        await this.recordDeliveryFailure(item, item.attempts + 1, error);
      }
    }
    return sent;
  }

  async recoverStuckJobs(now = new Date()) {
    const stale = new Date(now.getTime() - 5 * 60_000);
    await this.db
      .update(webhookInbox)
      .set({ status: 'pending', lockedAt: null, error: 'Recovered stale inbox lease' })
      .where(and(eq(webhookInbox.status, 'processing'), lte(webhookInbox.lockedAt, stale)));
    if (this.options.maxProvider === 'mock') {
      await this.db
        .update(outbox)
        .set({ status: 'pending', lockedAt: null, lastError: 'Recovered safe mock delivery lease', updatedAt: now })
        .where(and(eq(outbox.status, 'processing'), lte(outbox.lockedAt, stale)));
    } else {
      await this.db.transaction(async (tx) => {
        const recovered = await tx
          .update(outbox)
          .set({ status: 'unknown', lockedAt: null, lastError: 'Ambiguous after worker interruption', updatedAt: now })
          .where(and(eq(outbox.status, 'processing'), lte(outbox.lockedAt, stale)))
          .returning({ id: outbox.id, sourceId: outbox.sourceId, sourceType: outbox.sourceType });
        const recoveredReminders = recovered.filter((item) => item.sourceType === 'reminder');
        const reminderIds = recoveredReminders.map((item) => item.sourceId);
        const reminderOutboxIds = recoveredReminders.map((item) => item.id);
        if (reminderIds.length > 0) {
          await tx
            .update(reminders)
            .set({ status: 'unknown', updatedAt: now })
            .where(
              and(
                inArray(reminders.id, reminderIds),
                inArray(reminders.outboxId, reminderOutboxIds),
                eq(reminders.status, 'processing'),
              ),
            );
        }
      });
    }
  }

  private async deliverReminderWithConsentLock(item: typeof outbox.$inferSelect, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const reminder = (await tx.select().from(reminders).where(eq(reminders.id, item.sourceId)).limit(1))[0];
      const profile = reminder
        ? (
            await tx
              .select({ remindersEnabled: userProfiles.remindersEnabled })
              .from(userProfiles)
              .where(eq(userProfiles.userId, reminder.userId))
              .limit(1)
              .for('update')
          )[0]
        : undefined;
      const step = reminder
        ? (
            await tx
              .select({
                active: userSteps.isActive,
                status: userSteps.status,
                current: routes.isCurrent,
                definitionActive: stepDefinitions.active,
              })
              .from(userSteps)
              .innerJoin(routes, eq(userSteps.routeId, routes.id))
              .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
              .where(eq(userSteps.id, reminder.userStepId))
              .limit(1)
              .for('update')
          )[0]
        : undefined;
      const deliverable =
        reminder?.status === 'processing' &&
        reminder.outboxId === item.id &&
        profile?.remindersEnabled === true &&
        step?.active === true &&
        step.current === true &&
        step.definitionActive === true &&
        step.status !== 'COMPLETED';
      if (!deliverable) {
        await tx
          .update(outbox)
          .set({ status: 'cancelled', lockedAt: null, updatedAt: now })
          .where(and(eq(outbox.id, item.id), eq(outbox.status, 'processing')));
        if (reminder?.status === 'processing') {
          await tx
            .update(reminders)
            .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
            .where(eq(reminders.id, reminder.id));
        }
        return false;
      }
      await this.sendRealPayload(item);
      const deliveredAt = new Date();
      const [markedSent] = await tx
        .update(outbox)
        .set({ status: 'sent', sentAt: deliveredAt, lockedAt: null, lastError: null, updatedAt: deliveredAt })
        .where(and(eq(outbox.id, item.id), eq(outbox.status, 'processing')))
        .returning({ id: outbox.id });
      if (!markedSent) return false;
      await tx
        .update(reminders)
        .set({ status: 'sent', updatedAt: deliveredAt })
        .where(and(eq(reminders.id, reminder.id), eq(reminders.status, 'processing')));
      return true;
    });
  }

  private async sendRealPayload(item: typeof outbox.$inferSelect): Promise<void> {
    if (!this.options.maxClient) throw new MaxTransportError('Real MAX client is not configured', 'permanent');
    const payload = item.payload as {
      kind?: string;
      callbackId?: string;
      notification?: string;
      text?: string;
      fallbackText?: string;
      attachments?: unknown[];
      link?: OutboundMessage['link'];
    };
    if (payload.kind === 'callback_answer' && payload.callbackId) {
      await this.options.maxClient.answerCallback(payload.callbackId, undefined, payload.notification);
      return;
    }
    await this.options.maxClient.sendToUser(item.recipient, {
      text: payload.text ?? '',
      attachments: payload.attachments,
      link: payload.link,
    });
  }

  private async recordDeliveryFailure(item: typeof outbox.$inferSelect, attempts: number, error: unknown) {
    const transportError =
      error instanceof MaxTransportError ? error : new MaxTransportError('Unexpected delivery error', 'ambiguous');
    const isIntroVideo = item.sourceType === 'bot_update' && item.idempotencyKey.endsWith(':intro-video');
    const terminal =
      transportError.kind === 'permanent' || transportError.kind === 'ambiguous' || attempts >= (isIntroVideo ? 8 : 3);
    const status = transportError.kind === 'ambiguous' ? 'unknown' : terminal ? 'failed' : 'pending';
    const backoffMs = transportError.retryAfterMs ?? Math.min(30_000, 2 ** attempts * 1_000 + attempts * 137);
    const updatedAt = new Date();
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(outbox)
        .set({
          status,
          availableAt: new Date(updatedAt.getTime() + backoffMs),
          lockedAt: null,
          lastError: transportError.message.slice(0, 500),
          updatedAt,
        })
        .where(and(eq(outbox.id, item.id), eq(outbox.status, 'processing')))
        .returning({ id: outbox.id });
      if (updated && isIntroVideo && terminal) {
        const payload = item.payload as { fallbackText?: string; attachments?: unknown[] };
        const keyboard = payload.attachments?.filter(
          (attachment) =>
            attachment &&
            typeof attachment === 'object' &&
            'type' in attachment &&
            attachment.type === 'inline_keyboard',
        );
        if (payload.fallbackText && keyboard?.length) {
          await tx
            .insert(outbox)
            .values({
              sourceType: 'bot_update',
              sourceId: item.sourceId,
              recipient: item.recipient,
              payload: { kind: 'message', text: payload.fallbackText, attachments: keyboard },
              idempotencyKey: `bot:${item.sourceId}:intro-video-delivery-fallback`,
            })
            .onConflictDoNothing();
        }
      }
      if (!updated || item.sourceType !== 'reminder' || (status !== 'failed' && status !== 'unknown')) return;
      await tx
        .update(reminders)
        .set({ status, updatedAt })
        .where(
          and(eq(reminders.id, item.sourceId), eq(reminders.outboxId, item.id), eq(reminders.status, 'processing')),
        );
    });
  }

  private async respectPerRecipientRateLimit(recipient: string) {
    const globalDelay = Math.max(0, 34 - (Date.now() - this.lastGlobalDeliveryAt));
    if (globalDelay > 0) await new Promise((resolve) => setTimeout(resolve, globalDelay));
    const last = this.lastDeliveryAt.get(recipient) ?? 0;
    const delay = Math.max(0, 500 - (Date.now() - last));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastGlobalDeliveryAt = Date.now();
    this.lastDeliveryAt.set(recipient, Date.now());
  }
}

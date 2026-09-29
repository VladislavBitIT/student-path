import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  createDatabase,
  stepDefinitions,
  knowledgeUniversities,
  federalOverrides,
  knowledgeImports,
  userSteps,
  reminders,
  userProfiles,
  users,
} from '@first30/database';
import { loadVerifiedRelease } from '@first30/config';
import { RouteService, ApplicationWorker } from '@first30/application';
import { runMigrations } from '../../apps/api/src/migrate.js';
import { runSeed } from '../../apps/api/src/seed.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const connection = createDatabase(url);
const service = new RouteService(connection.db);
const release = loadVerifiedRelease();
const created: string[] = [];

describe('PostgreSQL verified release import', () => {
  beforeAll(async () => {
    await runMigrations(url);
    await runSeed(url, { includeDemoUsers: false });
  }, 30000);
  afterAll(async () => {
    for (const id of created) await connection.db.delete(users).where(eq(users.id, id));
    await connection.close();
  });
  it('stores 10 universities, 122 lossless cards, 42 eligible rules and 2 overrides', async () => {
    expect(await connection.db.select().from(knowledgeUniversities)).toHaveLength(10);
    const definitions = await connection.db
      .select()
      .from(stepDefinitions)
      .where(sql`${stepDefinitions.knowledgeCard} is not null`);
    expect(definitions).toHaveLength(122);
    expect(new Set(definitions.map((d) => d.code)).size).toBe(122);
    for (const c of release.cards) expect(definitions.find((d) => d.code === c.id)?.knowledgeCard, c.id).toEqual(c);
    expect(definitions.filter((d) => d.knowledgeCard?.deadline.reminder_eligible)).toHaveLength(42);
    expect(
      (await connection.db.select().from(federalOverrides))
        .map((o) => o.payload)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([...release.overrides].sort((a, b) => a.id.localeCompare(b.id)));
  });
  it('preserves completion, omitted definitions and manual reminders on repeated import', async () => {
    const user = await service.ensureUser(`release-preserve-${randomUUID()}`, 'ru');
    created.push(user.id);
    await service.onboard(user.id, {
      preferredLanguage: 'ru',
      universityCode: 'ITMO',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'dormitory',
      citizenshipType: 'foreign',
      russiaPresence: 'no',
      housingStatus: 'applied',
      entryMode: 'visa',
      admissionYear: 2026,
    });
    let route = await service.getRoute(user.id);
    const step = route.steps.find((s) => s.code === 'UNI_ITMO_PREARRIVAL_NOTIFY')!;
    expect(step).toBeDefined();
    await service.setStepStatus(user.id, step.code, 'COMPLETED');
    const before = (await connection.db.select().from(userSteps).where(eq(userSteps.id, step.id)))[0]!;
    const [definition] = await connection.db
      .insert(stepDefinitions)
      .values({
        code: `RETAIN_${randomUUID()}`,
        universityCode: 'ITMO',
        stage: 'first_week',
        titleKey: 'route.archived.title',
        descriptionKey: 'route.archived.description',
        whyKey: 'route.archived.why',
        contactKey: 'contact.official.instruction',
        deadlineNoteKey: 'deadline.to_be_confirmed',
        validAsOf: '2026-09-29',
        verificationStatus: 'needs_confirmation',
        sortOrder: 9999,
      })
      .returning();
    await service.recalculateRoute(user.id);
    route = await service.getRoute(user.id);
    const retained = route.steps.find((s) => s.code === definition!.code)!;
    await service.setReminderConsent(user.id, true);
    const manual = await service.createReminder(user.id, retained.code, new Date('2030-10-01T09:00:00Z'));
    const idsBefore = (
      await connection.db
        .select()
        .from(stepDefinitions)
        .where(sql`${stepDefinitions.knowledgeCard} is not null`)
    )
      .map((d) => d.id)
      .sort();
    await runSeed(url, { includeDemoUsers: false });
    await runSeed(url, { includeDemoUsers: false });
    const after = (await connection.db.select().from(userSteps).where(eq(userSteps.id, step.id)))[0]!;
    expect(after.status).toBe('COMPLETED');
    expect(after.completedAt).toEqual(before.completedAt);
    expect((await connection.db.select().from(reminders).where(eq(reminders.id, manual.id)))[0]).toEqual(manual);
    expect(
      (await connection.db.select().from(stepDefinitions).where(eq(stepDefinitions.id, definition!.id)))[0]?.active,
    ).toBe(true);
    expect(
      (
        await connection.db
          .select()
          .from(stepDefinitions)
          .where(sql`${stepDefinitions.knowledgeCard} is not null`)
      )
        .map((d) => d.id)
        .sort(),
    ).toEqual(idsBefore);
    const report = (await connection.db.select().from(knowledgeImports))[0]!.report;
    expect(report.cards).toEqual({ added: 0, updated: 122 });
    expect(report.universities).toEqual({ added: 0, updated: 10 });
    // Remove only this test's catalog fixture after deleting its owning test user.
    await connection.db.delete(users).where(eq(users.id, user.id));
    await connection.db.delete(userSteps).where(eq(userSteps.stepDefinitionId, definition!.id));
    await connection.db.delete(stepDefinitions).where(eq(stepDefinitions.id, definition!.id));
  }, 30000);
  it('requires explicit event date and consent, updates bot/app progress, and cancels an old automatic date', async () => {
    const user = await service.ensureUser(`release-reminder-${randomUUID()}`, 'en');
    created.push(user.id);
    await service.onboard(user.id, {
      preferredLanguage: 'en',
      universityCode: 'ITMO',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'dormitory',
      citizenshipType: 'foreign',
      russiaPresence: 'no',
      housingStatus: 'applied',
      entryMode: 'visa',
    });
    await service.setReminderConsent(user.id, true);
    expect(await connection.db.select().from(reminders).where(eq(reminders.userId, user.id))).toHaveLength(0);
    const code = 'UNI_ITMO_PREARRIVAL_NOTIFY';
    await service.updateKnowledgeContext(user.id, code, { facts: {}, dates: { entry_to_russia: '2030-10-20' } });
    let route = await service.getRoute(user.id);
    expect(route.steps.find((s) => s.code === code)?.deadline).toBe('2030-10-10');
    await service.recalculateRoute(user.id);
    let scheduled = await connection.db.select().from(reminders).where(eq(reminders.userId, user.id));
    expect(scheduled).toHaveLength(1);
    await service.updateKnowledgeContext(user.id, code, { facts: {}, dates: { entry_to_russia: '2030-10-21' } });
    scheduled = await connection.db.select().from(reminders).where(eq(reminders.userId, user.id));
    expect(scheduled.filter((r) => r.status === 'scheduled')).toHaveLength(1);
    expect(scheduled.filter((r) => r.status === 'cancelled')).toHaveLength(1);
    await service.configureReminder(user.id, code, 'off');
    await service.recalculateRoute(user.id);
    await service.setReminderConsent(user.id, false);
    await service.setReminderConsent(user.id, true);
    expect(await service.listReminders(user.id)).toHaveLength(0);
    await service.createReminder(user.id, code, new Date('2030-10-09T10:00:00Z'));
    await service.recalculateRoute(user.id);
    expect(await service.listReminders(user.id)).toEqual([
      { stepCode: code, scheduledFor: new Date('2030-10-09T10:00:00Z') },
    ]);
    await service.configureReminder(user.id, code, 'automatic');
    scheduled = await connection.db.select().from(reminders).where(eq(reminders.userId, user.id));
    expect(scheduled.filter((r) => r.status === 'scheduled')).toHaveLength(1);
    const active = scheduled.find((r) => r.status === 'scheduled')!;
    expect(active.idempotencyKey.startsWith('knowledge:')).toBe(true);
    const worker = new ApplicationWorker(connection.db, {
      maxProvider: 'mock',
      miniAppUrl: 'http://localhost:4173',
      batchSize: 10000,
    });
    await worker.tick(new Date('2030-10-11T08:00:00Z'));
    route = await service.getRoute(user.id);
    expect((await connection.db.select().from(reminders).where(eq(reminders.id, active.id)))[0]?.status).toBe('sent');
    expect(await service.completeReminderStep(user.id, active.id, active.userStepId, route.version)).toBe('completed');
    expect(await service.completeReminderStep(user.id, active.id, active.userStepId, route.version)).toBe('already');
    expect((await service.getRoute(user.id)).steps.find((s) => s.code === code)?.status).toBe('COMPLETED');
    expect(
      (await connection.db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)))[0]?.arrivalDate,
    ).toBeNull();
  }, 30000);
});

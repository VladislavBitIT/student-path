import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  commonKnowledgeDocuments,
  commonSources,
  commonStepDefinitions,
  directoryKnowledgeDocuments,
  directorySources,
  directoryStepDefinitions,
  itmoKnowledgeDocuments,
  itmoSources,
  itmoStepDefinitions,
  loadKnowledgeDemoDefinitions,
  loadVerifiedRelease,
  projectReleaseDefinitions,
} from '@first30/config';
import {
  createDatabase,
  knowledgeDocuments,
  knowledgeUniversities,
  federalOverrides,
  knowledgeImports,
  outbox,
  reminders,
  sources,
  stepDefinitions,
  userProfiles,
  userSteps,
} from '@first30/database';
import { RouteService } from '@first30/application';

export interface SeedOptions {
  includeDemoUsers?: boolean;
}

// Specific verified actions replace these older generic ITMO prompts in published routes.
const supersededItmoSteps = new Set([
  'NOTIFY_PLANNED_ARRIVAL',
  'ARRANGE_DORMITORY',
  'REGISTER_DORM_RESIDENCE',
  'COMPLETE_FIRST_DAYS',
]);

export const productionItmoSteps = itmoStepDefinitions
  .filter((step) => !supersededItmoSteps.has(step.code))
  .map((step) => (step.code === 'ORIENTATION_SUPPORT' ? { ...step, prerequisites: ['ITMO_STUDENT_SERVICES'] } : step));

export async function runSeed(databaseUrl = process.env.DATABASE_URL, options: SeedOptions = {}): Promise<void> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for seed');
  const archive = loadKnowledgeDemoDefinitions();
  const release = loadVerifiedRelease();
  const connection = createDatabase(databaseUrl);
  try {
    await connection.db.transaction(async (db) => {
      await db.execute(sql`select pg_advisory_xact_lock(30092027)`);
      const allSources = [...itmoSources, ...commonSources, ...directorySources, ...archive.sources];
      const baseSteps = [
        ...productionItmoSteps,
        ...commonStepDefinitions,
        ...directoryStepDefinitions,
        ...archive.steps,
      ];
      const releaseSteps = projectReleaseDefinitions(release, baseSteps);
      const releaseIds = new Set(releaseSteps.map((s) => s.code));
      const allSteps = [...baseSteps.filter((s) => !releaseIds.has(s.code)), ...releaseSteps];
      const releaseSources = new Map(release.cards.flatMap((c) => c.sources.map((s) => [s.source_id, s] as const)));
      for (const source of releaseSources.values()) {
        const value = {
          id: source.source_id,
          title: source.title,
          url: source.verified_url,
          authority: source.publisher,
          languages: ['ru'] as const,
          validAsOf: source.checked_on,
          verificationStatus: 'verified' as const,
          metadata: {
            sourceCheckedAt: source.checked_on,
            sourcePublishedAt: null,
            admissionYear: null,
            appliesTo: source.source_status,
            deadlineStatus: 'needs_confirmation' as const,
            partnerStatus: 'directory_public' as const,
            releaseSource: source,
          },
        };
        const index = allSources.findIndex((s) => s.id === source.source_id);
        if (index >= 0) allSources[index] = value;
        else allSources.push(value);
      }
      const oldUniversities = await db.select().from(knowledgeUniversities);
      const oldOverrides = await db.select().from(federalOverrides);
      for (const university of release.universities) {
        const value = {
          universityId: university.university_id,
          universityCode: university.university_id.replace(/^UNIV_/, ''),
          payload: university,
        };
        await db
          .insert(knowledgeUniversities)
          .values(value)
          .onConflictDoUpdate({ target: knowledgeUniversities.universityId, set: { ...value, updatedAt: new Date() } });
      }
      for (const override of release.overrides) {
        await db
          .insert(federalOverrides)
          .values({ id: override.id, payload: override })
          .onConflictDoUpdate({ target: federalOverrides.id, set: { payload: override, updatedAt: new Date() } });
      }
      const existingDefinitions = await db.select().from(stepDefinitions);
      const existingByKey = new Map(existingDefinitions.map((row) => [`${row.universityCode}:${row.code}`, row]));
      const definitionsChanged = allSteps.some((step) => {
        const previous = existingByKey.get(`${step.universityCode ?? 'COMMON'}:${step.code}`);
        return (
          !previous ||
          !previous.active ||
          JSON.stringify([
            previous.stage,
            previous.titleKey,
            previous.descriptionKey,
            previous.whyKey,
            previous.preparationKeys,
            previous.contactKey,
            previous.deadlineNoteKey,
            previous.sourceId,
            previous.validAsOf,
            previous.verificationStatus,
            previous.sortOrder,
            previous.applicability,
            previous.prerequisites,
            previous.deadlineRule,
            previous.attention,
            previous.knowledgeCard,
          ]) !==
            JSON.stringify([
              step.stage,
              step.titleKey,
              step.descriptionKey,
              step.whyImportantKey,
              step.preparationKeys,
              step.contactKey ?? 'contact.official.instruction',
              step.deadlineNoteKey,
              step.sourceId,
              step.validAsOf,
              step.verificationStatus,
              step.sortOrder,
              step.applicability,
              step.prerequisites,
              step.deadlineRule,
              step.attention,
              step.knowledgeCard ?? previous.knowledgeCard,
            ])
        );
      });
      const allDocuments = [...itmoKnowledgeDocuments, ...commonKnowledgeDocuments, ...directoryKnowledgeDocuments];
      for (const source of allSources) {
        const metadata = source.metadata ?? {
          sourceCheckedAt: source.validAsOf,
          sourcePublishedAt: null,
          admissionYear: null,
          appliesTo: 'Проверьте применимость для вашего случая',
          appliesToEn: 'Confirm applicability for your situation',
          deadlineStatus: 'needs_confirmation',
          partnerStatus: 'directory_public',
        };
        await db
          .insert(sources)
          .values({
            id: source.id,
            title: source.title,
            url: source.url,
            authority: source.authority,
            languages: [...source.languages],
            validAsOf: source.validAsOf,
            verificationStatus: source.verificationStatus,
            metadata,
          })
          .onConflictDoUpdate({
            target: sources.id,
            set: {
              title: source.title,
              url: source.url,
              authority: source.authority,
              languages: [...source.languages],
              validAsOf: source.validAsOf,
              verificationStatus: source.verificationStatus,
              metadata,
              updatedAt: new Date(),
            },
          });
      }
      for (const step of allSteps) {
        await db
          .insert(stepDefinitions)
          .values({
            code: step.code,
            universityCode: step.universityCode ?? 'COMMON',
            stage: step.stage,
            titleKey: step.titleKey,
            descriptionKey: step.descriptionKey,
            whyKey: step.whyImportantKey,
            preparationKeys: [...step.preparationKeys],
            contactKey: step.contactKey ?? 'contact.official.instruction',
            deadlineNoteKey: step.deadlineNoteKey,
            sourceId: step.sourceId,
            validAsOf: step.validAsOf,
            verificationStatus: step.verificationStatus,
            sortOrder: step.sortOrder,
            applicability: { ...step.applicability } as Record<string, unknown>,
            prerequisites: [...step.prerequisites],
            deadlineRule: step.deadlineRule ? ({ ...step.deadlineRule } as Record<string, unknown>) : null,
            attention: step.attention,
            active: true,
            knowledgeCard: step.knowledgeCard ?? null,
          })
          .onConflictDoUpdate({
            target: [stepDefinitions.universityCode, stepDefinitions.code],
            set: {
              stage: step.stage,
              titleKey: step.titleKey,
              descriptionKey: step.descriptionKey,
              whyKey: step.whyImportantKey,
              preparationKeys: [...step.preparationKeys],
              contactKey: step.contactKey ?? 'contact.official.instruction',
              deadlineNoteKey: step.deadlineNoteKey,
              sourceId: step.sourceId,
              validAsOf: step.validAsOf,
              verificationStatus: step.verificationStatus,
              sortOrder: step.sortOrder,
              applicability: { ...step.applicability } as Record<string, unknown>,
              prerequisites: [...step.prerequisites],
              deadlineRule: step.deadlineRule ? ({ ...step.deadlineRule } as Record<string, unknown>) : null,
              attention: step.attention,
              ...(step.knowledgeCard ? { knowledgeCard: step.knowledgeCard } : {}),
              active: true,
              updatedAt: new Date(),
            },
          });
      }

      // Only the pre-existing, explicit ITMO replacements are retired. An omitted
      // release record is retained until a separately reviewed content migration.
      await db
        .update(stepDefinitions)
        .set({ active: false })
        .where(
          and(eq(stepDefinitions.universityCode, 'ITMO'), inArray(stepDefinitions.code, [...supersededItmoSteps])),
        );

      const withdrawnUserSteps = await db
        .select({ id: userSteps.id })
        .from(userSteps)
        .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
        .where(and(eq(stepDefinitions.active, false), eq(userSteps.isActive, true)));
      const withdrawnUserStepIds = withdrawnUserSteps.map((step) => step.id);
      if (withdrawnUserStepIds.length > 0) {
        const now = new Date();
        await db
          .update(userSteps)
          .set({ isActive: false, updatedAt: now })
          .where(inArray(userSteps.id, withdrawnUserStepIds));
        const withdrawnReminders = await db
          .select({ id: reminders.id, outboxId: reminders.outboxId })
          .from(reminders)
          .where(
            and(
              inArray(reminders.userStepId, withdrawnUserStepIds),
              inArray(reminders.status, ['scheduled', 'processing']),
            ),
          );
        if (withdrawnReminders.length > 0) {
          await db
            .update(reminders)
            .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
            .where(
              inArray(
                reminders.id,
                withdrawnReminders.map((reminder) => reminder.id),
              ),
            );
          const outboxIds = withdrawnReminders.flatMap((reminder) => (reminder.outboxId ? [reminder.outboxId] : []));
          if (outboxIds.length > 0) {
            await db
              .update(outbox)
              .set({ status: 'cancelled', lockedAt: null, updatedAt: now })
              .where(and(inArray(outbox.id, outboxIds), inArray(outbox.status, ['pending', 'processing'])));
          }
        }
      }
      for (const document of allDocuments) {
        await db
          .insert(knowledgeDocuments)
          .values({
            id: document.id,
            title: document.title,
            content: document.content,
            sourceId: document.sourceId,
            language: document.language,
            tags: [...document.tags],
            active: true,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: knowledgeDocuments.id,
            set: {
              title: document.title,
              content: document.content,
              sourceId: document.sourceId,
              language: document.language,
              tags: [...document.tags],
              active: true,
              updatedAt: new Date(),
            },
          });
      }

      // Preserve the existing assistant-document lifecycle; this does not retire
      // imported cards or delete any stored documents/user data.
      await db
        .update(knowledgeDocuments)
        .set({ active: false, updatedAt: new Date() })
        .where(
          notInArray(
            knowledgeDocuments.id,
            allDocuments.map((d) => d.id),
          ),
        );

      const service = new RouteService(db as unknown as import('@first30/database').Database);
      const productionLike = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
      const includeDemoUsers = options.includeDemoUsers ?? !productionLike;
      if (includeDemoUsers) {
        const cleanDemo = await service.ensureUser('dev-student-clean', 'ru');
        if (cleanDemo.preferredLanguage !== 'ru') await service.updateLanguage(cleanDemo.id, 'ru');
        const completedDemo = await service.ensureUser('dev-student-completed', 'ru');
        if (completedDemo.preferredLanguage !== 'ru') await service.updateLanguage(completedDemo.id, 'ru');
        if (!(await service.getProfile(completedDemo.id)).profile) {
          await service.onboard(completedDemo.id, {
            preferredLanguage: 'ru',
            universityCode: 'ITMO',
            arrivalStatus: 'preparing',
            arrivalDate: null,
            accommodationType: 'dormitory',
          });
        }
        const completedRoute = await service.getRoute(completedDemo.id);
        const completedStep = completedRoute.steps.find((step) => step.status === 'COMPLETED');
        if (!completedStep && completedRoute.steps[0]) {
          await service.setStepStatus(completedDemo.id, completedRoute.steps[0].code, 'COMPLETED');
        }
      }

      if (definitionsChanged) {
        const profiles = await db.select({ userId: userProfiles.userId }).from(userProfiles);
        for (const profile of profiles) {
          await service.recalculateRoute(profile.userId);
        }
      }
      const activeDefinitions = await db
        .select({ code: stepDefinitions.code })
        .from(stepDefinitions)
        .where(eq(stepDefinitions.active, true));
      const report = {
        universities: {
          added: release.universities.filter((u) => !oldUniversities.some((o) => o.universityId === u.university_id))
            .length,
          updated: release.universities.filter((u) => oldUniversities.some((o) => o.universityId === u.university_id))
            .length,
        },
        cards: {
          added: releaseSteps.filter((s) => !existingByKey.has(`${s.universityCode}:${s.code}`)).length,
          updated: releaseSteps.filter((s) => existingByKey.has(`${s.universityCode}:${s.code}`)).length,
        },
        federalOverrides: {
          added: release.overrides.filter((o) => !oldOverrides.some((p) => p.id === o.id)).length,
          updated: release.overrides.filter((o) => oldOverrides.some((p) => p.id === o.id)).length,
        },
        reminderEligibleCards: release.cards.filter((c) => c.deadline.reminder_eligible && c.deadline.machine_rule)
          .length,
        validation: release.validation,
      };
      await db
        .insert(knowledgeImports)
        .values({ checksum: release.checksum, report })
        .onConflictDoUpdate({ target: knowledgeImports.checksum, set: { report, importedAt: new Date() } });
      console.info('Knowledge import:', JSON.stringify({ ...report, validation: { valid: true, errors: [] } }));
      console.info(
        `Seed completed: ${allSources.length} sources, ${activeDefinitions.length} steps, ${allDocuments.length} active knowledge documents, demo users ${includeDemoUsers ? 'enabled' : 'disabled'}`,
      );
    });
  } finally {
    await connection.close();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  runSeed().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Seed failed');
    process.exitCode = 1;
  });
}

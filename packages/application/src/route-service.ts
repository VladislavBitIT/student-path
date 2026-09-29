import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, ne, notInArray } from 'drizzle-orm';
import type { Database } from '@first30/database';
import {
  eventCandidates,
  events,
  feedback,
  knowledgeDocuments,
  federalOverrides,
  mockDeliveries,
  outbox,
  reminders,
  routes,
  sources,
  stepDefinitions,
  users,
  userProfiles,
  userSteps,
} from '@first30/database';
import {
  answerFromKnowledge,
  calculateReleaseSchedule,
  applyFederalPublicationPolicy,
  evaluateKnowledgeCondition,
  releaseContext,
  releaseReminderTime,
  releasePublicCard,
  releaseInputFields,
  validReleaseDate,
  isStepApplicable,
  isValidIsoDate,
  NoneLlmAdapter,
  reconcileRoute,
  toDateOnlyInTimezone,
  validateGroundedAnswerResult,
  type AccommodationType,
  type CitizenshipType,
  type EntryMode,
  type ProgramLevel,
  type RussiaPresence,
  type EnrollmentState,
  type HousingStatus,
  type Language,
  type KnowledgeFactValue,
  type LlmAdapter,
  type MilitaryStatus,
  type MobilityStatus,
  type PreviousRouteStep,
  type RouteDiff,
  type StepDefinition,
  type UserProfile,
} from '@first30/domain';
import {
  getUniversityConfig,
  itmoUniversityConfig,
  loadKnowledgeRouteCatalog,
  matchArchiveCampus,
  releaseInputLabels,
  matchArchiveCitizenshipCountry,
  universityActionSteps,
  universityDirectory,
} from '@first30/config';
import { t } from '@first30/i18n';
import { AppError, assertFound } from './errors.js';

type Executor = Database;

export interface OnboardingInput {
  preferredLanguage: Language;
  universityCode: string;
  universityName?: string | null;
  citizenshipCountry?: string | null;
  specialStatus?: string;
  housingChoice?: string;
  arrivalStatus: 'preparing' | 'arrived';
  arrivalDate: string | null;
  accommodationType: AccommodationType;
  enrollmentState?: EnrollmentState;
  citizenshipType?: CitizenshipType;
  entryMode?: EntryMode;
  russiaPresence?: RussiaPresence;
  studyArrival?: RussiaPresence;
  russiaEntryDate?: string | null;
  programLevel?: ProgramLevel;
  mobilityStatus?: MobilityStatus;
  housingStatus?: HousingStatus;
  campusCode?: string | null;
  facultyCode?: string | null;
  militaryStatus?: MilitaryStatus;
  admissionYear?: number | null;
}

interface RouteRecalculation {
  routeId: string;
  diff: RouteDiff;
}

interface RouteDrivingSnapshot {
  universityCode: string;
  arrivalStatus: 'preparing' | 'arrived';
  arrivalDate: string | null;
  accommodationType: AccommodationType;
  attributesJson: string;
}

const russianSourceTitles: Readonly<Record<string, string>> = {
  itmo_arrival_guide: 'Памятка ИТМО о приезде первокурсников',
  itmo_migration_documents: 'Важные документы',
  itmo_migration_documents_ru: 'Миграционные документы',
  itmo_international_contacts: 'Контакты ИТМО',
  itmo_dorm_booking: 'Заселение в общежитие',
  itmo_housing: 'Общежития и жильё',
  itmo_student_services: 'Студенческий отдел ИТМО',
  itmo_buddy: 'Помощь студентов-наставников',
  rf_migration_law_109: 'Федеральный закон № 109-ФЗ',
};

function safeProfileValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' ? allowed.find((item) => item === value) : undefined;
}

/** Small cross-script topic bridge; source ownership checks still happen before this selection. */
function multilingualTopicTerms(question: string): readonly string[] {
  const terms: string[] = [];
  if (
    /миграц|регистрац|виза|migration|registration|visa|प्रवास|पंजीकरण|वीज़ा|वीजा|هجر|تسجيل|تأشير|көші-қон|тіркеу|viza|migrats|registrats|migrasiýa|签证|登记/iu.test(
      question,
    )
  )
    terms.push('миграц', 'регистрац', 'migration', 'registration', 'visa');
  if (
    /общежит|жиль|dormitory|housing|छात्रावास|आवास|سكن|مسكن|жатақхана|тұрғын|yotoqxona|turar joy|ýaşaýyş jaý|宿舍|住宿/iu.test(
      question,
    )
  )
    terms.push('общежит', 'жиль', 'dormitory', 'housing');
  if (/документ|document|दस्तावेज|कागज़|وثائق|مستند|құжат|hujjat|resminama|文件|材料/iu.test(question))
    terms.push('документ', 'document');
  if (
    /зачисл|поступлен|admission|enrollment|प्रवेश|नामांकन|قبول|التحاق|қабылдау|o‘qishga kirish|kabul etmek|入学|录取/iu.test(
      question,
    )
  )
    terms.push('зачисл', 'admission', 'enrollment');
  return terms;
}

function localizedSource<T extends { id: string; title: string; authority: string }>(language: Language, source: T): T {
  if (language !== 'ru') return source;
  if (!source.id.startsWith('itmo_') && !source.id.startsWith('rf_')) return source;
  return {
    ...source,
    title: russianSourceTitles[source.id] ?? source.title,
    authority: source.id.startsWith('rf_') ? 'Правительство Российской Федерации' : 'ИТМО',
  };
}

function routeDrivingSnapshot(profile: typeof userProfiles.$inferSelect): RouteDrivingSnapshot {
  return {
    universityCode: profile.universityCode,
    arrivalStatus: profile.arrivalStatus,
    arrivalDate: profile.arrivalDate,
    accommodationType: profile.accommodationType,
    attributesJson: JSON.stringify(profile.attributes ?? {}),
  };
}

function sameSnapshot(left: Record<string, unknown>, right: RouteDrivingSnapshot): boolean {
  return (
    left.universityCode === right.universityCode &&
    left.arrivalStatus === right.arrivalStatus &&
    (left.arrivalDate ?? null) === right.arrivalDate &&
    left.accommodationType === right.accommodationType &&
    left.attributesJson === right.attributesJson
  );
}

async function cancelOutstandingReminders(db: Executor, stepIds: string[], now: Date): Promise<void> {
  if (stepIds.length === 0) return;
  const pending = await db
    .select({ id: reminders.id, outboxId: reminders.outboxId })
    .from(reminders)
    .where(and(inArray(reminders.userStepId, stepIds), inArray(reminders.status, ['scheduled', 'processing'])));
  if (pending.length === 0) return;
  await db
    .update(reminders)
    .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(
      inArray(
        reminders.id,
        pending.map((item) => item.id),
      ),
    );
  const outboxIds = pending.flatMap((item) => (item.outboxId ? [item.outboxId] : []));
  if (outboxIds.length > 0) {
    await db
      .update(outbox)
      .set({ status: 'cancelled', lockedAt: null, updatedAt: now })
      .where(and(inArray(outbox.id, outboxIds), inArray(outbox.status, ['pending', 'processing'])));
  }
}

function asDefinition(row: typeof stepDefinitions.$inferSelect): StepDefinition {
  const deadlineRule = row.deadlineRule as StepDefinition['deadlineRule'];
  return {
    code: row.code,
    knowledgeCard: row.knowledgeCard,
    universityCode: row.universityCode === 'COMMON' ? null : row.universityCode,
    stage: row.stage as StepDefinition['stage'],
    titleKey: row.titleKey,
    descriptionKey: row.descriptionKey,
    whyImportantKey: row.whyKey,
    preparationKeys: row.preparationKeys,
    contactKey: row.contactKey,
    sourceId: row.sourceId,
    validAsOf: row.validAsOf,
    verificationStatus: row.verificationStatus,
    sortOrder: row.sortOrder,
    prerequisites: row.prerequisites,
    applicability: row.applicability as StepDefinition['applicability'],
    deadlineRule,
    deadlineNoteKey: row.deadlineNoteKey,
    attention: row.attention === 'high' ? 'high' : 'normal',
  };
}

function asProfile(row: typeof userProfiles.$inferSelect): UserProfile {
  const attributes = row.attributes ?? {};
  const modernJourney = attributes.journeyVersion === 'city_v1';
  const mobility = attributes.mobilityStatus;
  const arrivalStatus = modernJourney
    ? row.arrivalStatus
    : mobility === 'local' || mobility === 'moved'
      ? 'arrived'
      : 'preparing';
  const russiaPresence: RussiaPresence = modernJourney
    ? (safeProfileValue(attributes.russiaPresence, ['yes', 'no', 'unknown']) ?? 'unknown')
    : attributes.citizenshipType === 'rf' ||
        mobility === 'local' ||
        mobility === 'moved' ||
        row.arrivalStatus === 'arrived' ||
        attributes.entryMode === 'already_in_russia'
      ? 'yes'
      : 'unknown';
  const profile: UserProfile = {
    userId: row.userId,
    universityCode: row.universityCode,
    arrivalStatus,
    arrivalDate: modernJourney ? row.arrivalDate : null,
    accommodationType: row.accommodationType,
    countryOrRegion: row.countryOrRegion,
    ageGroup: row.ageGroup as UserProfile['ageGroup'],
    remindersEnabled: row.remindersEnabled,
    attributes: { ...attributes, russiaPresence } as UserProfile['attributes'],
  };
  return { ...profile, knowledgeFacts: archiveFactsFromProfile(profile) };
}

/** Only answers with an unambiguous equivalent enter the archive's three-valued predicates. */
function archiveFactsFromProfile(profile: UserProfile): Record<string, KnowledgeFactValue> {
  const attributes = profile.attributes ?? {};
  const facts: Record<string, KnowledgeFactValue> = {};
  if (attributes.citizenshipType === 'foreign') facts.foreign_person = true;
  if (attributes.citizenshipType === 'rf') facts.foreign_person = false;
  const country = matchArchiveCitizenshipCountry(profile.countryOrRegion);
  if (country) facts.citizenship_country = country;
  if (attributes.russiaPresence === 'yes') facts.is_in_russia = true;
  if (attributes.russiaPresence === 'no') facts.is_in_russia = false;
  if (attributes.citizenshipType === 'foreign' && attributes.russiaPresence === 'no')
    facts.plans_study_entry = attributes.studyArrival !== 'yes';
  if (attributes.entryMode === 'visa_free') facts.visa_free_entry = true;
  if (attributes.entryMode === 'visa') facts.visa_free_entry = false;
  const accommodation =
    profile.accommodationType === 'dormitory'
      ? 'dormitory'
      : profile.accommodationType === 'private' || profile.accommodationType === 'relatives'
        ? 'private_home'
        : attributes.housingChoice === 'hotel'
          ? 'hotel'
          : null;
  if (accommodation) facts.accommodation_type = accommodation;
  if (profile.accommodationType === 'relatives') facts.host_is_relative_or_friend = true;
  if (profile.arrivalStatus === 'arrived' && profile.arrivalDate && isValidIsoDate(profile.arrivalDate)) {
    facts.arrival_on = profile.arrivalDate;
  }
  if (typeof attributes.russiaEntryDate === 'string' && isValidIsoDate(attributes.russiaEntryDate)) {
    facts.entry_on = attributes.russiaEntryDate;
    facts.entry_at = `${attributes.russiaEntryDate}T12:00:00Z`;
  }
  const campus = matchArchiveCampus(profile.universityCode, String(attributes.campusCode ?? ''));
  if (campus) facts[`${profile.universityCode.toLowerCase()}_campus`] = campus;
  if (profile.universityCode === 'ITMO') {
    if (attributes.housingStatus === 'applied' && profile.accommodationType === 'dormitory') {
      facts.itmo_needs_dorm = true;
    }
    if (typeof attributes.admissionYear === 'number') facts.itmo_admission_year = attributes.admissionYear;
    if (attributes.programLevel === 'masters') facts.itmo_study_level = 'master';
    if (attributes.programLevel === 'postgraduate') facts.itmo_study_level = 'phd';
  }
  if (profile.universityCode === 'HSE') {
    if (attributes.programLevel === 'masters' || attributes.programLevel === 'bachelor_specialist') {
      facts.hse_not_phd = true;
    }
    if (attributes.programLevel === 'postgraduate') facts.hse_not_phd = false;
  }
  if (typeof attributes.admissionYear === 'number') facts.campaign_year = attributes.admissionYear;
  return facts;
}

async function recalculateRouteInTransaction(db: Executor, userId: string, now: Date): Promise<RouteRecalculation> {
  const profileRow = assertFound(
    (await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1))[0],
    'PROFILE_REQUIRED',
    'Сначала ответьте на вопросы анкеты',
  );
  let route = (
    await db
      .select()
      .from(routes)
      .where(
        and(
          eq(routes.userId, userId),
          eq(routes.universityCode, profileRow.universityCode),
          eq(routes.isCurrent, true),
        ),
      )
      .limit(1)
  )[0];
  if (!route) {
    route = (
      await db
        .select()
        .from(routes)
        .where(and(eq(routes.userId, userId), eq(routes.universityCode, profileRow.universityCode)))
        .orderBy(desc(routes.createdAt))
        .limit(1)
    )[0];
    if (route) {
      [route] = await db
        .update(routes)
        .set({ isCurrent: true, updatedAt: now })
        .where(eq(routes.id, route.id))
        .returning();
    }
  }
  if (!route) {
    route = (
      await db
        .insert(routes)
        .values({ userId, universityCode: profileRow.universityCode, version: 0, isCurrent: true })
        .onConflictDoNothing()
        .returning()
    )[0];
    route ??= (
      await db
        .select()
        .from(routes)
        .where(
          and(
            eq(routes.userId, userId),
            eq(routes.universityCode, profileRow.universityCode),
            eq(routes.isCurrent, true),
          ),
        )
        .limit(1)
    )[0];
  }
  const currentRoute = assertFound(route, 'ROUTE_CREATE_FAILED', 'Не удалось создать маршрут');

  const definitions = await db
    .select()
    .from(stepDefinitions)
    .where(
      and(
        inArray(stepDefinitions.universityCode, ['COMMON', profileRow.universityCode]),
        eq(stepDefinitions.active, true),
      ),
    );
  const existing = await db
    .select({ step: userSteps, definition: stepDefinitions })
    .from(userSteps)
    .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
    .where(eq(userSteps.routeId, currentRoute.id));
  const previous: PreviousRouteStep[] = existing.map(({ step, definition }) => ({
    code: definition.code,
    status: step.status,
    isActive: step.isActive,
    completedAt: step.completedAt?.toISOString() ?? null,
    deadline: step.deadline,
  }));
  const result = reconcileRoute({
    profile: asProfile(profileRow),
    university: getUniversityConfig(profileRow.universityCode) ?? itmoUniversityConfig,
    stepDefinitions: definitions.map(asDefinition),
    previousSteps: previous,
    previousVersion: currentRoute.version,
    now,
  });
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  for (const step of result.steps) {
    const definition = definitionByCode.get(step.code);
    if (!definition) continue;
    await db
      .insert(userSteps)
      .values({
        routeId: currentRoute.id,
        stepDefinitionId: definition.id,
        status: step.status,
        isActive: step.isActive,
        completedAt: step.completedAt ? new Date(step.completedAt) : null,
        deadline: step.deadline,
        deadlineNoteKey: step.deadlineNoteKey,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userSteps.routeId, userSteps.stepDefinitionId],
        set: {
          isActive: step.isActive,
          deadline: step.deadline,
          deadlineNoteKey: step.deadlineNoteKey,
          updatedAt: now,
        },
      });
  }
  const activeDefinitionIds = definitions.map((definition) => definition.id);
  if (activeDefinitionIds.length > 0) {
    await db
      .update(userSteps)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(userSteps.routeId, currentRoute.id),
          notInArray(userSteps.stepDefinitionId, activeDefinitionIds),
          eq(userSteps.isActive, true),
        ),
      );
  } else {
    await db
      .update(userSteps)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(userSteps.routeId, currentRoute.id), eq(userSteps.isActive, true)));
  }
  const inactiveStepIds = (
    await db
      .select({ id: userSteps.id })
      .from(userSteps)
      .where(and(eq(userSteps.routeId, currentRoute.id), eq(userSteps.isActive, false)))
  ).map((item) => item.id);
  await cancelOutstandingReminders(db, inactiveStepIds, now);
  if (result.diff.hasMeaningfulChanges) {
    await db
      .update(routes)
      .set({ version: result.suggestedVersion, updatedAt: now })
      .where(eq(routes.id, currentRoute.id));
  }
  if (profileRow.remindersEnabled) {
    const persisted = await db.select().from(userSteps).where(eq(userSteps.routeId, currentRoute.id));
    for (const item of persisted) {
      const definition = definitions.find((d) => d.id === item.stepDefinitionId);
      const card = definition?.knowledgeCard;
      if (!card) continue;
      const reminderModes = (profileRow.attributes.reminderModes ?? {}) as Record<string, string>;
      if (reminderModes[item.id]) continue;
      const context = {
        ...releaseContext(card, asProfile(profileRow)),
        overrides: definition?.applicability.releaseOverrides as
          import('@first30/domain').FederalOverride[] | undefined,
      };
      const schedule = calculateReleaseSchedule(card, context);
      const timezone = (getUniversityConfig(profileRow.universityCode) ?? itmoUniversityConfig).timezone;
      const desired =
        item.isActive && item.status !== 'COMPLETED' && schedule.reminderOn
          ? [
              ...new Set(
                schedule.dueAt
                  ? [schedule.dueAt]
                  : [schedule.reminderOn, schedule.dueOn]
                      .filter((date): date is string => Boolean(date))
                      .map((date) => releaseReminderTime(date, timezone)),
              ),
            ]
          : [];
      const keys = new Set(desired.map((at) => `knowledge:${userId}:${item.id}:${at}`));
      const old = await db
        .select()
        .from(reminders)
        .where(and(eq(reminders.userStepId, item.id), inArray(reminders.status, ['scheduled', 'processing'])));
      for (const reminder of old.filter(
        (r) => r.idempotencyKey.startsWith('knowledge:') && !keys.has(r.idempotencyKey),
      )) {
        await db
          .update(reminders)
          .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
          .where(eq(reminders.id, reminder.id));
        if (reminder.outboxId)
          await db
            .update(outbox)
            .set({ status: 'cancelled', lockedAt: null, updatedAt: now })
            .where(and(eq(outbox.id, reminder.outboxId), inArray(outbox.status, ['pending', 'processing'])));
      }
      for (const at of desired)
        if (new Date(at) > now) {
          await db
            .insert(reminders)
            .values({
              userId,
              userStepId: item.id,
              scheduledFor: new Date(at),
              idempotencyKey: `knowledge:${userId}:${item.id}:${at}`,
            })
            .onConflictDoUpdate({
              target: reminders.idempotencyKey,
              set: { status: 'scheduled', cancelledAt: null, outboxId: null, updatedAt: now },
              setWhere: eq(reminders.status, 'cancelled'),
            });
        }
    }
  }
  return { routeId: currentRoute.id, diff: result.diff };
}

export class RouteService {
  constructor(
    private readonly db: Database,
    private readonly llmAdapter: LlmAdapter = new NoneLlmAdapter(),
  ) {}

  async ensureUser(maxUserId: string, preferredLanguage: Language = 'ru') {
    const [user] = await this.db
      .insert(users)
      .values({ maxUserId, preferredLanguage })
      .onConflictDoUpdate({ target: users.maxUserId, set: { updatedAt: new Date() } })
      .returning();
    return assertFound(user, 'USER_CREATE_FAILED', 'Не удалось создать пользователя');
  }

  async getProfile(userId: string) {
    const row = (
      await this.db
        .select({ user: users, profile: userProfiles })
        .from(users)
        .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
        .where(eq(users.id, userId))
        .limit(1)
    )[0];
    if (!row) throw new AppError(404, 'USER_NOT_FOUND', 'Пользователь не найден');
    return { user: row.user, profile: row.profile };
  }

  async getPublicProfile(userId: string) {
    const { user, profile } = await this.getProfile(userId);
    if (!profile) return { user, profile: null };
    const effective = asProfile(profile);
    return {
      user,
      profile: {
        ...profile,
        arrivalStatus: effective.arrivalStatus,
        arrivalDate: effective.arrivalDate,
        attributes: {
          ...effective.attributes,
          ...(profile.attributes?.journeyVersion === 'city_v1'
            ? {}
            : { legacyArrivalDate: profile.attributes?.legacyArrivalDate ?? profile.arrivalDate }),
        },
      },
    };
  }

  async updateLanguage(userId: string, language: Language) {
    const [user] = await this.db
      .update(users)
      .set({ preferredLanguage: language, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return assertFound(user);
  }

  async onboard(userId: string, input: OnboardingInput, now = new Date(), confirmRestart = false) {
    if (input.studyArrival === 'no' && input.citizenshipType === 'foreign' && input.arrivalStatus === 'arrived')
      throw new AppError(422, 'INCONSISTENT_LOCATION', 'Уточните факт приезда для учёбы');
    if (
      input.russiaPresence &&
      ((input.mobilityStatus === 'moving' && input.arrivalStatus === 'arrived') ||
        (['local', 'moved'].includes(input.mobilityStatus ?? '') && input.arrivalStatus === 'preparing'))
    )
      throw new AppError(422, 'INCONSISTENT_LOCATION', 'Переезд и приезд в город учёбы противоречат друг другу');
    const university = getUniversityConfig(input.universityCode);
    if (!university) throw new AppError(422, 'UNIVERSITY_NOT_SUPPORTED', 'Выберите университет из справочника');
    if (input.universityCode === 'OTHER' && (!input.universityName || input.universityName.trim().length < 2)) {
      throw new AppError(422, 'UNIVERSITY_NAME_REQUIRED', 'Укажите название университета');
    }
    const directoryEntry = universityDirectory.find((entry) => entry.code === input.universityCode);
    const campusCode = input.campusCode ?? (directoryEntry?.campuses.length === 1 ? 'main' : null);
    if (directoryEntry && campusCode && !directoryEntry.campuses.some((campus) => campus.code === campusCode)) {
      throw new AppError(422, 'CAMPUS_NOT_SUPPORTED', 'Выберите кампус из справочника');
    }
    if (directoryEntry && directoryEntry.campuses.length > 1 && !campusCode) {
      throw new AppError(422, 'CAMPUS_REQUIRED', 'Уточните кампус или выберите «Филиал — уточню»');
    }
    if (
      input.facultyCode &&
      input.universityCode === 'MSU' &&
      !['msu_econ', 'msu_soil', 'other', 'unknown'].includes(input.facultyCode)
    ) {
      throw new AppError(422, 'FACULTY_NOT_SUPPORTED', 'Выберите факультет МГУ из списка');
    }
    if (
      input.facultyCode &&
      input.universityCode === 'TSU' &&
      !['tsu_law', 'other', 'unknown'].includes(input.facultyCode)
    ) {
      throw new AppError(422, 'FACULTY_NOT_SUPPORTED', 'Выберите факультет ТГУ из списка');
    }
    const housingStatus: HousingStatus =
      input.accommodationType === 'private' || input.accommodationType === 'relatives'
        ? input.accommodationType
        : (input.housingStatus ?? 'unknown');
    let recalc!: RouteRecalculation;
    await this.db.transaction(async (tx) => {
      const existingProfile = (
        await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1).for('update')
      )[0];
      const attributes = {
        ...existingProfile?.attributes,
        ...(input.russiaPresence
          ? {
              journeyVersion: 'city_v1',
              russiaPresence: input.citizenshipType === 'rf' ? 'yes' : input.russiaPresence,
              studyArrival: input.citizenshipType === 'foreign' ? (input.studyArrival ?? 'unknown') : null,
              russiaEntryDate: input.citizenshipType === 'foreign' ? (input.russiaEntryDate ?? null) : null,
              legacyArrivalDate:
                existingProfile?.attributes?.journeyVersion === 'city_v1'
                  ? (existingProfile.attributes.legacyArrivalDate ?? null)
                  : (existingProfile?.attributes?.legacyArrivalDate ?? existingProfile?.arrivalDate ?? null),
            }
          : { legacyRouteReconciled: true }),
        universityName:
          input.universityCode === 'OTHER'
            ? (input.universityName ?? existingProfile?.attributes?.universityName ?? null)
            : null,
        specialStatus:
          input.citizenshipType === 'rf'
            ? null
            : (input.specialStatus ?? existingProfile?.attributes?.specialStatus ?? 'unknown'),
        housingChoice:
          input.housingChoice ??
          (input.accommodationType === 'unknown'
            ? (existingProfile?.attributes?.housingChoice ?? 'unknown')
            : input.accommodationType),
        enrollmentState: input.enrollmentState ?? 'admitted',
        citizenshipType: input.citizenshipType ?? (input.universityCode === 'ITMO' ? 'foreign' : 'unknown'),
        entryMode: input.entryMode ?? 'unknown',
        programLevel: input.programLevel ?? 'unknown',
        mobilityStatus: input.mobilityStatus ?? 'unknown',
        housingStatus,
        campusCode,
        facultyCode:
          input.universityCode === 'MSU' || input.universityCode === 'TSU' ? (input.facultyCode ?? null) : null,
        militaryStatus: input.militaryStatus ?? 'unknown',
        admissionYear: input.admissionYear ?? null,
      };
      if (existingProfile && !confirmRestart) {
        throw new AppError(
          409,
          'ONBOARDING_RESTART_CONFIRMATION_REQUIRED',
          'План уже создан. Чтобы заполнить анкету заново, нужно отдельное подтверждение',
        );
      }
      await tx
        .update(users)
        .set({ preferredLanguage: input.preferredLanguage, updatedAt: now })
        .where(eq(users.id, userId));
      if (existingProfile && existingProfile.universityCode !== input.universityCode) {
        const retiredRoutes = await tx
          .select({ id: routes.id })
          .from(routes)
          .where(and(eq(routes.userId, userId), eq(routes.isCurrent, true)));
        if (retiredRoutes.length > 0) {
          const oldRouteIds = retiredRoutes.map((route) => route.id);
          const pendingSteps = await tx
            .select({ id: userSteps.id })
            .from(userSteps)
            .where(inArray(userSteps.routeId, oldRouteIds));
          await cancelOutstandingReminders(
            tx as unknown as Database,
            pendingSteps.map((step) => step.id),
            now,
          );
          await tx.update(routes).set({ isCurrent: false, updatedAt: now }).where(inArray(routes.id, oldRouteIds));
        }
      }
      await tx
        .insert(userProfiles)
        .values({
          userId,
          universityCode: input.universityCode,
          arrivalStatus: input.arrivalStatus,
          arrivalDate: input.arrivalDate,
          countryOrRegion: input.citizenshipCountry ?? existingProfile?.countryOrRegion ?? null,
          accommodationType: input.accommodationType,
          attributes,
          remindersEnabled: false,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: {
            universityCode: input.universityCode,
            arrivalStatus: input.arrivalStatus,
            arrivalDate: input.arrivalDate,
            countryOrRegion: input.citizenshipCountry ?? existingProfile?.countryOrRegion ?? null,
            accommodationType: input.accommodationType,
            attributes,
            updatedAt: now,
          },
        });
      recalc = await recalculateRouteInTransaction(tx as unknown as Database, userId, now);
    });
    return { route: await this.getRoute(userId), diff: recalc.diff };
  }

  async getRoute(userId: string) {
    let { user, profile } = await this.getProfile(userId);
    if (!profile) throw new AppError(404, 'ROUTE_NOT_READY', 'Маршрут ещё не создан');
    if (profile.attributes?.journeyVersion !== 'city_v1' && profile.attributes?.legacyRouteReconciled !== true) {
      await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
          .limit(1)
          .for('update');
        if (
          !locked ||
          locked.attributes?.journeyVersion === 'city_v1' ||
          locked.attributes?.legacyRouteReconciled === true
        )
          return;
        await tx
          .update(userProfiles)
          .set({
            attributes: {
              ...locked.attributes,
              legacyArrivalDate: locked.attributes?.legacyArrivalDate ?? locked.arrivalDate,
              legacyRouteReconciled: true,
            },
          })
          .where(eq(userProfiles.userId, userId));
        await recalculateRouteInTransaction(tx as unknown as Database, userId, new Date());
      });
      ({ user, profile } = await this.getProfile(userId));
      if (!profile) throw new AppError(404, 'ROUTE_NOT_READY', 'Маршрут ещё не создан');
    }
    const route = (
      await this.db
        .select()
        .from(routes)
        .where(
          and(eq(routes.userId, userId), eq(routes.universityCode, profile.universityCode), eq(routes.isCurrent, true)),
        )
        .limit(1)
    )[0];
    if (!route) throw new AppError(404, 'ROUTE_NOT_READY', 'Маршрут ещё не создан');
    const rows = await this.db
      .select({ step: userSteps, definition: stepDefinitions, source: sources })
      .from(userSteps)
      .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
      .leftJoin(sources, eq(stepDefinitions.sourceId, sources.id))
      .where(eq(userSteps.routeId, route.id));
    const engine = reconcileRoute({
      profile: asProfile(profile),
      university: getUniversityConfig(profile.universityCode) ?? itmoUniversityConfig,
      stepDefinitions: rows
        .filter(({ definition }) => definition.active)
        .map(({ definition }) => asDefinition(definition)),
      previousSteps: rows.map(({ step, definition }) => ({
        code: definition.code,
        status: step.status,
        isActive: step.isActive,
        completedAt: step.completedAt?.toISOString() ?? null,
        deadline: step.deadline,
      })),
      previousVersion: route.version,
      now: new Date(),
    });
    const engineByCode = new Map(engine.steps.map((step) => [step.code, step]));
    const language = user.preferredLanguage;
    const archiveCards = new Map(
      loadKnowledgeRouteCatalog(profile.universityCode, asProfile(profile).knowledgeFacts ?? {}).map((card) => [
        card.id,
        card,
      ]),
    );
    const overrideRows = await this.db.select().from(federalOverrides);
    const releaseIds = new Set(rows.filter((r) => r.definition.knowledgeCard).map((r) => r.definition.code));
    const localizedSteps = rows
      .filter(({ definition }) => definition.active)
      .sort((left, right) => left.definition.sortOrder - right.definition.sortOrder)
      .map(({ step, definition, source }) => {
        const card = definition.knowledgeCard;
        const effective = asProfile(profile);
        const legacy = archiveCards.get(definition.code);
        const knowledge = card
          ? releasePublicCard(
              card,
              effective,
              overrideRows.map((o) => o.payload),
            )
          : legacy
            ? {
                ...legacy,
                overlays: legacy.overlays.filter((o) => !releaseIds.has(o.id)),
              }
            : undefined;
        if (card && knowledge) {
          const guard = evaluateKnowledgeCondition(
            definition.applicability.archiveCondition as import('@first30/domain').KnowledgeCondition,
            releaseContext(card, effective).facts,
          );
          if (guard !== true && knowledge.applicability !== false) knowledge.applicability = guard;
        }
        const schedule = card
          ? calculateReleaseSchedule(card, {
              ...releaseContext(card, effective),
              overrides: overrideRows.map((o) => o.payload),
            })
          : null;
        const context = card ? releaseContext(card, effective) : null;
        return {
          id: step.id,
          code: definition.code,
          title: knowledge?.title ?? t(language, definition.titleKey),
          description: knowledge?.summary ?? t(language, definition.descriptionKey),
          whyImportant: knowledge?.summary ?? t(language, definition.whyKey),
          preparation: definition.preparationKeys.map((key) => t(language, key)),
          contact: definition.contactKey ? t(language, definition.contactKey) : null,
          source: source
            ? localizedSource(language, {
                id: source.id,
                title: source.title,
                url: source.url,
                authority: source.authority,
                verificationStatus: source.verificationStatus,
                languages: source.languages,
                metadata: Object.fromEntries(
                  Object.entries(source.metadata).filter(([key]) => key !== 'releaseSource'),
                ),
              })
            : null,
          status: step.status,
          isActive: engineByCode.get(definition.code)?.isActive ?? step.isActive,
          deadline: engineByCode.has(definition.code) ? engineByCode.get(definition.code)!.deadline : step.deadline,
          deadlineSchedule: schedule
            ? { ...schedule, timezone: (getUniversityConfig(profile.universityCode) ?? itmoUniversityConfig).timezone }
            : null,
          deadlineNote: knowledge?.deadlineNotes.join(' ') ?? t(language, step.deadlineNoteKey),
          stage: definition.stage,
          urgency: engineByCode.get(definition.code)?.urgency ?? 'normal',
          verificationStatus: definition.verificationStatus,
          validAsOf: definition.validAsOf,
          scope: definition.universityCode === 'COMMON' ? 'general' : 'university',
          knowledge: knowledge
            ? {
                ...knowledge,
                ...(card && context
                  ? {
                      inputs: releaseInputFields(
                        card,
                        definition.applicability.archiveCondition as import('@first30/domain').KnowledgeCondition,
                      ).map((field) => ({
                        ...field,
                        label: releaseInputLabels[field.key] ?? field.key,
                        readOnly:
                          field.kind === 'fact'
                            ? effective.knowledgeFacts?.[field.key] !== undefined
                            : ['entry_to_russia', 'border_crossing'].includes(field.key)
                              ? Boolean(effective.attributes?.russiaEntryDate)
                              : field.key === 'arrival' && Boolean(effective.arrivalDate),
                        value:
                          field.kind === 'date'
                            ? (context.dates[field.key] ?? null)
                            : (context.facts[field.key] ?? null),
                      })),
                    }
                  : {}),
                selection: knowledge.applicability === 'unknown' ? ('pending' as const) : ('included' as const),
                overlays: knowledge.overlays.filter((overlay) => overlay.applicability !== false),
              }
            : undefined,
          knowledgeApplicability: knowledge?.applicability,
        };
      });
    const activeSteps = localizedSteps.filter((step) => step.isActive);
    const possibleSteps = localizedSteps.filter(
      (step) => !step.isActive && step.knowledgeApplicability === 'unknown' && step.status !== 'COMPLETED',
    );
    const nextAction = engine.nextAction
      ? (activeSteps.find((step) => step.code === engine.nextAction?.code) ?? null)
      : null;
    return {
      id: route.id,
      version: route.version,
      stage: engine.stage,
      progress: engine.progress,
      nextAction,
      steps: activeSteps,
      possibleSteps,
      archivedCompleted: rows
        .filter(({ step, definition }) => (!step.isActive || !definition.active) && step.status === 'COMPLETED')
        .map(({ definition }) => definition.code),
      disclaimer: t(language, (getUniversityConfig(profile.universityCode) ?? itmoUniversityConfig).disclaimerKey),
      university:
        (profile.universityCode === 'OTHER' && typeof profile.attributes?.universityName === 'string'
          ? profile.attributes.universityName
          : null) ??
        universityDirectory.find((entry) => entry.code === profile.universityCode)?.[
          language === 'ru' ? 'nameRu' : 'nameEn'
        ] ??
        profile.universityCode,
      partnerStatus: 'directory_public' as const,
    };
  }

  async updateKnowledgeContext(
    userId: string,
    code: string,
    input: { facts: Record<string, string | number | boolean | null>; dates: Record<string, string | null> },
  ) {
    await this.db.transaction(async (tx) => {
      const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).for('update');
      if (!profile) throw new AppError(404, 'PROFILE_REQUIRED', 'Сначала заполните профиль');
      const [definition] = await tx
        .select()
        .from(stepDefinitions)
        .where(
          and(
            eq(stepDefinitions.code, code),
            eq(stepDefinitions.universityCode, profile.universityCode),
            eq(stepDefinitions.active, true),
          ),
        );
      const card = definition?.knowledgeCard;
      if (!card) throw new AppError(404, 'STEP_NOT_FOUND', 'Карточка не найдена');
      const fields = releaseInputFields(
        card,
        definition.applicability.archiveCondition as import('@first30/domain').KnowledgeCondition,
      );
      const attributes = { ...profile.attributes };
      for (const [kind, values] of [
        ['fact', input.facts],
        ['date', input.dates],
      ] as const)
        for (const [key, value] of Object.entries(values)) {
          const field = fields.find((f) => f.key === key && (f.kind === 'date' ? kind === 'date' : kind === 'fact'));
          if (
            !field ||
            (value !== null &&
              kind === 'date' &&
              (typeof value !== 'string' ||
                !(
                  validReleaseDate(value) ||
                  (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
                )))
          )
            throw new AppError(422, 'INVALID_KNOWLEDGE_CONTEXT', 'Проверьте поле и дату события');
          if (
            value !== null &&
            kind === 'fact' &&
            field.number &&
            (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000)
          )
            throw new AppError(422, 'INVALID_KNOWLEDGE_CONTEXT', 'Укажите допустимое число');
          if (
            value !== null &&
            kind === 'fact' &&
            field.options.length &&
            !field.options.some((o) => typeof o === typeof value && o === value)
          )
            throw new AppError(422, 'INVALID_KNOWLEDGE_CONTEXT', 'Выберите допустимый ответ');
          const stored = `kb:${card.university.id}:${card.id}:${kind}:${key}`;
          if (value === null) delete attributes[stored];
          else attributes[stored] = value;
        }
      await tx.update(userProfiles).set({ attributes, updatedAt: new Date() }).where(eq(userProfiles.userId, userId));
      await recalculateRouteInTransaction(tx as unknown as Database, userId, new Date());
    });
    return { route: await this.getRoute(userId) };
  }

  async getStep(userId: string, idOrCode: string) {
    const route = await this.getRoute(userId);
    const step = route.steps.find((item) => item.id === idOrCode || item.code === idOrCode);
    return assertFound(step, 'STEP_NOT_FOUND', 'Шаг не найден');
  }

  async setStepStatus(userId: string, idOrCode: string, status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED') {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ userId: userProfiles.userId, universityCode: userProfiles.universityCode })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .for('update');
      if (!profile) throw new AppError(404, 'PROFILE_REQUIRED', 'Сначала ответьте на вопросы анкеты');
      const row = (
        await tx
          .select({ step: userSteps })
          .from(userSteps)
          .innerJoin(routes, eq(userSteps.routeId, routes.id))
          .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
          .where(
            and(
              eq(routes.userId, userId),
              eq(routes.universityCode, profile.universityCode),
              eq(routes.isCurrent, true),
              eq(userSteps.isActive, true),
              eq(stepDefinitions.active, true),
              idOrCode.includes('-') ? eq(userSteps.id, idOrCode) : eq(stepDefinitions.code, idOrCode),
            ),
          )
          .limit(1)
      )[0];
      if (!row) throw new AppError(404, 'STEP_NOT_FOUND', 'Шаг не найден');
      const rank = { NOT_STARTED: 0, IN_PROGRESS: 1, COMPLETED: 2 } as const;
      if (rank[status] < rank[row.step.status]) {
        throw new AppError(409, 'STEP_STATUS_IMMUTABLE', 'Статус шага нельзя откатить без отдельного подтверждения');
      }
      if (row.step.status !== status) {
        await tx
          .update(userSteps)
          .set({ status, completedAt: status === 'COMPLETED' ? now : null, updatedAt: now })
          .where(eq(userSteps.id, row.step.id));
      }
      if (status === 'COMPLETED') {
        await cancelOutstandingReminders(tx as unknown as Database, [row.step.id], now);
      }
    });
    return this.getRoute(userId);
  }

  async completeReminderStep(userId: string, reminderId: string, userStepId: string, routeVersion: number) {
    const now = new Date();
    return this.db.transaction(async (tx): Promise<'completed' | 'already' | 'stale'> => {
      const [profile] = await tx
        .select({ universityCode: userProfiles.universityCode })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .for('update');
      if (!profile) return 'stale';
      const [row] = await tx
        .select({ reminder: reminders, step: userSteps, route: routes, definitionActive: stepDefinitions.active })
        .from(reminders)
        .innerJoin(userSteps, eq(reminders.userStepId, userSteps.id))
        .innerJoin(routes, eq(userSteps.routeId, routes.id))
        .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
        .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId), eq(reminders.userStepId, userStepId)))
        .limit(1)
        .for('update');
      if (!row) return 'stale';
      if (row.step.status === 'COMPLETED') {
        return 'already';
      }
      if (
        row.reminder.status !== 'sent' ||
        !row.step.isActive ||
        !row.route.isCurrent ||
        row.route.universityCode !== profile.universityCode ||
        row.route.version !== routeVersion ||
        !row.definitionActive
      )
        return 'stale';
      await tx
        .update(userSteps)
        .set({ status: 'COMPLETED', completedAt: now, updatedAt: now })
        .where(eq(userSteps.id, userStepId));
      await cancelOutstandingReminders(tx as unknown as Database, [userStepId], now);
      return 'completed';
    });
  }

  async recalculateRoute(userId: string, now = new Date()) {
    let result!: RouteRecalculation;
    await this.db.transaction(async (tx) => {
      await tx
        .select({ userId: userProfiles.userId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .for('update');
      result = await recalculateRouteInTransaction(tx as unknown as Database, userId, now);
    });
    return { route: await this.getRoute(userId), diff: result.diff };
  }

  private async createCandidate(
    userId: string,
    type: 'ACCOMMODATION_CHANGED' | 'ARRIVAL_CONFIRMED',
    payload: Record<string, unknown>,
    now: Date,
  ) {
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    let candidate: typeof eventCandidates.$inferSelect | undefined;
    await this.db.transaction(async (tx) => {
      const profile = (
        await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1).for('update')
      )[0];
      if (!profile) throw new AppError(404, 'PROFILE_REQUIRED', 'Сначала ответьте на вопросы анкеты');
      const route = (
        await tx
          .select()
          .from(routes)
          .where(
            and(
              eq(routes.userId, userId),
              eq(routes.universityCode, profile.universityCode),
              eq(routes.isCurrent, true),
            ),
          )
          .limit(1)
          .for('update')
      )[0];
      if (!route) throw new AppError(404, 'ROUTE_NOT_READY', 'Маршрут ещё не создан');
      [candidate] = await tx
        .insert(eventCandidates)
        .values({
          userId,
          type,
          payload,
          baseRouteVersion: route.version,
          baseProfileSnapshot: { ...routeDrivingSnapshot(profile) },
          expiresAt,
        })
        .returning();
    });
    const saved = assertFound(candidate);
    return {
      id: saved.id,
      type: saved.type,
      payload: saved.payload,
      status: saved.status,
      expiresAt: saved.expiresAt.toISOString(),
    };
  }

  async createEventCandidate(userId: string, accommodationType: AccommodationType, now = new Date()) {
    return this.createCandidate(userId, 'ACCOMMODATION_CHANGED', { accommodationType }, now);
  }

  async createArrivalEventCandidate(userId: string, arrivalDate: string, now = new Date()) {
    const { profile } = await this.getProfile(userId);
    const today = toDateOnlyInTimezone(
      now,
      getUniversityConfig(profile?.universityCode ?? 'ITMO')?.timezone ?? 'Europe/Moscow',
    );
    if (!isValidIsoDate(arrivalDate) || arrivalDate > today) {
      throw new AppError(422, 'INVALID_ARRIVAL_DATE', 'Укажите реальную дату приезда, не позже сегодня');
    }
    return this.createCandidate(userId, 'ARRIVAL_CONFIRMED', { arrivalDate }, now);
  }

  async cancelEventCandidate(userId: string, candidateId: string) {
    const [candidate] = await this.db
      .update(eventCandidates)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(
        and(
          eq(eventCandidates.id, candidateId),
          eq(eventCandidates.userId, userId),
          eq(eventCandidates.status, 'PENDING'),
        ),
      )
      .returning();
    if (!candidate) throw new AppError(409, 'CANDIDATE_NOT_PENDING', 'Изменение уже обработано или не найдено');
    return { id: candidate.id, status: candidate.status };
  }

  async confirmEventCandidate(userId: string, candidateId: string, now = new Date()) {
    let diff: RouteDiff | undefined;
    let alreadyConfirmed = false;
    let expired = false;
    let stale = false;
    await this.db.transaction(async (tx) => {
      const candidate = (
        await tx
          .select()
          .from(eventCandidates)
          .where(and(eq(eventCandidates.id, candidateId), eq(eventCandidates.userId, userId)))
          .limit(1)
          .for('update')
      )[0];
      if (!candidate) throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Изменение не найдено');
      if (candidate.status === 'CONFIRMED') {
        alreadyConfirmed = true;
        return;
      }
      if (candidate.status === 'CONFLICTED') {
        throw new AppError(409, 'CANDIDATE_STALE', 'Ситуация уже изменилась');
      }
      if (candidate.status !== 'PENDING')
        throw new AppError(409, 'CANDIDATE_NOT_PENDING', 'Изменение нельзя подтвердить');
      if (candidate.expiresAt <= now) {
        await tx
          .update(eventCandidates)
          .set({ status: 'EXPIRED', updatedAt: now })
          .where(eq(eventCandidates.id, candidate.id));
        expired = true;
        return;
      }
      const profile = (
        await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1).for('update')
      )[0];
      if (!profile) throw new AppError(404, 'PROFILE_REQUIRED', 'Сначала ответьте на вопросы анкеты');
      const route = (
        await tx
          .select()
          .from(routes)
          .where(
            and(
              eq(routes.userId, userId),
              eq(routes.universityCode, profile.universityCode),
              eq(routes.isCurrent, true),
            ),
          )
          .limit(1)
          .for('update')
      )[0];
      if (
        !route ||
        route.version !== candidate.baseRouteVersion ||
        !sameSnapshot(candidate.baseProfileSnapshot, routeDrivingSnapshot(profile))
      ) {
        await tx
          .update(eventCandidates)
          .set({ status: 'CONFLICTED', updatedAt: now })
          .where(eq(eventCandidates.id, candidate.id));
        stale = true;
        return;
      }
      const accommodationType = (candidate.payload as { accommodationType?: AccommodationType }).accommodationType;
      const arrivalDate = (candidate.payload as { arrivalDate?: string }).arrivalDate;
      const today = toDateOnlyInTimezone(now, getUniversityConfig(profile.universityCode)?.timezone ?? 'Europe/Moscow');
      if (
        (candidate.type === 'ACCOMMODATION_CHANGED' &&
          (!accommodationType || !['dormitory', 'private', 'relatives'].includes(accommodationType))) ||
        (candidate.type === 'ARRIVAL_CONFIRMED' &&
          (!arrivalDate || !isValidIsoDate(arrivalDate) || arrivalDate > today)) ||
        !['ACCOMMODATION_CHANGED', 'ARRIVAL_CONFIRMED'].includes(candidate.type)
      )
        throw new AppError(422, 'INVALID_CANDIDATE', 'Недопустимые данные изменения');

      await tx
        .update(eventCandidates)
        .set({ status: 'CONFIRMED', updatedAt: now })
        .where(eq(eventCandidates.id, candidate.id));
      await tx
        .insert(events)
        .values({
          userId,
          type: candidate.type,
          payload: candidate.payload,
          idempotencyKey: `candidate:${candidate.id}`,
          confirmedAt: now,
        })
        .onConflictDoNothing();
      if (candidate.type === 'ACCOMMODATION_CHANGED') {
        await tx
          .update(userProfiles)
          .set({ accommodationType: accommodationType!, updatedAt: now })
          .where(eq(userProfiles.userId, userId));
      } else {
        await tx
          .update(userProfiles)
          .set({
            arrivalStatus: 'arrived',
            arrivalDate: arrivalDate!,
            attributes: {
              ...profile.attributes,
              journeyVersion: 'city_v1',
              russiaPresence:
                profile.attributes?.citizenshipType === 'foreign' || profile.attributes?.citizenshipType === 'rf'
                  ? 'yes'
                  : (profile.attributes?.russiaPresence ?? 'unknown'),
              legacyArrivalDate:
                profile.attributes?.journeyVersion === 'city_v1'
                  ? (profile.attributes?.legacyArrivalDate ?? null)
                  : (profile.attributes?.legacyArrivalDate ?? profile.arrivalDate),
            },
            updatedAt: now,
          })
          .where(eq(userProfiles.userId, userId));
      }
      diff = (await recalculateRouteInTransaction(tx as unknown as Database, userId, now)).diff;
    });
    if (expired) throw new AppError(409, 'CANDIDATE_EXPIRED', 'Время подтверждения истекло');
    if (stale)
      throw new AppError(
        409,
        'CANDIDATE_STALE',
        'Ситуация изменилась. Проверьте текущий маршрут и создайте изменение заново',
      );
    return {
      route: await this.getRoute(userId),
      diff:
        diff ??
        ({
          added: [],
          deactivated: [],
          reactivated: [],
          deadlineChanged: [],
          preservedCompleted: [],
          hasMeaningfulChanges: false,
        } satisfies RouteDiff),
      alreadyConfirmed,
    };
  }

  async setReminderConsent(userId: string, enabled: boolean) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const profile = (
        await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1).for('update')
      )[0];
      if (!profile) throw new AppError(404, 'PROFILE_REQUIRED', 'Сначала ответьте на вопросы анкеты');
      await tx
        .update(userProfiles)
        .set({ remindersEnabled: enabled, updatedAt: now })
        .where(eq(userProfiles.userId, userId));
      if (enabled) await recalculateRouteInTransaction(tx as unknown as Database, userId, now);
      if (!enabled) {
        const outstanding = await tx
          .select({ stepId: reminders.userStepId })
          .from(reminders)
          .where(and(eq(reminders.userId, userId), inArray(reminders.status, ['scheduled', 'processing'])));
        await cancelOutstandingReminders(
          tx as unknown as Database,
          [...new Set(outstanding.map((item) => item.stepId))],
          now,
        );
      }
    });
    return { remindersEnabled: enabled };
  }

  async listReminders(userId: string) {
    return this.db
      .select({ stepCode: stepDefinitions.code, scheduledFor: reminders.scheduledFor })
      .from(reminders)
      .innerJoin(userSteps, eq(reminders.userStepId, userSteps.id))
      .innerJoin(routes, eq(userSteps.routeId, routes.id))
      .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
      .where(
        and(
          eq(reminders.userId, userId),
          eq(routes.isCurrent, true),
          eq(userSteps.isActive, true),
          eq(stepDefinitions.active, true),
          ne(userSteps.status, 'COMPLETED'),
          inArray(reminders.status, ['scheduled', 'processing']),
        ),
      );
  }

  async configureReminder(userId: string, stepCode: string, mode: 'off' | 'automatic') {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const profile = (
        await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1).for('update')
      )[0];
      if (!profile) throw new AppError(404, 'PROFILE_REQUIRED', 'Сначала ответьте на вопросы анкеты');
      if (mode === 'automatic' && !profile.remindersEnabled)
        throw new AppError(409, 'REMINDERS_OPT_IN_REQUIRED', 'Сначала включите напоминания');
      const step = (
        await tx
          .select({ id: userSteps.id })
          .from(userSteps)
          .innerJoin(routes, eq(userSteps.routeId, routes.id))
          .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
          .where(
            and(
              eq(routes.userId, userId),
              eq(routes.isCurrent, true),
              eq(userSteps.isActive, true),
              eq(stepDefinitions.active, true),
              ne(userSteps.status, 'COMPLETED'),
              eq(stepDefinitions.code, stepCode),
            ),
          )
          .limit(1)
      )[0];
      if (!step) throw new AppError(404, 'STEP_NOT_FOUND', 'Активный шаг не найден');
      await cancelOutstandingReminders(tx as unknown as Database, [step.id], now);
      const modes = { ...((profile.attributes.reminderModes ?? {}) as Record<string, string>) };
      if (mode === 'automatic') delete modes[step.id];
      else modes[step.id] = 'off';
      await tx
        .update(userProfiles)
        .set({ attributes: { ...profile.attributes, reminderModes: modes }, updatedAt: now })
        .where(eq(userProfiles.userId, userId));
      if (mode === 'automatic') await recalculateRouteInTransaction(tx as unknown as Database, userId, now);
    });
    return { reminders: await this.listReminders(userId) };
  }

  async createReminder(userId: string, stepCode: string, scheduledFor: Date) {
    if (!Number.isFinite(scheduledFor.valueOf()) || scheduledFor <= new Date())
      throw new AppError(422, 'INVALID_SCHEDULE', 'Время напоминания должно быть в будущем');
    return this.db.transaction(async (tx) => {
      const profile = (
        await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1).for('update')
      )[0];
      if (!profile?.remindersEnabled)
        throw new AppError(409, 'REMINDERS_OPT_IN_REQUIRED', 'Сначала включите напоминания');
      const step = (
        await tx
          .select({ step: userSteps })
          .from(userSteps)
          .innerJoin(routes, eq(userSteps.routeId, routes.id))
          .innerJoin(stepDefinitions, eq(userSteps.stepDefinitionId, stepDefinitions.id))
          .where(
            and(
              eq(routes.userId, userId),
              eq(routes.universityCode, profile.universityCode),
              eq(routes.isCurrent, true),
              eq(userSteps.isActive, true),
              eq(stepDefinitions.active, true),
              ne(userSteps.status, 'COMPLETED'),
              eq(stepDefinitions.code, stepCode),
            ),
          )
          .limit(1)
      )[0]?.step;
      if (!step) throw new AppError(404, 'STEP_NOT_FOUND', 'Активный шаг не найден');
      const now = new Date();
      await cancelOutstandingReminders(tx as unknown as Database, [step.id], now);
      await tx
        .update(userProfiles)
        .set({
          attributes: {
            ...profile.attributes,
            reminderModes: {
              ...((profile.attributes.reminderModes ?? {}) as Record<string, string>),
              [step.id]: 'manual',
            },
          },
          updatedAt: now,
        })
        .where(eq(userProfiles.userId, userId));
      const idempotencyKey = `reminder:${userId}:${step.id}:${scheduledFor.toISOString()}`;
      let reminder = (
        await tx
          .insert(reminders)
          .values({ userId, userStepId: step.id, scheduledFor, idempotencyKey })
          .onConflictDoUpdate({
            target: reminders.idempotencyKey,
            set: { status: 'scheduled', cancelledAt: null, outboxId: null, updatedAt: now },
            setWhere: eq(reminders.status, 'cancelled'),
          })
          .returning()
      )[0];
      reminder ??= (await tx.select().from(reminders).where(eq(reminders.idempotencyKey, idempotencyKey)).limit(1))[0];
      return assertFound(reminder);
    });
  }

  async answerKnowledge(userId: string, question: string, previousAnswer?: string) {
    const { user, profile } = await this.getProfile(userId);
    if (!profile) throw new AppError(404, 'PROFILE_REQUIRED', 'Сначала ответьте на вопросы анкеты');
    const citizenship =
      safeProfileValue(profile.attributes?.citizenshipType, ['rf', 'foreign', 'unknown'] as const) ??
      (profile.universityCode === 'ITMO' ? 'foreign' : 'unknown');
    const commonIds = new Set(
      citizenship === 'rf'
        ? ['rf_registration_rules', 'rf_military_accounting']
        : citizenship === 'foreign'
          ? ['rf_foreign_migration', 'rf_migration_law_109', 'rf_medical_2026']
          : [],
    );
    if (
      citizenship === 'foreign' &&
      ['MSU', 'MEPHI', 'MIPT', 'HSE', 'RUDN'].includes(profile.universityCode) &&
      profile.attributes?.campusCode === 'main' &&
      profile.attributes?.entryMode === 'visa_free' &&
      ['private', 'relatives'].includes(profile.accommodationType)
    ) {
      commonIds.add('rf_amina_2026');
    }
    const universityPrefix = `uni_${profile.universityCode.toLowerCase()}_`;
    const directoryEntry = universityDirectory.find((entry) => entry.code === profile.universityCode);
    const actionBySourceId = new Map(universityActionSteps.map((step) => [step.sourceId, step] as const));
    const isAllowedSource = (sourceId: string) =>
      commonIds.has(sourceId) ||
      (sourceId.startsWith(universityPrefix) &&
        (!actionBySourceId.has(sourceId) ||
          isStepApplicable(actionBySourceId.get(sourceId)!, asProfile(profile), profile.universityCode)) &&
        !(
          sourceId.endsWith('_guide') &&
          directoryEntry?.guidanceCitizenship === 'foreign' &&
          citizenship !== 'foreign'
        ) &&
        !(
          sourceId.endsWith('_housing') &&
          (profile.accommodationType !== 'dormitory' ||
            (directoryEntry?.housingCitizenship !== 'all' && directoryEntry?.housingCitizenship !== citizenship) ||
            (directoryEntry.housingYear !== null && profile.attributes?.admissionYear !== directoryEntry.housingYear) ||
            (directoryEntry.code === 'HSE' && profile.attributes?.programLevel !== 'bachelor_specialist') ||
            (directoryEntry.housingCampus !== null && profile.attributes?.campusCode !== directoryEntry.housingCampus))
        )) ||
      (profile.universityCode === 'ITMO' && citizenship === 'foreign' && sourceId.startsWith('itmo_'));
    const sourceLanguage =
      user.preferredLanguage === 'ru' || user.preferredLanguage === 'en' ? user.preferredLanguage : 'en';
    const docs = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.language, sourceLanguage), eq(knowledgeDocuments.active, true)));
    const releasedRoute = await this.getRoute(userId);
    const released = releasedRoute.steps.filter((s) => s.knowledge && 'releaseVerified' in s.knowledge);
    const releasedIds = new Set(released.flatMap((s) => s.knowledge!.sources.map((source) => source.id)));
    const relevantDocs = docs.filter((document) => isAllowedSource(document.sourceId));
    for (const step of released) {
      const card = step.knowledge!;
      const content = [
        card.summary,
        ...card.instructions,
        ...card.documents.filter((d) => d.applicability === true).map((d) => d.title),
        ...card.deadlineNotes,
        ...('federalRules' in card ? card.federalRules.map((rule) => `${rule.action} ${rule.deadline ?? ''}`) : []),
      ].join('\n');
      relevantDocs.push({
        id: `release:${step.code}`,
        title: card.title,
        content,
        sourceId: card.sources[0]!.id,
        language: 'ru',
        tags: [step.code, profile.universityCode],
        active: true,
        updatedAt: new Date(),
      });
    }
    const sourceRows = (await this.db.select().from(sources)).filter(
      (source) => isAllowedSource(source.id) || releasedIds.has(source.id),
    );
    const policies = (await this.db.select().from(federalOverrides)).map((o) => o.payload);
    for (const document of relevantDocs) document.content = applyFederalPublicationPolicy(document.content, policies);
    const domainSources = sourceRows.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      authority: source.authority,
      languages: source.languages,
      validAsOf: source.validAsOf,
      verificationStatus: source.verificationStatus,
    }));
    let answer = answerFromKnowledge({
      query: question,
      language: user.preferredLanguage,
      documents: relevantDocs.map((document) => ({
        id: document.id,
        title: document.title,
        content: document.content,
        sourceId: document.sourceId,
        language: document.language,
        tags: document.tags,
        validAsOf: sourceRows.find((source) => source.id === document.sourceId)?.validAsOf ?? '2026-09-21',
      })),
      sources: domainSources,
      contact: getUniversityConfig(profile.universityCode)?.officialContact ?? itmoUniversityConfig.officialContact,
      notFoundMessage: t(user.preferredLanguage, 'knowledge.not_found'),
      contactNextAction: t(user.preferredLanguage, 'knowledge.contact_next'),
    });
    if (answer.status !== 'product_help') {
      const allowedSourceIds = new Set(answer.sources.map((source) => source.id));
      const crossScriptTerms = answer.status === 'not_found' ? multilingualTopicTerms(question) : [];
      const context = relevantDocs
        .filter(
          (document) =>
            allowedSourceIds.has(document.sourceId) ||
            (crossScriptTerms.length > 0 &&
              crossScriptTerms.some((term) =>
                `${document.title} ${document.tags.join(' ')}`.toLocaleLowerCase('ru-RU').includes(term),
              )),
        )
        .slice(0, 6)
        .map((document) => ({
          documentId: document.id,
          sourceId: document.sourceId,
          title: document.title,
          content: document.content,
          validAsOf: sourceRows.find((source) => source.id === document.sourceId)?.validAsOf ?? '2026-09-21',
        }));
      const campus = directoryEntry?.campuses.find((item) => item.code === profile.attributes?.campusCode);
      const programLevel = safeProfileValue(profile.attributes?.programLevel, [
        'bachelor_specialist',
        'masters',
        'postgraduate',
        'unknown',
      ] as const);
      const enrollmentState = safeProfileValue(profile.attributes?.enrollmentState, [
        'admitted',
        'awaiting_order',
        'arrived',
      ] as const);
      const mobilityStatus = safeProfileValue(profile.attributes?.mobilityStatus, [
        'local',
        'moving',
        'moved',
        'unknown',
      ] as const);
      const housingStatus = safeProfileValue(profile.attributes?.housingStatus, [
        'confirmed',
        'applied',
        'private',
        'relatives',
        'unknown',
      ] as const);
      const llmInput = {
        question,
        language: user.preferredLanguage,
        context,
        ...(previousAnswer ? { previousAnswer: previousAnswer.slice(0, 700) } : {}),
        profile: {
          university:
            directoryEntry?.[user.preferredLanguage === 'ru' ? 'nameRu' : 'nameEn'] ??
            (typeof profile.attributes?.universityName === 'string'
              ? profile.attributes.universityName
              : user.preferredLanguage === 'ru'
                ? 'Университет не указан'
                : 'University not specified'),
          city: directoryEntry?.cityRu ?? (user.preferredLanguage === 'ru' ? 'Не указан' : 'Not specified'),
          ...(campus ? { campus: user.preferredLanguage === 'ru' ? campus.nameRu : campus.nameEn } : {}),
          citizenship,
          ...(profile.countryOrRegion ? { citizenshipCountry: profile.countryOrRegion } : {}),
          ...(typeof profile.attributes?.specialStatus === 'string'
            ? { specialStatus: profile.attributes.specialStatus }
            : {}),
          arrivalStatus: profile.arrivalStatus,
          accommodation: profile.accommodationType,
          ...(programLevel ? { programLevel } : {}),
          ...(enrollmentState ? { enrollmentState } : {}),
          ...(mobilityStatus ? { mobilityStatus } : {}),
          ...(housingStatus ? { housingStatus } : {}),
        },
      } as const;
      try {
        const generated = validateGroundedAnswerResult(await this.llmAdapter.answerFromContext(llmInput), llmInput);
        if (generated.status === 'grounded' && generated.answer) {
          answer = {
            ...answer,
            status: 'grounded',
            answer: generated.answer,
            sources: domainSources.filter((source) => generated.usedSourceIds.includes(source.id)),
            validAsOf: generated.validAsOf,
            contact: null,
          };
        } else if ((generated.status === 'general' || generated.status === 'off_topic') && generated.answer) {
          answer = {
            ...answer,
            status: generated.status,
            answer: generated.answer,
            nextAction: '',
            sources: [],
            validAsOf: null,
            confidence: 'medium',
            contact: null,
          };
        }
      } catch {
        // The deterministic retrieval answer remains available when an adapter fails.
      }
    }
    const localizedContact = answer.contact
      ? [
          t(user.preferredLanguage, answer.contact.instructionKey),
          answer.contact.email,
          answer.contact.phone,
          answer.contact.url,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
    return {
      queryId: randomUUID(),
      ...answer,
      sources: answer.sources.map((source) => localizedSource(user.preferredLanguage, source)),
      contact: localizedContact,
    };
  }

  async saveFeedback(
    userId: string,
    input: { queryId?: string; type: 'HELPFUL' | 'NOT_FOUND' | 'OUTDATED'; comment?: string },
  ) {
    const [saved] = await this.db
      .insert(feedback)
      .values({ userId, ...input })
      .returning();
    return assertFound(saved);
  }

  async listMockDeliveries(userId: string) {
    const user = assertFound((await this.db.select().from(users).where(eq(users.id, userId)).limit(1))[0]);
    return this.db.select().from(mockDeliveries).where(eq(mockDeliveries.recipient, user.maxUserId));
  }

  async expireCandidates(now = new Date()) {
    await this.db
      .update(eventCandidates)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(and(eq(eventCandidates.status, 'PENDING'), lt(eventCandidates.expiresAt, now)));
  }
}

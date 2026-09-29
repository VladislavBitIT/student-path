import type {
  ActiveStepCodeDiff,
  ConfirmedEvent,
  IsoDate,
  NextAction,
  PreviousRouteStep,
  RouteDiff,
  RouteEngineInput,
  RouteProgress,
  RouteResult,
  RouteStage,
  RouteStep,
  StepDefinition,
  Urgency,
  UserProfile,
} from './types.js';
import { evaluateKnowledgeAudit, evaluateKnowledgeCondition } from './knowledge-audit.js';
import { calculateReleaseSchedule, releaseAudience, releaseContext } from './release-knowledge.js';

const STAGE_ORDER: Readonly<Record<RouteStage, number>> = {
  pre_arrival: 0,
  first_three_days: 1,
  first_week: 2,
  first_30_days: 3,
};

const URGENCY_ORDER: Readonly<Record<Urgency, number>> = {
  urgent: 0,
  soon: 1,
  normal: 2,
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function toDateOnlyInTimezone(now: Date, timezone: string): IsoDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`Unable to resolve calendar date for timezone ${timezone}`);
  }
  return `${year}-${month}-${day}`;
}

function epochDay(value: IsoDate): number {
  if (!isValidIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  const [yearText, monthText, dayText] = value.split('-');
  return Math.floor(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)) / 86_400_000);
}

function addCalendarDays(value: IsoDate, days: number): IsoDate {
  const date = new Date((epochDay(value) + days) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

export function calculateRouteStage(profile: UserProfile, now: Date | string, timezone: string): RouteStage {
  if (profile.arrivalStatus === 'preparing') return 'pre_arrival';
  if (profile.attributes?.mobilityStatus === 'local') return 'first_30_days';
  if (!profile.arrivalDate || !isValidIsoDate(profile.arrivalDate)) {
    return 'first_three_days';
  }

  const reference = typeof now === 'string' ? new Date(now) : new Date(now);
  if (Number.isNaN(reference.getTime())) throw new Error('Invalid reference time');
  const today = toDateOnlyInTimezone(reference, timezone);
  const elapsedDays = epochDay(today) - epochDay(profile.arrivalDate);
  if (elapsedDays < 0) return 'pre_arrival';
  if (elapsedDays <= 2) return 'first_three_days';
  if (elapsedDays <= 6) return 'first_week';
  return 'first_30_days';
}

export function applyConfirmedEvents(profile: UserProfile, events: readonly ConfirmedEvent[]): UserProfile {
  const unique = new Map<string, ConfirmedEvent>();
  for (const event of events) {
    if (!unique.has(event.idempotencyKey)) unique.set(event.idempotencyKey, event);
  }
  const ordered = [...unique.values()].sort(
    (left, right) => left.confirmedAt.localeCompare(right.confirmedAt) || left.id.localeCompare(right.id),
  );

  return ordered.reduce<UserProfile>((current, event) => {
    if (event.type === 'ACCOMMODATION_CHANGED') {
      return { ...current, accommodationType: event.payload.accommodationType };
    }
    return { ...current, arrivalStatus: 'arrived', arrivalDate: event.payload.arrivalDate };
  }, profile);
}

export function isStepApplicable(
  definition: StepDefinition,
  profile: UserProfile,
  universityCode: string,
  now = new Date(),
): boolean {
  if (definition.universityCode !== null && definition.universityCode !== universityCode) {
    return false;
  }
  const archiveCondition = definition.applicability.archiveCondition;
  if (definition.knowledgeCard && releaseAudience(definition.knowledgeCard, profile, now) !== true) return false;
  if (archiveCondition) {
    return (
      evaluateKnowledgeCondition(
        archiveCondition as import('./types.js').KnowledgeCondition,
        definition.knowledgeCard
          ? releaseContext(definition.knowledgeCard, profile).facts
          : (profile.knowledgeFacts ?? {}),
      ) === true
    );
  }
  if (definition.applicability.universityCodes && !definition.applicability.universityCodes.includes(universityCode))
    return false;
  const { accommodationTypes, arrivalStatuses } = definition.applicability;
  if (accommodationTypes && !accommodationTypes.includes(profile.accommodationType)) {
    return false;
  }
  if (arrivalStatuses && !arrivalStatuses.includes(profile.arrivalStatus)) {
    return false;
  }
  const attributes = profile.attributes ?? {};
  const citizenship = attributes.citizenshipType ?? (profile.universityCode === 'ITMO' ? 'foreign' : 'unknown');
  const mobility = attributes.mobilityStatus ?? 'unknown';
  const entryMode = attributes.entryMode ?? 'unknown';
  const russiaPresence = attributes.russiaPresence ?? 'unknown';
  const programLevel = attributes.programLevel ?? 'unknown';
  const housing = attributes.housingStatus ?? 'unknown';
  const enrollment = attributes.enrollmentState ?? 'admitted';
  const military = attributes.militaryStatus ?? 'unknown';
  const campus = attributes.campusCode ?? null;
  const faculty = attributes.facultyCode ?? null;
  const includes = (options: readonly string[] | undefined, value: unknown) =>
    !options || (typeof value === 'string' && options.includes(value));
  if (!includes(definition.applicability.citizenshipTypes, citizenship)) return false;
  if (!includes(definition.applicability.entryModes, entryMode)) return false;
  if (!includes(definition.applicability.russiaPresences, russiaPresence)) return false;
  if (!includes(definition.applicability.programLevels, programLevel)) return false;
  if (!includes(definition.applicability.mobilityStatuses, mobility)) return false;
  if (!includes(definition.applicability.housingStatuses, housing)) return false;
  if (!includes(definition.applicability.enrollmentStates, enrollment)) return false;
  if (!includes(definition.applicability.militaryStatuses, military)) return false;
  if (definition.applicability.campusCodes && !definition.applicability.campusCodes.includes(String(campus)))
    return false;
  if (definition.applicability.facultyCodes && !definition.applicability.facultyCodes.includes(String(faculty)))
    return false;
  if (
    definition.applicability.admissionYears &&
    !definition.applicability.admissionYears.includes(Number(attributes.admissionYear))
  )
    return false;
  return true;
}

export function calculateDeadline(definition: StepDefinition, profile: UserProfile, timezone = 'UTC'): IsoDate | null {
  if (definition.knowledgeCard) {
    const schedule = calculateReleaseSchedule(definition.knowledgeCard, {
      ...releaseContext(definition.knowledgeCard, profile),
      overrides: definition.applicability.releaseOverrides as
        import('./release-knowledge.js').FederalOverride[] | undefined,
    });
    return schedule.dueAt ? toDateOnlyInTimezone(new Date(schedule.dueAt), timezone) : schedule.dueOn;
  }
  const rule = definition.deadlineRule;
  if (!rule || rule.verificationStatus !== 'verified') return null;
  if (rule.basis === 'arrival_date' && profile.arrivalDate) {
    return addCalendarDays(profile.arrivalDate, rule.offsetDays);
  }
  return null;
}

function resolveUrgency(
  definition: StepDefinition,
  routeStage: RouteStage,
  deadline: IsoDate | null,
  today: IsoDate,
): Urgency {
  if (deadline) {
    const daysUntil = epochDay(deadline) - epochDay(today);
    if (daysUntil <= 0) return 'urgent';
    if (daysUntil <= 3) return 'soon';
  }
  const stageDelta = STAGE_ORDER[definition.stage] - STAGE_ORDER[routeStage];
  if (stageDelta < 0) return 'urgent';
  if (stageDelta === 0 && definition.attention === 'high') return 'urgent';
  if (stageDelta === 0 || definition.attention === 'high') return 'soon';
  return 'normal';
}

function stableStepSort(left: RouteStep, right: RouteStep): number {
  return left.sortOrder - right.sortOrder || left.code.localeCompare(right.code);
}

export function calculateProgress(steps: readonly PreviousRouteStep[]): RouteProgress {
  const active = steps.filter((step) => step.isActive);
  const completed = active.filter((step) => step.status === 'COMPLETED').length;
  return {
    completed,
    total: active.length,
    percent: active.length === 0 ? 0 : Math.round((completed / active.length) * 100),
  };
}

export function selectNextAction(steps: readonly RouteStep[]): NextAction | null {
  const completedCodes = new Set(
    steps.filter((step) => step.status === 'COMPLETED' || !step.isActive).map((step) => step.code),
  );
  const candidates = steps
    .filter(
      (step) =>
        step.isActive && step.status !== 'COMPLETED' && step.prerequisites.every((code) => completedCodes.has(code)),
    )
    .sort((left, right) => {
      const urgency = URGENCY_ORDER[left.urgency] - URGENCY_ORDER[right.urgency];
      if (urgency !== 0) return urgency;
      if (left.deadline && right.deadline) {
        const deadline = left.deadline.localeCompare(right.deadline);
        if (deadline !== 0) return deadline;
      } else if (left.deadline) {
        return -1;
      } else if (right.deadline) {
        return 1;
      }
      return stableStepSort(left, right);
    });
  const next = candidates[0];
  return next
    ? {
        code: next.code,
        deadline: next.deadline,
        deadlineNoteKey: next.deadlineNoteKey,
        urgency: next.urgency,
        prerequisites: next.prerequisites,
        order: next.sortOrder,
      }
    : null;
}

export function diffActiveStepCodes(
  previous: readonly PreviousRouteStep[],
  nextActiveCodes: readonly string[],
): ActiveStepCodeDiff {
  const before = new Set(previous.filter((step) => step.isActive).map((step) => step.code));
  const after = new Set(nextActiveCodes);
  return {
    added: [...after].filter((code) => !before.has(code)).sort(),
    deactivated: [...before].filter((code) => !after.has(code)).sort(),
    unchanged: [...after].filter((code) => before.has(code)).sort(),
  };
}

function buildDiff(previous: readonly PreviousRouteStep[], next: readonly RouteStep[]): RouteDiff {
  const activeCodes = next.filter((step) => step.isActive).map((step) => step.code);
  const codeDiff = diffActiveStepCodes(previous, activeCodes);
  const previousByCode = new Map(previous.map((step) => [step.code, step]));
  const reactivated = next
    .filter((step) => {
      const before = previousByCode.get(step.code);
      return step.isActive && before !== undefined && !before.isActive;
    })
    .map((step) => step.code)
    .sort();
  const deadlineChanged = next
    .flatMap((step) => {
      const before = previousByCode.get(step.code);
      return before && before.deadline !== step.deadline
        ? [{ code: step.code, before: before.deadline, after: step.deadline }]
        : [];
    })
    .sort((left, right) => left.code.localeCompare(right.code));
  const preservedCompleted = next
    .filter((step) => previousByCode.get(step.code)?.status === 'COMPLETED' && step.status === 'COMPLETED')
    .map((step) => step.code)
    .sort();
  return {
    added: codeDiff.added,
    deactivated: codeDiff.deactivated,
    reactivated,
    deadlineChanged,
    preservedCompleted,
    hasMeaningfulChanges:
      codeDiff.added.length > 0 ||
      codeDiff.deactivated.length > 0 ||
      reactivated.length > 0 ||
      deadlineChanged.length > 0,
  };
}

/**
 * Pure route reconciliation. It never mutates the inputs and deliberately keeps
 * inactive history, including completion timestamps.
 */
export function reconcileRoute(input: RouteEngineInput): RouteResult {
  const effectiveProfile = applyConfirmedEvents(input.profile, input.events ?? []);
  const stage = calculateRouteStage(effectiveProfile, input.now, input.university.timezone);
  const reference = typeof input.now === 'string' ? new Date(input.now) : new Date(input.now);
  const today = toDateOnlyInTimezone(reference, input.university.timezone);
  const previous = input.previousSteps ?? [];
  const previousByCode = new Map(previous.map((step) => [step.code, step]));
  const definitionsByCode = new Map(input.stepDefinitions.map((step) => [step.code, step]));

  const steps: RouteStep[] = input.stepDefinitions
    .filter(
      (definition) =>
        definition.universityCode === null || definition.universityCode === effectiveProfile.universityCode,
    )
    .map((definition) => {
      const before =
        previousByCode.get(definition.code) ??
        definition.applicability.supersedesCodes
          ?.map((code) => previousByCode.get(code))
          .find((step) => step?.status === 'COMPLETED');
      const isActive =
        isStepApplicable(definition, effectiveProfile, input.university.code, reference) &&
        (!definition.knowledgeCard || releaseAudience(definition.knowledgeCard, effectiveProfile, reference) === true);
      const deadline = calculateDeadline(definition, effectiveProfile, input.university.timezone);
      return {
        code: definition.code,
        status: before?.status ?? 'NOT_STARTED',
        isActive,
        completedAt: before?.completedAt ?? null,
        deadline,
        deadlineNoteKey: definition.deadlineNoteKey,
        stage: definition.stage,
        sortOrder: definition.sortOrder,
        prerequisites: definition.prerequisites,
        urgency: resolveUrgency(definition, stage, deadline, today),
        definition,
      };
    });

  // An applicable university overlay replaces the same generic action in the
  // visible plan. The original row and its completion remain in history.
  for (const step of steps) {
    if (!step.isActive) continue;
    const targets = [
      step.definition.knowledgeCard?.target_step_id,
      ...(step.definition.applicability.supersedesCodes ?? []),
    ];
    for (const target of targets) {
      const parent = steps.find((s) => s.code === target);
      if (parent) parent.isActive = false;
    }
  }

  const hasSpecificUniversityAction = steps.some(
    (step) =>
      step.isActive &&
      step.definition.universityCode === effectiveProfile.universityCode &&
      step.code !== 'CHECK_UNIVERSITY_FIRST_STEPS',
  );
  if (hasSpecificUniversityAction) {
    for (const step of steps) {
      if (step.code === 'CHECK_UNIVERSITY_FIRST_STEPS') step.isActive = false;
    }
  }

  const hasSpecificHousingCheck = steps.some(
    (step) =>
      step.isActive &&
      step.definition.universityCode === effectiveProfile.universityCode &&
      step.definition.applicability.housingStatuses?.some((status) => status === 'unknown' || status === 'applied'),
  );
  if (hasSpecificHousingCheck) {
    for (const step of steps) {
      if (step.code === 'CHECK_HOUSING_STATUS') step.isActive = false;
    }
  }

  // Preserve historical rows whose definition is no longer shipped. They remain
  // inactive and cannot become a next action.
  for (const historical of previous) {
    if (definitionsByCode.has(historical.code)) continue;
    const historicalDefinition: StepDefinition = {
      code: historical.code,
      universityCode: effectiveProfile.universityCode,
      stage: 'first_30_days',
      titleKey: 'route.archived.title',
      descriptionKey: 'route.archived.description',
      whyImportantKey: 'route.archived.why',
      preparationKeys: [],
      contactKey: null,
      sourceId: null,
      validAsOf: today,
      verificationStatus: 'needs_confirmation',
      sortOrder: Number.MAX_SAFE_INTEGER,
      prerequisites: [],
      applicability: {},
      deadlineRule: null,
      deadlineNoteKey: 'deadline.to_be_confirmed',
      attention: 'normal',
    };
    steps.push({
      ...historical,
      isActive: false,
      stage: historicalDefinition.stage,
      sortOrder: historicalDefinition.sortOrder,
      prerequisites: [],
      deadlineNoteKey: historicalDefinition.deadlineNoteKey,
      urgency: 'normal',
      definition: historicalDefinition,
    });
  }

  steps.sort(stableStepSort);
  const diff = buildDiff(previous, steps);
  const activeStepCodes = steps.filter((step) => step.isActive).map((step) => step.code);
  const previousVersion = input.previousVersion ?? 0;
  return {
    stage,
    activeStepCodes,
    steps,
    progress: calculateProgress(steps),
    nextAction: selectNextAction(steps),
    diff,
    suggestedVersion: previousVersion + (diff.hasMeaningfulChanges ? 1 : 0),
    ...(input.knowledgeAudit
      ? { knowledgeAudit: evaluateKnowledgeAudit(input.knowledgeAudit, input.university.code, input.now) }
      : {}),
  };
}

export const buildRoute = reconcileRoute;
export const createRoute = reconcileRoute;

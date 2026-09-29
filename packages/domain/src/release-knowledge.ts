import type { KnowledgeCondition, KnowledgeFactValue, UserProfile } from './types.js';
import { evaluateKnowledgeCondition } from './knowledge-audit.js';

// The original records are stored losslessly; these are the fields used by the runtime.
export interface ReleaseSource {
  source_id: string;
  title: string;
  publisher: string;
  verified_url: string;
  source_status: string;
  source_note: string;
  checked_on: string;
  [key: string]: unknown;
}
export interface MachineRule {
  rule_type?: string;
  anchor?: string;
  direction?: 'before' | 'after';
  value?: number;
  offset?: number;
  minimum?: number;
  maximum?: number;
  unit?: string;
  recommended_buffer?: number;
  day_of_month?: number;
  opens?: { value: number; unit: string };
  closes?: { value: number; unit: string };
  variants?: (MachineRule & { when: Record<string, string | number | boolean> })[];
  [key: string]: unknown;
}
export interface ReleaseCard {
  id: string;
  record_type: string;
  university: { id: string; name: string };
  title: string;
  target_step_id: string | null;
  applicability: KnowledgeCondition;
  actions: string[];
  documents: {
    title: string;
    requirement?: string;
    form?: string;
    instructions?: string;
    condition?: KnowledgeCondition;
  }[];
  destination: {
    kind: string;
    name: string;
    url?: string;
    address?: string;
    notes?: string;
    contacts?: { kind: string; value: string; label?: string }[];
  } | null;
  deadline: {
    kind: string;
    display_text: string;
    machine_rule: MachineRule | null;
    reminder_eligible: boolean;
    reminder_mode: string;
    [key: string]: unknown;
  };
  date_scope: string;
  do_not_extrapolate: boolean;
  sources: ReleaseSource[];
  governing_rules: string[];
  fallback: Record<string, unknown> | null;
  verification: {
    status: string;
    route_safe: boolean;
    checked_on: string;
    excluded_claims: string[];
    [key: string]: unknown;
  };
  traceability: { original_path: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface FederalOverride {
  id: string;
  effective_from: string;
  action: string;
  verification_status: string;
  deadline?: {
    display_text: string;
    anchor: string;
    value: number;
    unit: string;
    reminder_eligible: boolean;
    machine_rule?: MachineRule;
  };
  [key: string]: unknown;
}
export interface BusinessCalendar {
  from: string;
  through: string;
  nonWorkingDates: readonly string[];
  workingDates: readonly string[];
}
export interface ReleaseContext {
  facts: Record<string, KnowledgeFactValue>;
  dates: Record<string, string>;
  calendar?: BusinessCalendar;
  overrides?: readonly FederalOverride[];
}
export interface ReleaseSchedule {
  dueOn: string | null;
  dueAt: string | null;
  opensOn: string | null;
  reminderOn: string | null;
  kind: 'deadline' | 'progress_check';
  reason: string | null;
}

export function releaseInputFields(card: ReleaseCard, guard?: KnowledgeCondition) {
  const fields = new Map<
    string,
    { key: string; kind: 'fact' | 'date'; options: KnowledgeFactValue[]; timestamp?: boolean; number?: boolean }
  >();
  const visit = (c: KnowledgeCondition) => {
    if (c.fact) {
      const number = ['gt', 'gte', 'lt', 'lte'].includes(c.op);
      const options = number
        ? []
        : c.values
          ? [...c.values]
          : typeof c.value === 'boolean'
            ? [true, false]
            : c.value === undefined
              ? []
              : [c.value];
      const prior = fields.get(c.fact)?.options ?? [];
      fields.set(c.fact, { key: c.fact, kind: 'fact', options: [...new Set([...prior, ...options])], number });
    }
    c.args?.forEach(visit);
    if (c.arg) visit(c.arg);
  };
  visit(card.applicability);
  if (guard) visit(guard);
  for (const document of card.documents) if (document.condition) visit(document.condition);
  const rule = (r: MachineRule) => {
    if (r.anchor)
      fields.set(`date:${r.anchor}`, { key: r.anchor, kind: 'date', options: [], timestamp: r.unit === 'hours' });
    for (const variant of r.variants ?? []) {
      for (const [key, value] of Object.entries(variant.when))
        if (key !== 'default') visit({ op: 'eq', fact: key, value });
      rule(variant);
    }
    if (r.rule_type === 'monthly_due')
      fields.set('date:billing_month', { key: 'billing_month', kind: 'date', options: [] });
  };
  if (card.deadline.machine_rule) rule(card.deadline.machine_rule);
  if (card.do_not_extrapolate) fields.set('campaign_year', { key: 'campaign_year', kind: 'fact', options: [2026] });
  return [...fields.values()];
}

/** Converts a local reminder hour using the university's IANA zone. */
export function releaseReminderTime(day: string, timezone: string): string {
  const target = Date.parse(`${day}T09:00:00Z`);
  let epoch = target;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(epoch));
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const local = Date.parse(
      `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`,
    );
    epoch += target - local;
  }
  return new Date(epoch).toISOString();
}

export function releaseContext(card: ReleaseCard, profile: UserProfile): ReleaseContext {
  const facts = { ...profile.knowledgeFacts };
  const dates: Record<string, string> = {};
  const attrs = profile.attributes ?? {};
  const prefix = `kb:${card.university.id}:${card.id}:`;
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith(`${prefix}fact:`) && value !== null) facts[key.slice(`${prefix}fact:`.length)] = value;
    if (key.startsWith(`${prefix}date:`) && typeof value === 'string')
      dates[key.slice(`${prefix}date:`.length)] = value;
  }
  Object.assign(facts, profile.knowledgeFacts);
  if (attrs.entryMode === 'visa') facts.visa_required = true;
  if (attrs.entryMode === 'visa_free') facts.visa_required = false;
  if (typeof attrs.russiaEntryDate === 'string') {
    dates.entry_to_russia = attrs.russiaEntryDate;
    dates.border_crossing = attrs.russiaEntryDate;
  }
  if (profile.arrivalDate) dates.arrival = profile.arrivalDate;
  return { facts, dates };
}

export function releaseAudience(card: ReleaseCard, profile: UserProfile, now = new Date()): true | false | 'unknown' {
  if (card.university.id !== `UNIV_${profile.universityCode}`) return false;
  const campaign = releaseContext(card, profile).facts.campaign_year ?? profile.attributes?.admissionYear;
  if (card.do_not_extrapolate && now.getUTCFullYear() !== 2026) return false;
  if (card.do_not_extrapolate && campaign !== 2026) return campaign ? false : 'unknown';
  const context = releaseContext(card, profile);
  if (
    card.do_not_extrapolate &&
    releaseInputFields(card).some(
      (f) => f.kind === 'date' && context.dates[f.key] && !context.dates[f.key]!.startsWith('2026-'),
    )
  )
    return false;
  return evaluateKnowledgeCondition(card.applicability, releaseContext(card, profile).facts);
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function validReleaseDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function shift(date: string, amount: number, unit: string, calendar?: BusinessCalendar): string | null {
  if (!validReleaseDate(date) || !Number.isInteger(amount)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (unit === 'calendar_days' || unit === 'days') d.setUTCDate(d.getUTCDate() + amount);
  else if (unit === 'calendar_months') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + amount);
    const maxDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    // The package specifies no month-end rollover. Do not silently shorten a period.
    if (day > maxDay) return null;
    d.setUTCDate(day);
  } else if (unit === 'business_days') {
    if (!calendar) return null;
    if (date < calendar.from || date > calendar.through) return null;
    let remaining = Math.abs(amount);
    while (remaining) {
      d.setUTCDate(d.getUTCDate() + Math.sign(amount));
      const current = d.toISOString().slice(0, 10);
      if (current < calendar.from || current > calendar.through) return null;
      if (
        calendar.workingDates.includes(current) ||
        (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !calendar.nonWorkingDates.includes(current))
      )
        remaining--;
    }
  } else return null;
  return d.toISOString().slice(0, 10);
}

/** No wall-clock fallback: every date comes from a confirmed, specifically named anchor. */
export function calculateReleaseSchedule(card: ReleaseCard, context: ReleaseContext): ReleaseSchedule {
  const result = computeReleaseSchedule(card, context);
  if (
    card.do_not_extrapolate &&
    [result.dueOn, result.reminderOn, result.opensOn].some((d) => d && !d.startsWith('2026-'))
  ) {
    return { dueOn: null, dueAt: null, opensOn: null, reminderOn: null, kind: 'deadline', reason: 'campaign_period' };
  }
  return result;
}

function computeReleaseSchedule(card: ReleaseCard, context: ReleaseContext): ReleaseSchedule {
  const empty = (reason: string): ReleaseSchedule => ({
    dueOn: null,
    dueAt: null,
    opensOn: null,
    reminderOn: null,
    kind: 'deadline',
    reason,
  });
  let deadline = card.deadline;
  const medicalOverride = context.overrides?.find(
    (o) => card.governing_rules.includes(o.id) && o.id === 'FED_MEDICAL_30_DAYS_2026',
  );
  if (
    medicalOverride &&
    card.target_step_id === 'FED_MEDICAL_INITIAL' &&
    context.facts.foreign_person === true &&
    context.facts.medical_exam_required === true &&
    (context.dates.entry_to_russia ?? '') >= medicalOverride.effective_from
  ) {
    if (!medicalOverride.deadline?.machine_rule || !medicalOverride.deadline.reminder_eligible)
      return empty('federal_machine_rule_missing');
    deadline = { ...deadline, machine_rule: medicalOverride.deadline.machine_rule, reminder_eligible: true };
  }
  if (!deadline.reminder_eligible || !deadline.machine_rule) return empty('not_eligible');
  if (
    [
      'checklist_only',
      'confirm_with_visa_office',
      'conditional_checklist',
      'manual_due_to_fractional_calendar_month',
      'requires_faculty_selection',
    ].includes(deadline.reminder_mode)
  )
    return empty('manual_rule');
  let rule = deadline.machine_rule;
  if (rule.rule_type === 'conditional') {
    let unresolved = false;
    let selected: MachineRule | undefined;
    for (const variant of rule.variants ?? []) {
      if (variant.when.default === true) {
        if (!unresolved) selected = variant;
        break;
      }
      const checks = Object.entries(variant.when).map(([key, value]) =>
        context.facts[key] === undefined ? 'unknown' : context.facts[key] === value,
      );
      if (checks.every((v) => v === true)) {
        selected = variant;
        break;
      }
      if (!checks.includes(false)) unresolved = true;
    }
    if (!selected) return empty('missing_condition');
    rule = selected;
  }
  if (rule.rule_type === 'monthly_due') {
    // A billing month is explicit; reopening the plan must never advance a completed bill.
    const month = context.dates.billing_month;
    if (!month || !validReleaseDate(month)) return empty('missing_anchor:billing_month');
    const day = `${month.slice(0, 7)}-${String(rule.day_of_month).padStart(2, '0')}`;
    return validReleaseDate(day)
      ? { dueOn: day, dueAt: null, opensOn: null, reminderOn: day, kind: 'deadline', reason: null }
      : empty('invalid_date');
  }
  const anchor = rule.anchor ? context.dates[rule.anchor] : undefined;
  if (!anchor) return empty(`missing_anchor:${rule.anchor ?? 'unknown'}`);
  if (rule.unit === 'hours') {
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(anchor) || !Number.isFinite(Date.parse(anchor)))
      return empty('timestamp_required');
    const at = new Date(
      Date.parse(anchor) + (rule.direction === 'before' ? -1 : 1) * (rule.value ?? 0) * 3600000,
    ).toISOString();
    return {
      dueOn: at.slice(0, 10),
      dueAt: at,
      opensOn: null,
      reminderOn: at.slice(0, 10),
      kind: 'deadline',
      reason: null,
    };
  }
  if (!validReleaseDate(anchor)) return empty('invalid_anchor');
  if (deadline.reminder_mode === 'requires_contract_date') {
    return { dueOn: anchor, dueAt: null, opensOn: null, reminderOn: anchor, kind: 'deadline', reason: null };
  }
  if (rule.rule_type === 'window_before' || rule.rule_type === 'window_after') {
    if (!rule.opens || !rule.closes) return empty('incomplete_rule');
    const direction = rule.rule_type === 'window_before' ? -1 : 1;
    const opens = shift(anchor, direction * rule.opens.value, rule.opens.unit, context.calendar);
    const closes = shift(anchor, direction * rule.closes.value, rule.closes.unit, context.calendar);
    if (!opens || !closes) return empty('calendar_required');
    return { dueOn: closes, dueAt: null, opensOn: opens, reminderOn: opens, kind: 'deadline', reason: null };
  }
  const amount = rule.value ?? rule.offset ?? rule.maximum ?? rule.minimum;
  if (amount === undefined) return empty('incomplete_rule');
  const due = shift(anchor, (rule.direction === 'before' ? -1 : 1) * amount, rule.unit ?? '', context.calendar);
  if (!due) return empty('calendar_required');
  const processing = rule.rule_type === 'processing_duration';
  return {
    dueOn: processing ? null : due,
    dueAt: null,
    opensOn: null,
    reminderOn: due,
    kind: processing ? 'progress_check' : 'deadline',
    reason: null,
  };
}

/** Exclusions and original links are never part of the public projection. */
export function releasePublicCard(card: ReleaseCard, profile: UserProfile, overrides: readonly FederalOverride[] = []) {
  const facts = releaseContext(card, profile).facts;
  const urls = new Set(card.sources.map((s) => s.verified_url));
  const destination = card.destination
    ? {
        ...card.destination,
        url: card.destination.url && urls.has(card.destination.url) ? card.destination.url : undefined,
      }
    : null;
  const entry = profile.attributes?.russiaEntryDate;
  const federal = overrides.filter(
    (o) =>
      card.governing_rules.includes(o.id) &&
      typeof entry === 'string' &&
      entry >= o.effective_from &&
      facts.foreign_person === true &&
      facts.medical_exam_required === true,
  );
  const federalEvidence = federal.filter(
    (o) => Array.isArray(o.source_ids) && o.source_ids.some((id) => card.sources.some((s) => s.source_id === id)),
  );
  return {
    id: card.id,
    scope: 'university' as const,
    title: card.title.startsWith('FED_') ? card.actions[0]! : card.title,
    summary: card.actions[0]!,
    instructions: card.actions,
    documents: card.documents.map((d) => ({
      ...d,
      applicability: d.condition ? evaluateKnowledgeCondition(d.condition, facts) : (true as const),
    })),
    destination,
    warnings: [],
    exceptions: [],
    unresolvedIds: [],
    deadlineKind: card.deadline.kind,
    deadlineNotes: [card.deadline.display_text],
    reportedDeadlineText: null,
    result: null,
    triggerEvent: null,
    applicability: releaseAudience(card, profile),
    sources: card.sources.map((s) => ({
      id: s.source_id,
      title: s.title,
      publisher: s.publisher,
      url: s.verified_url,
      status: 'verified',
      sourceStatus: s.source_status,
      checkedOn: s.checked_on,
    })),
    overlays: [],
    releaseVerified: true,
    verificationStatus: card.verification.status,
    dateScope: card.date_scope,
    doNotExtrapolate: card.do_not_extrapolate,
    // Keep the override in force as a restriction even when the active package
    // omitted its source URLs. Do not promote an audit-only link to live evidence.
    federalRules: federalEvidence.map((o) => ({ id: o.id, action: o.action, deadline: o.deadline?.display_text })),
    appliedFederalOverrideIds: federal.map((o) => o.id),
  };
}

export function applyFederalPublicationPolicy(
  text: string,
  overrides: readonly FederalOverride[],
  now = new Date(),
): string {
  const feePolicy = overrides.some(
    (o) => o.id === 'FED_ACTIVE_FEE_POLICY_2026' && o.effective_from <= now.toISOString().slice(0, 10),
  );
  return feePolicy
    ? text
        .replace(/\b1[ \u00a0]?600\s*(?:₽|руб(?:лей|ля|ль)?\.?)/gu, 'сумма по актуальной квитанции')
        .replace(/\b1[ \u00a0]?920\s*(?:₽|руб(?:лей|ля|ль)?\.?)/gu, 'сумма по актуальной квитанции')
    : text;
}

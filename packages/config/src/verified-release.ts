import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import type { StepDefinition, KnowledgeCondition } from '../../domain/src/types.js';
import type { ReleaseCard, FederalOverride } from '../../domain/src/release-knowledge.js';

export const releaseDirectory = resolve(process.cwd(), 'db/knowledge-release-2026-09-29');
// Existing dictionary supplies question labels only, never new release facts.
export const releaseInputLabels: Record<string, string> = {
  ...Object.fromEntries(
    readdirSync(resolve(process.cwd(), 'db/route-knowledge-base-v0.10.0/universities')).flatMap((name) => {
      const facts = resolve(
        process.cwd(),
        'db/route-knowledge-base-v0.10.0/universities',
        name,
        'dictionaries/facts.json',
      );
      return (JSON.parse(readFileSync(facts, 'utf8')).entries as { code: string; label: string }[]).map((e) => [
        e.code,
        e.label,
      ]);
    }),
  ),
  ...Object.fromEntries(
    (
      JSON.parse(
        readFileSync(resolve(process.cwd(), 'db/route-knowledge-base-v0.10.0/dictionaries/facts.json'), 'utf8'),
      ).entries as { code: string; label: string }[]
    ).map((e) => [e.code, e.label]),
  ),
  entry_to_russia: 'Дата въезда в Россию',
  border_crossing: 'Дата пересечения границы России',
  arrival: 'Дата приезда в город учёбы',
  visa_expiry: 'Дата окончания визы',
  migration_registration_expiry: 'Дата окончания миграционного учёта',
  stay_expiry: 'Дата окончания пребывания',
  dorm_checkin: 'Дата заселения в общежитие',
  dorm_arrival: 'Дата прибытия в общежитие',
  dorm_contract_signed: 'Дата заключения договора общежития',
  new_passport_received: 'Дата получения нового паспорта',
  document_received: 'Дата получения документов',
  accounting_data_changed: 'Дата изменения учётных данных',
  arrival_card_received: 'Дата получения документа о прибытии',
  slot_notification_received: 'Дата и время уведомления о месте',
  status_or_document_changed: 'Дата изменения статуса или документа',
  complete_request_received: 'Дата получения полного запроса ведомством',
  lease_notification_received: 'Дата уведомления о договоре найма',
  passport_loss_or_replacement: 'Дата утраты или замены паспорта',
  entry_or_dorm_checkin: 'Дата события, указанного в инструкции (въезд или заселение)',
  arrival_or_dorm_checkin: 'Дата прибытия или заселения по инструкции',
  tickets_purchased: 'Дата покупки билетов',
  contract_payment_deadline: 'Срок оплаты на первой странице договора',
  billing_month: 'Расчётный месяц (укажите первое число)',
  campaign_year: 'Год кампании, к которой относится действие',
  visa_required: 'Визовый въезд',
  dormitory: 'Общежитие',
  notification_explicitly_states_24h: 'В уведомлении прямо указан срок 24 часа',
  event: 'Событие',
};
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const condition: z.ZodType<KnowledgeCondition> = z.lazy(
  () =>
    z.union([
      z.object({ op: z.literal('always') }),
      z.object({ op: z.enum(['all', 'any']), args: z.array(condition) }),
      z.object({ op: z.literal('not'), arg: condition }),
      z.looseObject({
        op: z.enum(['eq', 'ne', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'exists']),
        fact: z.string(),
        value: z.unknown().optional(),
        values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
      }),
    ]) as z.ZodType<KnowledgeCondition>,
);
const sourceSchema = z.looseObject({
  source_id: z.string().min(1),
  verified_url: z.url().refine((s) => /^https?:\/\//.test(s)),
  title: z.string().min(1),
  publisher: z.string().min(1),
  source_status: z.string().min(1),
  checked_on: z.iso.date(),
});
const cardSchema = z.looseObject({
  id: z.string().min(1),
  university: z.object({ id: z.string(), name: z.string() }),
  record_type: z.enum(['overlay', 'university_step']),
  title: z.string().min(1),
  target_step_id: z.string().nullable(),
  applicability: condition,
  actions: z.array(z.string().min(1)).min(1),
  documents: z.array(z.looseObject({ title: z.string().min(1) })),
  destination: z.looseObject({ name: z.string() }).nullable(),
  deadline: z.looseObject({
    kind: z.string().min(1),
    display_text: z.string().min(1),
    reminder_eligible: z.boolean(),
    machine_rule: z.record(z.string(), z.unknown()).nullable(),
    reminder_mode: z.string(),
  }),
  date_scope: z.string(),
  do_not_extrapolate: z.boolean(),
  sources: z.array(sourceSchema).min(1),
  governing_rules: z.array(z.string()),
  fallback: z.record(z.string(), z.unknown()).nullable(),
  verification: z.looseObject({
    status: z.string(),
    route_safe: z.literal(true),
    checked_on: z.iso.date(),
    excluded_claims: z.array(z.string()),
  }),
  traceability: z.looseObject({ original_path: z.string() }),
});
export interface VerifiedRelease {
  universities: { university_id: string; university_name: string; [key: string]: unknown }[];
  cards: ReleaseCard[];
  overrides: FederalOverride[];
  checksum: string;
  validation: unknown;
}
export function loadVerifiedRelease(root = releaseDirectory): VerifiedRelease {
  const lock = JSON.parse(readFileSync(resolve(process.cwd(), 'db/knowledge-release-2026-09-29.lock.json'), 'utf8'));
  const checksums = readFileSync(resolve(root, 'checksums.sha256'), 'utf8');
  if (digest(checksums) !== lock.checksums_sha256)
    throw new Error('Release checksums.sha256 differs from the verified archive');
  for (const line of checksums.trim().split('\n')) {
    const [hash, path] = line.split('  ');
    if (!path || !resolve(root, path).startsWith(resolve(root) + sep)) throw new Error('Unsafe release path');
    if (digest(readFileSync(resolve(root, path))) !== hash) throw new Error(`Release checksum mismatch: ${path}`);
  }
  const json = (name: string) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
  const universities = z
    .array(z.looseObject({ university_id: z.string(), university_name: z.string() }))
    .parse(json('import/universities.json').items);
  const cards = z.array(cardSchema).parse(json('import/university_requirements.json').items) as ReleaseCard[];
  const overrides = z
    .array(
      z.looseObject({
        id: z.string(),
        effective_from: z.iso.date(),
        action: z.string(),
        verification_status: z.string(),
      }),
    )
    .parse(json('import/federal_overrides.json').items) as FederalOverride[];
  const validation = json('audit/validation_report.json');
  if (validation.valid !== true) throw new Error('Release validation report is not valid');
  const unique = (values: string[], expected: number, file: string) => {
    if (values.length !== expected || new Set(values).size !== expected)
      throw new Error(`${file}: expected ${expected} unique IDs`);
  };
  unique(
    universities.map((u) => u.university_id),
    10,
    'import/universities.json',
  );
  unique(
    cards.map((c) => c.id),
    122,
    'import/university_requirements.json',
  );
  unique(
    overrides.map((o) => o.id),
    2,
    'import/federal_overrides.json',
  );
  for (const c of cards) {
    if (!universities.some((u) => u.university_id === c.university.id)) throw new Error(`${c.id}: unknown university`);
    if (c.deadline.reminder_eligible && !c.deadline.machine_rule) throw new Error(`${c.id}: missing machine_rule`);
    if (c.governing_rules.some((id) => !overrides.some((o) => o.id === id)))
      throw new Error(`${c.id}: unknown federal override`);
    if (c.verification.status === 'confirmed_campaign_2026' && !c.do_not_extrapolate)
      throw new Error(`${c.id}: campaign extrapolation`);
  }
  if (cards.filter((c) => c.deadline.reminder_eligible).length !== 42)
    throw new Error('Expected 42 reminder eligible cards');
  return { universities, cards, overrides, checksum: lock.archive_sha256, validation };
}

/** Stable IDs share the existing step row and completion history. No facts come from traceability. */
export function projectReleaseDefinitions(
  release: VerifiedRelease,
  existing: readonly StepDefinition[],
): StepDefinition[] {
  return release.cards.map((card, index) => {
    const prior = existing.find((s) => s.code === card.id);
    const parent = card.target_step_id ? existing.find((s) => s.code === card.target_step_id) : prior;
    const guard = parent?.applicability.archiveCondition as KnowledgeCondition | undefined;
    return {
      code: card.id,
      universityCode: card.university.id.replace(/^UNIV_/, ''),
      stage:
        card.deadline.machine_rule?.direction === 'before' && card.deadline.machine_rule.anchor === 'entry_to_russia'
          ? 'pre_arrival'
          : (prior?.stage ?? parent?.stage ?? 'first_30_days'),
      titleKey: card.id,
      descriptionKey: card.id,
      whyImportantKey: card.id,
      preparationKeys: [],
      contactKey: null,
      sourceId: card.sources[0]!.source_id,
      validAsOf: card.verification.checked_on,
      verificationStatus: 'verified',
      sortOrder: prior?.sortOrder ?? 1200 + index,
      prerequisites: prior?.prerequisites ?? [],
      applicability: {
        archiveCondition: guard ? { op: 'all', args: [guard, card.applicability] } : card.applicability,
        releaseOverrides: release.overrides,
        // Same ITMO office, action and 10-day rule; only the applicable new card replaces it.
        ...(card.id === 'UNI_ITMO_PREARRIVAL_NOTIFY' ? { supersedesCodes: ['ITMO_FOREIGN_PREARRIVAL'] } : {}),
      },
      deadlineRule: null,
      deadlineNoteKey: card.id,
      attention: 'normal',
      knowledgeCard: card,
    };
  });
}

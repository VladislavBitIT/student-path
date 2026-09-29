import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type {
  KnowledgeAuditEvent,
  KnowledgeAuditInput,
  KnowledgeAuditStep,
  KnowledgeCondition,
  KnowledgeFactValue,
  StepDefinition,
} from '../../domain/src/types.js';
import { evaluateKnowledgeCondition } from '../../domain/src/knowledge-audit.js';
import { universityDirectory } from './directory.js';

const archiveName = 'route-knowledge-base-v0.10.0';
const validatedReadRoots = new Set<string>();

function ensureArchiveValidated(root: string): void {
  if (validatedReadRoots.has(root)) return;
  inspectKnowledgeBaseArchive(root);
  validatedReadRoots.add(root);
}

interface ArchiveManifest {
  package_version: string;
  content_status: string;
  production_ready: boolean;
  language: string;
  federal_steps: string[];
  universities: { config: string; overlays: string[]; steps: string[] }[];
}

interface ArchiveObject {
  id: string;
  status: string;
  version?: number;
  university_id?: string;
  target_step_id?: string;
  target_step_version?: number;
  overlay_ids?: string[];
  step_ids?: string[];
  evidence?: { source_id: string }[];
  review?: { next_review_on?: string };
  applicability?: KnowledgeCondition;
  trigger?: KnowledgeAuditStep['trigger'];
  title?: string;
  summary?: string;
  instructions?: string[];
  documents?: {
    id: string;
    title: string;
    requirement?: string;
    instructions?: string;
    form?: string;
    condition?: KnowledgeCondition;
  }[];
  destination?: {
    kind: string;
    name: string;
    url?: string;
    information_url?: string;
    address?: string;
    notes?: string;
    resolution?: string;
    selection_basis?: string;
    appointment_required?: string;
    contacts?: { kind: string; value: string; label?: string }[];
  };
  warnings?: { id: string; severity: string; message: string }[];
  unresolved_ids?: string[];
  deadline?: {
    kind: string;
    reason?: string;
    known?: { legal_text?: string; anchor_description?: string };
  };
  reported_deadline_text?: string;
  result?: { title: string; instructions?: string };
  exceptions?: { description: string }[];
  additions?: {
    instructions?: string[];
    documents?: ArchiveObject['documents'];
    destination?: ArchiveObject['destination'];
    warnings?: ArchiveObject['warnings'];
    local_deadlines?: {
      title: string;
      reported_text?: string;
      state?: string;
      scope?: string;
      deadline?: { calculation_allowed?: boolean };
    }[];
  };
}

/** Replays archive conditions and event fixtures in the existing route engine. */
export function loadKnowledgeAuditInput(
  facts: KnowledgeAuditInput['facts'],
  events: readonly KnowledgeAuditEvent[],
  universityCode: string,
  root = resolve(process.cwd(), 'db', archiveName),
): KnowledgeAuditInput {
  inspectKnowledgeBaseArchive(root);
  const manifest = readArchiveJson<ArchiveManifest>(root, 'manifest.json');
  const policy = readArchiveJson<{
    aliases: KnowledgeAuditInput['aliases'];
    invalidations: KnowledgeAuditInput['invalidations'];
  }>(root, 'federal/audit/routing_policy.json');
  const configuration = manifest.universities.find((entry) => {
    const code = readArchiveJson<ArchiveObject>(root, entry.config).id;
    return code === `UNIV_${universityCode}`;
  });
  if (!configuration) throw new Error(`Knowledge-base university is not configured: ${universityCode}`);
  const records = [...manifest.federal_steps, ...configuration.steps].map((path) =>
    readArchiveJson<ArchiveObject>(root, path),
  );
  const steps: KnowledgeAuditStep[] = records.map((record) => {
    if (!record.applicability || !record.trigger) throw new Error(`Incomplete knowledge step: ${record.id}`);
    return {
      id: record.id,
      universityCode: record.university_id ? record.university_id.replace(/^UNIV_/, '') : null,
      applicability: record.applicability,
      trigger: record.trigger,
    };
  });
  return { facts, events, steps, aliases: policy.aliases, invalidations: policy.invalidations };
}

interface ArchiveSource {
  id: string;
  verification_status: string;
  title: string;
  publisher: string;
  url: string;
}

export interface KnowledgeRouteCard {
  id: string;
  scope: 'federal' | 'university';
  title: string;
  summary: string;
  instructions: readonly string[];
  documents: readonly {
    title: string;
    requirement: string;
    instructions: string | null;
    form: string | null;
    applicability: true | false | 'unknown';
  }[];
  destination: ArchiveObject['destination'] | null;
  warnings: readonly string[];
  exceptions: readonly string[];
  unresolvedIds: readonly string[];
  deadlineKind: string;
  deadlineNotes: readonly string[];
  reportedDeadlineText: string | null;
  result: ArchiveObject['result'] | null;
  triggerEvent: string | null;
  applicability: true | false | 'unknown';
  sources: readonly { id: string; title: string; publisher: string; url: string; status: string }[];
  overlays: readonly {
    id: string;
    applicability: true | false | 'unknown';
    instructions: readonly string[];
    documents: KnowledgeRouteCard['documents'];
    destination: ArchiveObject['destination'] | null;
    warnings: readonly string[];
    localDeadlines: readonly {
      title: string;
      reportedText: string | null;
      state: string;
      calculationAllowed: boolean;
    }[];
    unresolvedIds: readonly string[];
    sources: KnowledgeRouteCard['sources'];
  }[];
}

interface ArchiveLock {
  package_version: string;
  file_count: number;
  tree_sha256: string;
}

export interface KnowledgeBaseInspection {
  packageVersion: string;
  contentStatus: string;
  productionReady: boolean;
  objectCounts: { federal: number; overlays: number; university: number; sources: number; blockingQuestions: number };
  blockedReasons: readonly string[];
}

/** Demo route definitions retain archive IDs and conditions; source editorial status stays unchanged. */
export function loadKnowledgeDemoDefinitions(root = resolve(process.cwd(), 'db', archiveName)) {
  ensureArchiveValidated(root);
  const manifest = readArchiveJson<ArchiveManifest>(root, 'manifest.json');
  const sourceRecords = readArchiveJson<{ items: ArchiveSource[] }>(root, 'sources/sources.json').items;
  const sources = sourceRecords.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    authority: source.publisher,
    languages: ['ru'] as const,
    validAsOf: '2026-09-26',
    verificationStatus: 'demo' as const,
    metadata: undefined,
  }));
  const paths = [
    ...manifest.federal_steps.map((path) => ({ path, universityCode: null })),
    ...manifest.universities.flatMap((entry) => {
      const code = readArchiveJson<ArchiveObject>(root, entry.config).id.replace(/^UNIV_/, '');
      return entry.steps.map((path) => ({ path, universityCode: code }));
    }),
  ];
  const steps: StepDefinition[] = paths.map(({ path, universityCode }, index) => {
    const record = readArchiveJson<ArchiveObject>(root, path);
    if (!record.applicability || !record.trigger) throw new Error(`Incomplete knowledge step: ${record.id}`);
    return {
      code: record.id,
      universityCode,
      stage: record.trigger.kind === 'profile' ? 'pre_arrival' : 'first_30_days',
      titleKey: record.id,
      descriptionKey: record.id,
      whyImportantKey: record.id,
      preparationKeys: [],
      contactKey: null,
      sourceId: record.evidence?.[0]?.source_id ?? null,
      validAsOf: '2026-09-26',
      verificationStatus: 'demo',
      sortOrder: 1000 + index,
      prerequisites: [],
      applicability: {
        archiveCondition: {
          op: 'all',
          args: [record.applicability, record.trigger.where ?? { op: 'always' }],
        },
        archiveTrigger: record.trigger,
      },
      deadlineRule: null,
      deadlineNoteKey: record.id,
      attention: 'normal',
    };
  });
  return { sources, steps };
}

function filesInTree(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    return item.isDirectory() ? filesInTree(root, path) : [relative(root, path).split(sep).join('/')];
  });
}

function readArchiveJson<T>(root: string, path: string): T {
  if (path.startsWith('/') || path.split('/').includes('..') || !path.endsWith('.json')) {
    throw new Error(`Invalid knowledge-base path: ${path}`);
  }
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

function assertUnique(label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate knowledge-base ${label}`);
}

/** Verify the exact attached package and its cross-file links before considering publication. */
export function inspectKnowledgeBaseArchive(
  root = resolve(process.cwd(), 'db', archiveName),
  today = new Date().toISOString().slice(0, 10),
): KnowledgeBaseInspection {
  const lock = JSON.parse(readFileSync(`${root}.lock.json`, 'utf8')) as ArchiveLock;
  const paths = filesInTree(root).sort();
  const digest = createHash('sha256');
  for (const path of paths) {
    const content = readFileSync(join(root, path));
    if (!statSync(join(root, path)).isFile()) throw new Error(`Invalid archive entry: ${path}`);
    digest.update(path).update('\0').update(content).update('\0');
  }
  if (paths.length !== lock.file_count || digest.digest('hex') !== lock.tree_sha256) {
    throw new Error('Knowledge-base files differ from the checked-in archive lock');
  }

  const manifest = readArchiveJson<ArchiveManifest>(root, 'manifest.json');
  if (manifest.package_version !== lock.package_version || manifest.language !== 'ru') {
    throw new Error('Unexpected knowledge-base version or source language');
  }
  const audit = readArchiveJson<{ decision: string }>(root, 'sources/quality_audit.json');
  const sourceItems = readArchiveJson<{ items: ArchiveSource[] }>(root, 'sources/sources.json').items;
  const unresolved = readArchiveJson<{ items: { status: string; severity: string }[] }>(
    root,
    'unresolved/unresolved.json',
  ).items;
  const federal = manifest.federal_steps.map((path) => readArchiveJson<ArchiveObject>(root, path));
  const configured = manifest.universities.map((entry) => ({
    config: readArchiveJson<ArchiveObject>(root, entry.config),
    overlays: entry.overlays.map((path) => readArchiveJson<ArchiveObject>(root, path)),
    steps: entry.steps.map((path) => readArchiveJson<ArchiveObject>(root, path)),
  }));
  const overlays = configured.flatMap((entry) => entry.overlays);
  const universitySteps = configured.flatMap((entry) => entry.steps);
  const allObjects = [...federal, ...configured.map((entry) => entry.config), ...overlays, ...universitySteps];
  assertUnique(
    'object IDs',
    allObjects.map((item) => item.id),
  );
  assertUnique(
    'source IDs',
    sourceItems.map((item) => item.id),
  );
  const sources = new Set(sourceItems.map((item) => item.id));
  const federalById = new Map(federal.map((item) => [item.id, item]));
  const projectUniversities = new Set(['ITMO', ...universityDirectory.map((item) => item.code)]);
  if (configured.length !== projectUniversities.size) throw new Error('University count differs from the project');
  for (const { config, overlays: universityOverlays, steps } of configured) {
    const projectCode = config.id.replace(/^UNIV_/, '');
    if (!projectUniversities.has(projectCode)) throw new Error(`Unknown university: ${config.id}`);
    if (config.overlay_ids?.join('|') !== universityOverlays.map((item) => item.id).join('|')) {
      throw new Error(`Overlay index mismatch: ${config.id}`);
    }
    if (config.step_ids?.join('|') !== steps.map((item) => item.id).join('|')) {
      throw new Error(`Step index mismatch: ${config.id}`);
    }
    for (const overlay of universityOverlays) {
      const base = federalById.get(overlay.target_step_id ?? '');
      if (overlay.university_id !== config.id || !base || overlay.target_step_version !== base.version) {
        throw new Error(`Invalid overlay target: ${overlay.id}`);
      }
    }
    for (const step of steps) {
      if (step.university_id !== config.id) throw new Error(`University scope mismatch: ${step.id}`);
    }
  }
  for (const item of allObjects) {
    for (const evidence of item.evidence ?? []) {
      if (!sources.has(evidence.source_id)) throw new Error(`Missing source ${evidence.source_id} for ${item.id}`);
    }
  }

  const blockingQuestions = unresolved.filter((item) => item.status === 'open' && item.severity === 'blocking');
  const blockedReasons = [
    ...(manifest.content_status === 'released' && manifest.production_ready
      ? []
      : ['manifest is not released for production']),
    ...(audit.decision === 'content_blocked' ? ['quality audit blocks content'] : []),
    ...(allObjects.some((item) => item.status !== 'verified') ? ['unverified steps, overlays or universities'] : []),
    ...(sourceItems.some((item) => item.verification_status !== 'verified') ? ['unverified sources'] : []),
    ...(blockingQuestions.length > 0 ? ['open blocking questions'] : []),
    ...(allObjects.some((item) => item.review?.next_review_on && item.review.next_review_on < today)
      ? ['overdue content review']
      : []),
  ];

  // The existing engine stores one row per step code. This package uses event instances,
  // local deadlines and field-level evidence. Until those are represented without loss,
  // even an otherwise released package must fail closed instead of projecting wrong rules.
  if (blockedReasons.length === 0) {
    throw new Error('Knowledge-base event instances and field evidence require a lossless route adapter');
  }
  return {
    packageVersion: manifest.package_version,
    contentStatus: manifest.content_status,
    productionReady: manifest.production_ready,
    objectCounts: {
      federal: federal.length,
      overlays: overlays.length,
      university: universitySteps.length,
      sources: sourceItems.length,
      blockingQuestions: blockingQuestions.length,
    },
    blockedReasons,
  };
}

/** Structured details for ordinary route cards, retaining original source status. */
export function loadKnowledgeRouteCatalog(
  universityCode: string,
  facts: Readonly<Record<string, KnowledgeFactValue>>,
  root = resolve(process.cwd(), 'db', archiveName),
): readonly KnowledgeRouteCard[] {
  ensureArchiveValidated(root);
  const manifest = readArchiveJson<ArchiveManifest>(root, 'manifest.json');
  const selected = manifest.universities.find(
    (entry) => readArchiveJson<ArchiveObject>(root, entry.config).id === `UNIV_${universityCode}`,
  );
  if (!selected) return [];
  const sources = new Map(
    readArchiveJson<{ items: ArchiveSource[] }>(root, 'sources/sources.json').items.map((item) => [item.id, item]),
  );
  const overlays = selected.overlays.map((path) => readArchiveJson<ArchiveObject>(root, path));
  const sourceList = (record: ArchiveObject) =>
    [...new Set((record.evidence ?? []).map((item) => item.source_id))].flatMap((id) => {
      const source = sources.get(id);
      return source
        ? [
            {
              id,
              title: source.title,
              publisher: source.publisher,
              url: source.url,
              status: source.verification_status,
            },
          ]
        : [];
    });
  const documents = (records: ArchiveObject['documents']): KnowledgeRouteCard['documents'] =>
    (records ?? []).map((document) => ({
      title: document.title,
      requirement: document.requirement ?? 'unknown',
      instructions: document.instructions ?? null,
      form: document.form ?? null,
      applicability: document.condition ? evaluateKnowledgeCondition(document.condition, facts) : true,
    }));
  return [
    ...manifest.federal_steps.map((path) => ({ path, scope: 'federal' as const })),
    ...selected.steps.map((path) => ({ path, scope: 'university' as const })),
  ].map(({ path, scope }) => {
    const record = readArchiveJson<ArchiveObject>(root, path);
    return {
      id: record.id,
      scope,
      title: record.title ?? record.id,
      summary: record.summary ?? '',
      instructions: record.instructions ?? [],
      documents: documents(record.documents),
      destination: record.destination ?? null,
      warnings: (record.warnings ?? []).map((warning) => warning.message),
      exceptions: (record.exceptions ?? []).map((exception) => exception.description),
      unresolvedIds: record.unresolved_ids ?? [],
      deadlineKind: record.deadline?.kind ?? 'unknown',
      deadlineNotes: [
        record.deadline?.reason,
        record.deadline?.known?.legal_text,
        record.deadline?.known?.anchor_description,
      ].filter((item): item is string => Boolean(item)),
      reportedDeadlineText: record.reported_deadline_text ?? null,
      result: record.result ?? null,
      triggerEvent: record.trigger?.kind === 'event' ? (record.trigger.event_type ?? null) : null,
      applicability: record.applicability
        ? evaluateKnowledgeCondition(
            { op: 'all', args: [record.applicability, record.trigger?.where ?? { op: 'always' }] },
            facts,
          )
        : 'unknown',
      sources: sourceList(record),
      overlays: overlays
        .filter((overlay) => overlay.target_step_id === record.id)
        .map((overlay) => ({
          id: overlay.id,
          applicability: overlay.applicability ? evaluateKnowledgeCondition(overlay.applicability, facts) : 'unknown',
          instructions: overlay.additions?.instructions ?? [],
          documents: documents(overlay.additions?.documents),
          destination: overlay.additions?.destination ?? null,
          warnings: (overlay.additions?.warnings ?? []).map((warning) => warning.message),
          localDeadlines: (overlay.additions?.local_deadlines ?? []).map((deadline) => ({
            title: deadline.title,
            reportedText: deadline.reported_text ?? null,
            state: deadline.state ?? 'unknown',
            calculationAllowed: deadline.deadline?.calculation_allowed === true,
          })),
          unresolvedIds: overlay.unresolved_ids ?? [],
          sources: sourceList(overlay),
        })),
    };
  });
}

/** Exact dictionary matches only; free-form citizenship is otherwise unknown. */
export function matchArchiveCitizenshipCountry(
  value: string | null | undefined,
  root = resolve(process.cwd(), 'db', archiveName),
): string | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase('ru');
  const dictionary = readArchiveJson<{ entries: { code: string; label: string }[] }>(
    root,
    'dictionaries/countries.json',
  );
  return (
    dictionary.entries.find(
      (item) => item.code.toLocaleLowerCase('ru') === normalized || item.label.toLocaleLowerCase('ru') === normalized,
    )?.code ?? null
  );
}

/** Never reinterpret an existing campus code such as SPBU/peterhof as archive `other`. */
export function matchArchiveCampus(
  universityCode: string,
  campusCode: string | null | undefined,
  root = resolve(process.cwd(), 'db', archiveName),
): string | null {
  if (!campusCode) return null;
  const path = `universities/UNIV_${universityCode}/dictionaries/${universityCode.toLowerCase()}_campuses.json`;
  try {
    const dictionary = readArchiveJson<{ entries: { code: string }[] }>(root, path);
    return dictionary.entries.some((entry) => entry.code === campusCode) ? campusCode : null;
  } catch {
    return null;
  }
}

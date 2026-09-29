import { supportedLanguages } from './types.js';
import type {
  KnowledgeDocument,
  Language,
  OnboardingFlow,
  Source,
  StepDefinition,
  UniversityConfig,
  ValidationIssue,
} from './types.js';
import { isValidIsoDate } from './route-engine.js';

export type LooseDictionaries = Readonly<Record<Language, Readonly<Record<string, string>>>>;

function placeholders(value: string): readonly string[] {
  return [...value.matchAll(/{{\s*([\w]+)\s*}}/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

export function validateI18nDictionaries(dictionaries: LooseDictionaries): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const languages: readonly Language[] = supportedLanguages;
  const allKeys = new Set(languages.flatMap((language) => Object.keys(dictionaries[language])));
  for (const key of [...allKeys].sort()) {
    const baseline = dictionaries.en[key];
    for (const language of languages) {
      const value = dictionaries[language][key];
      if (value === undefined) {
        issues.push({
          path: `i18n.${language}.${key}`,
          code: 'missing_translation',
          message: `Missing ${language} translation for ${key}`,
        });
      } else if (value.trim().length === 0) {
        issues.push({
          path: `i18n.${language}.${key}`,
          code: 'empty_translation',
          message: `Empty ${language} translation for ${key}`,
        });
      }
      if (
        baseline !== undefined &&
        value !== undefined &&
        placeholders(baseline).join('|') !== placeholders(value).join('|')
      ) {
        issues.push({
          path: `i18n.${language}.${key}`,
          code: 'placeholder_mismatch',
          message: `Placeholder set differs from English for ${key}`,
        });
      }
    }
  }
  return issues;
}

function validateUrl(path: string, value: string): ValidationIssue | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
    return null;
  } catch {
    return { path, code: 'invalid_url', message: `Invalid HTTP(S) URL: ${value}` };
  }
}

function requiredTranslationKeys(step: StepDefinition): readonly string[] {
  return [
    step.titleKey,
    step.descriptionKey,
    step.whyImportantKey,
    step.deadlineNoteKey,
    ...step.preparationKeys,
    ...(step.contactKey ? [step.contactKey] : []),
  ];
}

export interface ContentValidationInput {
  university: UniversityConfig;
  sources: readonly Source[];
  steps: readonly StepDefinition[];
  knowledgeDocuments?: readonly KnowledgeDocument[];
  onboarding?: OnboardingFlow;
  dictionaries: LooseDictionaries;
  mode?: 'legacy' | 'directory';
}

export function validateContent(input: ContentValidationInput): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [...validateI18nDictionaries(input.dictionaries)];
  const sourceIds = new Set<string>();
  for (const source of input.sources) {
    const path = `sources.${source.id}`;
    if (sourceIds.has(source.id)) {
      issues.push({ path, code: 'duplicate_source', message: `Duplicate source id ${source.id}` });
    }
    sourceIds.add(source.id);
    if (!source.title.trim() || !source.authority.trim()) {
      issues.push({
        path,
        code: 'incomplete_source',
        message: 'Source title and authority are required',
      });
    }
    const urlIssue = validateUrl(`${path}.url`, source.url);
    if (urlIssue) issues.push(urlIssue);
    if (!isValidIsoDate(source.validAsOf)) {
      issues.push({
        path: `${path}.validAsOf`,
        code: 'invalid_date',
        message: `Invalid validAsOf date ${source.validAsOf}`,
      });
    }
    if (source.languages.length === 0) {
      issues.push({ path: `${path}.languages`, code: 'missing_language', message: 'Source has no language' });
    }
    if (input.mode === 'directory' && source.id.startsWith('uni_')) {
      if (
        !source.metadata ||
        !isValidIsoDate(source.metadata.sourceCheckedAt) ||
        source.metadata.partnerStatus !== 'directory_public'
      ) {
        issues.push({
          path: `${path}.metadata`,
          code: 'missing_source_metadata',
          message: 'Directory source needs checked date and public-directory status',
        });
      }
      if (source.metadata?.sourcePublishedAt && !isValidIsoDate(source.metadata.sourcePublishedAt)) {
        issues.push({
          path: `${path}.metadata.sourcePublishedAt`,
          code: 'invalid_date',
          message: 'Invalid source publication date',
        });
      }
    }
  }

  const stepCodes = new Set<string>();
  const stageCounts = new Map<string, number>();
  for (const step of input.steps) {
    const path = `steps.${step.code}`;
    if (stepCodes.has(step.code)) {
      issues.push({ path, code: 'duplicate_step', message: `Duplicate step code ${step.code}` });
    }
    stepCodes.add(step.code);
    stageCounts.set(step.stage, (stageCounts.get(step.stage) ?? 0) + 1);
    if (!/^[A-Z][A-Z0-9_]+$/.test(step.code)) {
      issues.push({ path, code: 'unstable_step_code', message: `Invalid stable code ${step.code}` });
    }
    if (step.sourceId && !sourceIds.has(step.sourceId)) {
      issues.push({
        path: `${path}.sourceId`,
        code: 'dangling_source',
        message: `Unknown source ${step.sourceId}`,
      });
    }
    if (step.universityCode !== null && !step.sourceId) {
      issues.push({
        path: `${path}.sourceId`,
        code: 'missing_source',
        message: 'University-specific step requires a source',
      });
    }
    if (!isValidIsoDate(step.validAsOf)) {
      issues.push({
        path: `${path}.validAsOf`,
        code: 'invalid_date',
        message: `Invalid validAsOf date ${step.validAsOf}`,
      });
    }
    if (step.deadlineRule && step.deadlineRule.verificationStatus !== 'verified') {
      issues.push({
        path: `${path}.deadlineRule`,
        code: 'unverified_deadline_rule',
        message: 'Only verified deadline rules may calculate a date',
      });
    }
    if (
      step.deadlineRule &&
      (!Number.isInteger(step.deadlineRule.offsetDays) || Math.abs(step.deadlineRule.offsetDays) > 366)
    ) {
      issues.push({
        path: `${path}.deadlineRule.offsetDays`,
        code: 'invalid_deadline_offset',
        message: 'Deadline offset must be an integer within one year',
      });
    }
    for (const key of requiredTranslationKeys(step)) {
      for (const language of supportedLanguages) {
        if (!input.dictionaries[language][key]?.trim()) {
          issues.push({
            path: `${path}.${key}`,
            code: 'missing_content_translation',
            message: `Missing ${language} content key ${key}`,
          });
        }
      }
    }
  }

  const prerequisitesByCode = new Map(input.steps.map((step) => [step.code, step.prerequisites] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (code: string, chain: readonly string[]): void => {
    if (visiting.has(code)) {
      issues.push({
        path: `steps.${code}.prerequisites`,
        code: 'prerequisite_cycle',
        message: `Prerequisite cycle: ${[...chain, code].join(' -> ')}`,
      });
      return;
    }
    if (visited.has(code)) return;
    visiting.add(code);
    for (const prerequisite of prerequisitesByCode.get(code) ?? []) {
      if (prerequisitesByCode.has(prerequisite)) visit(prerequisite, [...chain, code]);
    }
    visiting.delete(code);
    visited.add(code);
  };
  for (const code of stepCodes) visit(code, []);

  for (const step of input.steps) {
    for (const prerequisite of step.prerequisites) {
      if (!stepCodes.has(prerequisite)) {
        issues.push({
          path: `steps.${step.code}.prerequisites`,
          code: 'dangling_prerequisite',
          message: `Unknown prerequisite ${prerequisite}`,
        });
      }
      if (prerequisite === step.code) {
        issues.push({
          path: `steps.${step.code}.prerequisites`,
          code: 'self_prerequisite',
          message: 'Step cannot depend on itself',
        });
      }
    }
  }

  for (const stage of input.mode === 'directory'
    ? []
    : ['pre_arrival', 'first_three_days', 'first_week', 'first_30_days']) {
    if (!stageCounts.has(stage)) {
      issues.push({ path: 'steps', code: 'missing_stage', message: `No step for stage ${stage}` });
    }
  }
  if (input.mode !== 'directory' && (input.steps.length < 7 || input.steps.length > 10)) {
    issues.push({
      path: 'steps',
      code: 'step_count',
      message: `Expected 7–10 definitions, received ${input.steps.length}`,
    });
  }
  const accommodationCoverage = new Set(input.steps.flatMap((step) => step.applicability.accommodationTypes ?? []));
  if (
    input.mode !== 'directory' &&
    (!accommodationCoverage.has('dormitory') || !accommodationCoverage.has('private'))
  ) {
    issues.push({
      path: 'steps',
      code: 'missing_accommodation_branch',
      message: 'Both dormitory and private branches must be represented',
    });
  }

  for (const accommodationType of input.mode === 'directory' ? [] : (['dormitory', 'private', 'relatives'] as const)) {
    const applicableCount = input.steps.filter((step) => {
      const types = step.applicability.accommodationTypes;
      return !types || types.includes(accommodationType);
    }).length;
    if (applicableCount < 7 || applicableCount > 10) {
      issues.push({
        path: `steps.route.${accommodationType}`,
        code: 'applicable_step_count',
        message: `Expected 7–10 applicable steps for ${accommodationType}, received ${applicableCount}`,
      });
    }
  }

  const knowledgeIds = new Set<string>();
  for (const document of input.knowledgeDocuments ?? []) {
    if (knowledgeIds.has(document.id)) {
      issues.push({
        path: `knowledge.${document.id}`,
        code: 'duplicate_knowledge_document',
        message: `Duplicate knowledge document ${document.id}`,
      });
    }
    knowledgeIds.add(document.id);
    if (!sourceIds.has(document.sourceId)) {
      issues.push({
        path: `knowledge.${document.id}.sourceId`,
        code: 'dangling_source',
        message: `Unknown source ${document.sourceId}`,
      });
    }
    if (!document.content.trim()) {
      issues.push({
        path: `knowledge.${document.id}.content`,
        code: 'empty_document',
        message: 'Knowledge content cannot be empty',
      });
    }
    if (!isValidIsoDate(document.validAsOf)) {
      issues.push({
        path: `knowledge.${document.id}.validAsOf`,
        code: 'invalid_date',
        message: `Invalid validAsOf date ${document.validAsOf}`,
      });
    }
  }

  const contact = input.university.officialContact;
  for (const key of [input.university.disclaimerKey, contact.labelKey, contact.instructionKey]) {
    for (const language of supportedLanguages) {
      if (!input.dictionaries[language][key]?.trim()) {
        issues.push({
          path: `university.${input.university.code}`,
          code: 'missing_university_translation',
          message: `Missing ${language} key ${key}`,
        });
      }
    }
  }
  if (contact.url) {
    const issue = validateUrl('university.officialContact.url', contact.url);
    if (issue) issues.push(issue);
  }

  if (input.onboarding) issues.push(...validateOnboardingFlow(input.onboarding, input.dictionaries));
  return issues;
}

export function validateOnboardingFlow(
  flow: OnboardingFlow,
  dictionaries: LooseDictionaries,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  for (const question of flow.questions) {
    if (ids.has(question.id)) {
      issues.push({
        path: `onboarding.${question.id}`,
        code: 'duplicate_question',
        message: `Duplicate question ${question.id}`,
      });
    }
    ids.add(question.id);
    if (!/^[A-Z0-9_]{3,64}$/.test(question.id)) {
      issues.push({
        path: `onboarding.${question.id}`,
        code: 'unstable_question_id',
        message: 'Question id must be a short stable uppercase token',
      });
    }
  }
  if (!ids.has(flow.firstQuestionId)) {
    issues.push({
      path: 'onboarding.firstQuestionId',
      code: 'dangling_question',
      message: `Unknown first question ${flow.firstQuestionId}`,
    });
  }
  for (const question of flow.questions) {
    if (question.next && !ids.has(question.next)) {
      issues.push({
        path: `onboarding.${question.id}.next`,
        code: 'dangling_question',
        message: `Unknown next question ${question.next}`,
      });
    }
    if (question.type === 'single_choice' && (question.options?.length ?? 0) === 0) {
      issues.push({
        path: `onboarding.${question.id}.options`,
        code: 'missing_options',
        message: 'Single-choice question needs options',
      });
    }
    const optionValues = new Set<string>();
    for (const option of question.options ?? []) {
      if (optionValues.has(option.value)) {
        issues.push({
          path: `onboarding.${question.id}.options`,
          code: 'duplicate_option',
          message: `Duplicate option value ${option.value}`,
        });
      }
      optionValues.add(option.value);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(option.value)) {
        issues.push({
          path: `onboarding.${question.id}.options.${option.value}`,
          code: 'unstable_option_value',
          message: 'Option value must be a short stable token',
        });
      }
    }
    const keys = [question.textKey, ...(question.options ?? []).map((option) => option.labelKey)];
    for (const key of keys) {
      for (const language of supportedLanguages) {
        if (!dictionaries[language][key]?.trim()) {
          issues.push({
            path: `onboarding.${question.id}.${key}`,
            code: 'missing_onboarding_translation',
            message: `Missing ${language} key ${key}`,
          });
        }
      }
    }
  }
  const reachable = new Set<string>();
  let cursor: string | null = flow.firstQuestionId;
  while (cursor) {
    if (reachable.has(cursor)) {
      issues.push({
        path: `onboarding.${cursor}.next`,
        code: 'onboarding_cycle',
        message: `Onboarding next-chain contains a cycle at ${cursor}`,
      });
      break;
    }
    reachable.add(cursor);
    cursor = flow.questions.find((question) => question.id === cursor)?.next ?? null;
  }
  for (const id of ids) {
    if (!reachable.has(id)) {
      issues.push({
        path: `onboarding.${id}`,
        code: 'unreachable_question',
        message: `Question ${id} is not reachable from ${flow.firstQuestionId}`,
      });
    }
  }
  return issues;
}

export function assertValidContent(input: ContentValidationInput): void {
  const issues = validateContent(input);
  if (issues.length > 0) {
    const details = issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    throw new Error(`Content validation failed:\n${details}`);
  }
}

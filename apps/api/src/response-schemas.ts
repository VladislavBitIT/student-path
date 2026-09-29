import { supportedLanguages } from '@first30/domain';

const string = { type: 'string' };
const boolean = { type: 'boolean' };
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date' };
const timestamp = { type: 'string', format: 'date-time' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const array = (items: object) => ({ type: 'array', items });
const ref = (name: string) => ({ $ref: `${name}#` });
// DTOs contain extensible source metadata and knowledge fields. Keep them when
// Fastify serializes responses, while documenting their stable public fields.
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: true,
  properties,
  required,
});
const strings = array(string);
const applicability = { anyOf: [boolean, { type: 'string', enum: ['unknown'] }] };
const value = { anyOf: [string, { type: 'number' }, boolean, { type: 'null' }] };
const document = object(
  {
    title: string,
    requirement: string,
    instructions: nullable(string),
    form: nullable(string),
    applicability,
  },
  ['title', 'applicability'],
);
const destination = nullable(
  object(
    {
      name: string,
      url: string,
      information_url: string,
      address: string,
      notes: string,
      contacts: array(object({ kind: string, value: string, label: string }, ['kind', 'value'])),
    },
    [],
  ),
);
const knowledgeSources = array(
  object(
    {
      id: string,
      title: string,
      publisher: string,
      url: string,
      status: string,
      sourceStatus: string,
      checkedOn: date,
    },
    ['id', 'title', 'publisher', 'url', 'status'],
  ),
);

export const routeEnvelopeSchema = object({
  route: ref('Route'),
});
export const onboardingResponseSchema = object({ route: ref('Route'), diff: ref('RouteDiff') });
export const profileResponseSchema = object({ user: ref('User'), profile: nullable(ref('Profile')) });
export const profileUpdateResponseSchema = object({ user: ref('User') });
export const stepResponseSchema = object({ step: ref('RouteStep') });
export const nextActionResponseSchema = object({ nextAction: nullable(ref('RouteStep')), progress: ref('Progress') });
export const reminderListResponseSchema = object({ reminders: array(ref('ScheduledReminder')) });
export const reminderCreatedResponseSchema = object({ reminder: ref('Reminder') });
export const reminderConsentResponseSchema = object({ remindersEnabled: boolean });
export const authResponseSchema = object({
  token: { type: 'string', description: 'Сессионный Bearer-токен; не сохранять в отчётах или логах.' },
  user: ref('User'),
});

export const responseSchemas = [
  {
    $id: 'User',
    ...object(
      {
        id: uuid,
        maxUserId: { type: 'string', description: 'Идентификатор MAX хранится строкой без потери точности.' },
        preferredLanguage: { type: 'string', enum: [...supportedLanguages] },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ['id', 'maxUserId', 'preferredLanguage'],
    ),
  },
  {
    $id: 'Profile',
    ...object({
      userId: uuid,
      universityCode: string,
      arrivalStatus: { type: 'string', enum: ['preparing', 'arrived'] },
      arrivalDate: nullable(date),
      countryOrRegion: nullable(string),
      ageGroup: nullable(string),
      accommodationType: { type: 'string', enum: ['dormitory', 'private', 'relatives', 'unknown'] },
      remindersEnabled: boolean,
      attributes: object(
        {
          universityName: nullable(string),
          citizenshipType: string,
          russiaPresence: string,
          studyArrival: nullable(string),
          russiaEntryDate: nullable(date),
          legacyArrivalDate: nullable(date),
          journeyVersion: string,
          entryMode: string,
          programLevel: string,
          mobilityStatus: string,
          housingStatus: string,
          campusCode: string,
          facultyCode: nullable(string),
          militaryStatus: string,
          enrollmentState: string,
          admissionYear: nullable({ type: 'integer' }),
          reminderModes: { type: 'object', additionalProperties: { type: 'string', enum: ['off', 'manual'] } },
        },
        [],
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  },
  {
    $id: 'Progress',
    ...object({
      completed: { type: 'integer', minimum: 0 },
      total: { type: 'integer', minimum: 0 },
      percent: { type: 'integer', minimum: 0, maximum: 100 },
    }),
  },
  {
    $id: 'StepSource',
    ...object({
      id: string,
      title: string,
      url: string,
      authority: string,
      verificationStatus: { type: 'string', enum: ['verified', 'demo', 'needs_confirmation'] },
      languages: array({ type: 'string', enum: [...supportedLanguages] }),
      metadata: object(
        {
          sourceCheckedAt: date,
          sourcePublishedAt: nullable(string),
          admissionYear: nullable({ type: 'integer' }),
          appliesTo: string,
          appliesToEn: string,
          deadlineStatus: string,
          partnerStatus: { type: 'string', enum: ['directory_public'] },
        },
        [],
      ),
    }),
  },
  {
    $id: 'KnowledgeCard',
    ...object(
      {
        id: string,
        scope: { type: 'string', enum: ['federal', 'university'] },
        title: string,
        summary: string,
        instructions: strings,
        documents: array(document),
        destination,
        warnings: strings,
        exceptions: strings,
        unresolvedIds: strings,
        deadlineKind: string,
        deadlineNotes: strings,
        reportedDeadlineText: nullable(string),
        result: nullable(object({ title: string, instructions: string }, [])),
        triggerEvent: nullable(string),
        applicability,
        selection: { type: 'string', enum: ['included', 'pending'] },
        sources: knowledgeSources,
        overlays: array(
          object({
            id: string,
            applicability,
            instructions: strings,
            documents: array(document),
            destination,
            warnings: strings,
            localDeadlines: array(
              object({ title: string, reportedText: nullable(string), state: string, calculationAllowed: boolean }),
            ),
            unresolvedIds: strings,
            sources: knowledgeSources,
          }),
        ),
        releaseVerified: boolean,
        verificationStatus: string,
        dateScope: string,
        doNotExtrapolate: boolean,
        federalRules: array(object({ id: string, action: string, deadline: string }, ['id', 'action'])),
        appliedFederalOverrideIds: strings,
        inputs: array(
          object(
            {
              key: string,
              label: string,
              kind: { type: 'string', enum: ['fact', 'date'] },
              options: array({ anyOf: [string, { type: 'number' }, boolean] }),
              value,
              readOnly: boolean,
              timestamp: boolean,
              number: boolean,
            },
            ['key', 'label', 'kind', 'options', 'value', 'readOnly'],
          ),
        ),
      },
      [
        'id',
        'scope',
        'title',
        'summary',
        'instructions',
        'documents',
        'destination',
        'warnings',
        'exceptions',
        'unresolvedIds',
        'deadlineKind',
        'deadlineNotes',
        'reportedDeadlineText',
        'result',
        'triggerEvent',
        'applicability',
        'selection',
        'sources',
        'overlays',
      ],
    ),
  },
  {
    $id: 'RouteStep',
    ...object(
      {
        id: uuid,
        code: string,
        title: string,
        description: string,
        whyImportant: string,
        preparation: strings,
        contact: nullable(string),
        source: nullable(ref('StepSource')),
        status: { type: 'string', enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] },
        isActive: boolean,
        deadline: nullable(date),
        deadlineSchedule: nullable(
          object({
            dueOn: nullable(date),
            dueAt: nullable(timestamp),
            opensOn: nullable(date),
            reminderOn: nullable(date),
            kind: { type: 'string', enum: ['deadline', 'progress_check'] },
            reason: nullable(string),
            timezone: string,
          }),
        ),
        deadlineNote: string,
        stage: { type: 'string', enum: ['pre_arrival', 'first_three_days', 'first_week', 'first_30_days'] },
        urgency: { type: 'string', enum: ['urgent', 'soon', 'normal'] },
        verificationStatus: { type: 'string', enum: ['verified', 'demo', 'needs_confirmation'] },
        validAsOf: date,
        scope: { type: 'string', enum: ['general', 'university'] },
        knowledge: ref('KnowledgeCard'),
        knowledgeApplicability: applicability,
      },
      [
        'id',
        'code',
        'title',
        'description',
        'whyImportant',
        'preparation',
        'contact',
        'source',
        'status',
        'isActive',
        'deadline',
        'deadlineSchedule',
        'deadlineNote',
        'stage',
        'urgency',
        'verificationStatus',
        'validAsOf',
        'scope',
      ],
    ),
  },
  {
    $id: 'Route',
    ...object({
      id: uuid,
      version: { type: 'integer', minimum: 1 },
      stage: { type: 'string', enum: ['pre_arrival', 'first_three_days', 'first_week', 'first_30_days'] },
      progress: ref('Progress'),
      nextAction: nullable(ref('RouteStep')),
      steps: array(ref('RouteStep')),
      possibleSteps: array(ref('RouteStep')),
      archivedCompleted: strings,
      disclaimer: string,
      university: string,
      partnerStatus: { type: 'string', enum: ['directory_public'] },
    }),
  },
  {
    $id: 'RouteDiff',
    ...object({
      added: strings,
      deactivated: strings,
      reactivated: strings,
      deadlineChanged: array(object({ code: string, before: nullable(date), after: nullable(date) })),
      preservedCompleted: strings,
      hasMeaningfulChanges: boolean,
    }),
  },
  { $id: 'ScheduledReminder', ...object({ stepCode: string, scheduledFor: timestamp }) },
  {
    $id: 'Reminder',
    ...object({
      id: uuid,
      userId: uuid,
      userStepId: uuid,
      scheduledFor: timestamp,
      status: { type: 'string', enum: ['scheduled', 'processing', 'sent', 'cancelled', 'failed', 'unknown'] },
      outboxId: nullable(uuid),
      idempotencyKey: string,
      cancelledAt: nullable(timestamp),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  },
];

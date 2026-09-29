import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Language } from '../../domain/src/types.js';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const languageEnum = pgEnum('language', ['ru', 'en', 'kk', 'uz', 'tk', 'zh-CN', 'hi']);
export const arrivalStatusEnum = pgEnum('arrival_status', ['preparing', 'arrived']);
export const accommodationEnum = pgEnum('accommodation_type', ['dormitory', 'private', 'relatives', 'unknown']);
export const stepStatusEnum = pgEnum('step_status', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);
export const candidateStatusEnum = pgEnum('candidate_status', [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
  'CONFLICTED',
]);
export const reminderStatusEnum = pgEnum('reminder_status', [
  'scheduled',
  'processing',
  'sent',
  'cancelled',
  'failed',
  'unknown',
]);
export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled',
  'unknown',
]);
export const inboxStatusEnum = pgEnum('inbox_status', ['pending', 'processing', 'processed', 'failed']);
export const verificationStatusEnum = pgEnum('verification_status', ['verified', 'demo', 'needs_confirmation']);
export const feedbackTypeEnum = pgEnum('feedback_type', ['HELPFUL', 'NOT_FOUND', 'OUTDATED']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    maxUserId: text('max_user_id').notNull(),
    preferredLanguage: languageEnum('preferred_language').notNull().default('ru'),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_max_user_id_unique').on(table.maxUserId)],
);

export const maxAuthExchanges = pgTable(
  'max_auth_exchanges',
  {
    fingerprint: text('fingerprint').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionIssuedAt: timestamp('session_issued_at', { withTimezone: true }).notNull(),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }).notNull(),
    exchangeExpiresAt: timestamp('exchange_expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('max_auth_exchanges_expiry_idx').on(table.exchangeExpiresAt)],
);

export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  universityCode: text('university_code').notNull().default('ITMO'),
  arrivalStatus: arrivalStatusEnum('arrival_status').notNull(),
  arrivalDate: date('arrival_date'),
  countryOrRegion: text('country_or_region'),
  ageGroup: text('age_group'),
  accommodationType: accommodationEnum('accommodation_type').notNull(),
  remindersEnabled: boolean('reminders_enabled').notNull().default(false),
  attributes: jsonb('attributes_json').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  authority: text('authority').notNull(),
  languages: jsonb('languages').$type<Language[]>().notNull(),
  validAsOf: date('valid_as_of').notNull(),
  verificationStatus: verificationStatusEnum('verification_status').notNull(),
  metadata: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const stepDefinitions = pgTable(
  'step_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    universityCode: text('university_code').notNull().default('ITMO'),
    stage: text('stage').notNull(),
    titleKey: text('title_key').notNull(),
    descriptionKey: text('description_key').notNull(),
    whyKey: text('why_key').notNull(),
    preparationKeys: jsonb('preparation_keys').$type<string[]>().notNull().default([]),
    contactKey: text('contact_key').notNull(),
    deadlineNoteKey: text('deadline_note_key').notNull(),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
    validAsOf: date('valid_as_of').notNull(),
    verificationStatus: verificationStatusEnum('verification_status').notNull(),
    sortOrder: integer('sort_order').notNull(),
    applicability: jsonb('applicability').$type<Record<string, unknown>>().notNull().default({}),
    prerequisites: jsonb('prerequisites').$type<string[]>().notNull().default([]),
    deadlineRule: jsonb('deadline_rule').$type<Record<string, unknown> | null>(),
    attention: text('attention').notNull().default('normal'),
    active: boolean('active').notNull().default(true),
    knowledgeCard: jsonb('knowledge_card_json').$type<
      import('../../domain/src/release-knowledge.js').ReleaseCard | null
    >(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('step_definitions_scope_code_unique').on(table.universityCode, table.code),
    index('step_definitions_order_idx').on(table.universityCode, table.sortOrder),
  ],
);

export const knowledgeUniversities = pgTable('knowledge_universities', {
  universityId: text('university_id').primaryKey(),
  universityCode: text('university_code').notNull().unique(),
  payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const federalOverrides = pgTable('federal_overrides', {
  id: text('id').primaryKey(),
  payload: jsonb('payload_json').$type<import('../../domain/src/release-knowledge.js').FederalOverride>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const knowledgeImports = pgTable('knowledge_imports', {
  checksum: text('archive_sha256').primaryKey(),
  report: jsonb('report_json').$type<Record<string, unknown>>().notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
});

export const routes = pgTable(
  'routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    universityCode: text('university_code').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('routes_one_current_per_user_university')
      .on(table.userId, table.universityCode)
      .where(sql`${table.isCurrent} = true`),
    index('routes_user_idx').on(table.userId),
  ],
);

export const userSteps = pgTable(
  'user_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    stepDefinitionId: uuid('step_definition_id')
      .notNull()
      .references(() => stepDefinitions.id, { onDelete: 'restrict' }),
    status: stepStatusEnum('status').notNull().default('NOT_STARTED'),
    deadline: date('deadline'),
    deadlineNoteKey: text('deadline_note_key').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_steps_route_definition_unique').on(table.routeId, table.stepDefinitionId),
    index('user_steps_next_action_idx').on(table.routeId, table.isActive, table.status, table.deadline),
  ],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('events_idempotency_unique').on(table.idempotencyKey),
    index('events_user_idx').on(table.userId),
  ],
);

export const eventCandidates = pgTable(
  'event_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    baseRouteVersion: integer('base_route_version').notNull(),
    baseProfileSnapshot: jsonb('base_profile_snapshot_json').$type<Record<string, unknown>>().notNull(),
    status: candidateStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('event_candidates_owner_status_idx').on(table.userId, table.status)],
);

export const conversationStates = pgTable('conversation_states', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  flowId: text('flow_id').notNull(),
  questionId: text('question_id').notNull(),
  collectedAnswers: jsonb('collected_answers_json').$type<Record<string, unknown>>().notNull().default({}),
  history: jsonb('history_json').$type<string[]>().notNull().default([]),
  completed: boolean('completed').notNull().default(false),
  cancelled: boolean('cancelled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    provider: text('provider').notNull().default('max'),
    recipient: text('recipient').notNull(),
    payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('outbox_idempotency_unique').on(table.idempotencyKey),
    index('outbox_delivery_idx').on(table.status, table.availableAt),
  ],
);

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userStepId: uuid('user_step_id')
      .notNull()
      .references(() => userSteps.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    status: reminderStatusEnum('status').notNull().default('scheduled'),
    outboxId: uuid('outbox_id').references(() => outbox.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('reminders_outbox_unique').on(table.outboxId),
    uniqueIndex('reminders_idempotency_unique').on(table.idempotencyKey),
    index('reminders_due_idx').on(table.status, table.scheduledFor),
  ],
);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    language: languageEnum('language').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('knowledge_language_idx').on(table.language),
    index('knowledge_language_active_idx').on(table.language, table.active),
  ],
);

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    queryId: text('query_id'),
    type: feedbackTypeEnum('type').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('feedback_user_idx').on(table.userId)],
);

export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerUpdateKey: text('provider_update_key').notNull(),
    payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    status: inboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('webhook_inbox_provider_key_unique').on(table.providerUpdateKey),
    index('webhook_inbox_processing_idx').on(table.status, table.receivedAt),
  ],
);

export const mockDeliveries = pgTable(
  'mock_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outboxId: uuid('outbox_id')
      .notNull()
      .references(() => outbox.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('mock_deliveries_outbox_unique').on(table.outboxId),
    index('mock_deliveries_recipient_idx').on(table.recipient),
  ],
);

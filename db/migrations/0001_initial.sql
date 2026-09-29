CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE language AS ENUM ('ru', 'en');
CREATE TYPE arrival_status AS ENUM ('preparing', 'arrived');
CREATE TYPE accommodation_type AS ENUM ('dormitory', 'private', 'relatives');
CREATE TYPE step_status AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE candidate_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
CREATE TYPE reminder_status AS ENUM ('scheduled', 'processing', 'sent', 'cancelled');
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'sent', 'failed', 'cancelled', 'unknown');
CREATE TYPE inbox_status AS ENUM ('pending', 'processing', 'processed', 'failed');
CREATE TYPE verification_status AS ENUM ('verified', 'demo', 'needs_confirmation');
CREATE TYPE feedback_type AS ENUM ('HELPFUL', 'NOT_FOUND', 'OUTDATED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_user_id text NOT NULL UNIQUE,
  preferred_language language NOT NULL DEFAULT 'ru',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  university_code text NOT NULL DEFAULT 'ITMO',
  arrival_status arrival_status NOT NULL,
  arrival_date date,
  country_or_region text,
  age_group text,
  accommodation_type accommodation_type NOT NULL,
  reminders_enabled boolean NOT NULL DEFAULT false,
  attributes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id text PRIMARY KEY,
  title text NOT NULL,
  url text NOT NULL,
  authority text NOT NULL,
  languages jsonb NOT NULL,
  valid_as_of date NOT NULL,
  verification_status verification_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE step_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  university_code text NOT NULL DEFAULT 'ITMO',
  stage text NOT NULL,
  title_key text NOT NULL,
  description_key text NOT NULL,
  why_key text NOT NULL,
  preparation_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact_key text NOT NULL,
  deadline_note_key text NOT NULL,
  source_id text REFERENCES sources(id) ON DELETE SET NULL,
  valid_as_of date NOT NULL,
  verification_status verification_status NOT NULL,
  sort_order integer NOT NULL,
  applicability jsonb NOT NULL DEFAULT '{}'::jsonb,
  prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb,
  deadline_rule jsonb,
  attention text NOT NULL DEFAULT 'normal',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT step_definitions_scope_code_unique UNIQUE (university_code, code)
);
CREATE INDEX step_definitions_order_idx ON step_definitions(university_code, sort_order);

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  university_code text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX routes_one_current_per_user_university ON routes(user_id, university_code) WHERE is_current = true;
CREATE INDEX routes_user_idx ON routes(user_id);

CREATE TABLE user_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  step_definition_id uuid NOT NULL REFERENCES step_definitions(id) ON DELETE RESTRICT,
  status step_status NOT NULL DEFAULT 'NOT_STARTED',
  deadline date,
  deadline_note_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_steps_route_definition_unique UNIQUE (route_id, step_definition_id)
);
CREATE INDEX user_steps_next_action_idx ON user_steps(route_id, is_active, status, deadline);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload_json jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_user_idx ON events(user_id);

CREATE TABLE event_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload_json jsonb NOT NULL,
  status candidate_status NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_candidates_owner_status_idx ON event_candidates(user_id, status);

CREATE TABLE conversation_states (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  flow_id text NOT NULL,
  question_id text NOT NULL,
  collected_answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id text NOT NULL,
  provider text NOT NULL DEFAULT 'max',
  recipient text NOT NULL,
  payload_json jsonb NOT NULL,
  status outbox_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  idempotency_key text NOT NULL UNIQUE,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_delivery_idx ON outbox(status, available_at);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_step_id uuid NOT NULL REFERENCES user_steps(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  status reminder_status NOT NULL DEFAULT 'scheduled',
  outbox_id uuid UNIQUE REFERENCES outbox(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_due_idx ON reminders(status, scheduled_for);

CREATE TABLE knowledge_documents (
  id text PRIMARY KEY,
  title text NOT NULL,
  content text NOT NULL,
  source_id text NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  language language NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_language_idx ON knowledge_documents(language);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_id text,
  type feedback_type NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_user_idx ON feedback(user_id);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_update_key text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  status inbox_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  locked_at timestamptz
);
CREATE INDEX webhook_inbox_processing_idx ON webhook_inbox(status, received_at);

CREATE TABLE mock_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL UNIQUE REFERENCES outbox(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  payload_json jsonb NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mock_deliveries_recipient_idx ON mock_deliveries(recipient);

-- Additive migration. Stable (university_code, code) and all user rows are retained.
CREATE TABLE knowledge_universities (
  university_id text PRIMARY KEY,
  university_code text NOT NULL UNIQUE,
  payload_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE federal_overrides (
  id text PRIMARY KEY,
  payload_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_imports (
  archive_sha256 text PRIMARY KEY,
  report_json jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE step_definitions ADD COLUMN knowledge_card_json jsonb;
CREATE UNIQUE INDEX step_definitions_requirement_id_unique
  ON step_definitions ((knowledge_card_json->>'id')) WHERE knowledge_card_json IS NOT NULL;

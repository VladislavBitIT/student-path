ALTER TYPE candidate_status ADD VALUE IF NOT EXISTS 'CONFLICTED';

ALTER TABLE event_candidates
  ADD COLUMN IF NOT EXISTS base_route_version integer,
  ADD COLUMN IF NOT EXISTS base_profile_snapshot_json jsonb;

UPDATE event_candidates AS candidate
SET
  base_route_version = COALESCE(
    (
      SELECT route.version
      FROM routes AS route
      JOIN user_profiles AS profile ON profile.user_id = candidate.user_id
      WHERE route.user_id = candidate.user_id
        AND route.university_code = profile.university_code
        AND route.is_current = true
      LIMIT 1
    ),
    0
  ),
  base_profile_snapshot_json = COALESCE(
    (
      SELECT jsonb_build_object(
        'universityCode', profile.university_code,
        'arrivalStatus', profile.arrival_status,
        'arrivalDate', profile.arrival_date,
        'accommodationType', profile.accommodation_type
      )
      FROM user_profiles AS profile
      WHERE profile.user_id = candidate.user_id
    ),
    '{}'::jsonb
  )
WHERE base_route_version IS NULL OR base_profile_snapshot_json IS NULL;

ALTER TABLE event_candidates
  ALTER COLUMN base_route_version SET NOT NULL,
  ALTER COLUMN base_profile_snapshot_json SET NOT NULL;

ALTER TABLE conversation_states
  ADD COLUMN IF NOT EXISTS history_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS knowledge_language_active_idx
  ON knowledge_documents (language, active);

CREATE TABLE max_auth_exchanges (
  fingerprint text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_issued_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  exchange_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT max_auth_exchanges_fingerprint_format CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT max_auth_exchanges_session_window CHECK (session_expires_at > session_issued_at),
  CONSTRAINT max_auth_exchanges_exchange_window CHECK (exchange_expires_at >= session_expires_at)
);

CREATE INDEX max_auth_exchanges_expiry_idx ON max_auth_exchanges(exchange_expires_at);

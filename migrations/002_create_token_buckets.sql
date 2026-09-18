CREATE TABLE IF NOT EXISTS rate_limit.token_buckets (
  policy_key text NOT NULL,
  subject_key text NOT NULL,
  available_tokens double precision NOT NULL CHECK (available_tokens >= 0),
  last_refill_at timestamptz NOT NULL,
  last_request_allowed boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (policy_key, subject_key)
);

CREATE INDEX IF NOT EXISTS token_buckets_updated_at_idx
  ON rate_limit.token_buckets (updated_at);

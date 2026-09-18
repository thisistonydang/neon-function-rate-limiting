CREATE SCHEMA IF NOT EXISTS rate_limit;

CREATE TABLE IF NOT EXISTS rate_limit.fixed_windows (
  policy_key text NOT NULL,
  subject_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count bigint NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (policy_key, subject_key, window_start)
);

CREATE INDEX IF NOT EXISTS fixed_windows_expires_at_idx
  ON rate_limit.fixed_windows (expires_at);

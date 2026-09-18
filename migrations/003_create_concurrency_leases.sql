CREATE TABLE IF NOT EXISTS rate_limit.concurrency_leases (
  policy_key text NOT NULL,
  subject_key text NOT NULL,
  lease_id uuid NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (policy_key, subject_key, lease_id),
  CHECK (expires_at > acquired_at)
);

CREATE INDEX IF NOT EXISTS concurrency_leases_lookup_idx
  ON rate_limit.concurrency_leases (policy_key, subject_key, expires_at);

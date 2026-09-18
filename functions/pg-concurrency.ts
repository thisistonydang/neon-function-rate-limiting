import { randomUUID } from "node:crypto";
import { createDatabasePool } from "./database.ts";

const MAX_CONCURRENT = 2;
const WORK_SECONDS = 5;
const LEASE_SECONDS = 30;
const RETRY_AFTER_SECONDS = 1;
const POLICY_KEY = "pg-concurrency";
const SUBJECT_KEY = "global";

const pool = createDatabasePool();

type LeaseResult =
  | { acquired: true; remaining: number }
  | { acquired: false; retryAfter: number };

async function acquireLease(leaseId: string): Promise<LeaseResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))",
      [POLICY_KEY, SUBJECT_KEY],
    );
    await client.query(
      `DELETE FROM rate_limit.concurrency_leases
       WHERE policy_key = $1
         AND subject_key = $2
         AND expires_at <= clock_timestamp()`,
      [POLICY_KEY, SUBJECT_KEY],
    );

    const { rows } = await client.query<{ active_count: number }>(
      `SELECT count(*)::integer AS active_count
       FROM rate_limit.concurrency_leases
       WHERE policy_key = $1
         AND subject_key = $2
         AND expires_at > clock_timestamp()`,
      [POLICY_KEY, SUBJECT_KEY],
    );

    if (rows[0].active_count >= MAX_CONCURRENT) {
      await client.query("COMMIT");
      return { acquired: false, retryAfter: RETRY_AFTER_SECONDS };
    }

    await client.query(
      `INSERT INTO rate_limit.concurrency_leases (
         policy_key,
         subject_key,
         lease_id,
         acquired_at,
         expires_at
       )
       VALUES (
         $1,
         $2,
         $3,
         clock_timestamp(),
         clock_timestamp() + ($4::integer * interval '1 second')
       )`,
      [POLICY_KEY, SUBJECT_KEY, leaseId, LEASE_SECONDS],
    );
    await client.query("COMMIT");

    return {
      acquired: true,
      remaining: MAX_CONCURRENT - rows[0].active_count - 1,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function releaseLease(leaseId: string) {
  await pool.query(
    `DELETE FROM rate_limit.concurrency_leases
     WHERE policy_key = $1
       AND subject_key = $2
       AND lease_id = $3`,
    [POLICY_KEY, SUBJECT_KEY, leaseId],
  );
}

export default async function handler(_request: Request) {
  const leaseId = randomUUID();
  let lease: LeaseResult;

  try {
    lease = await acquireLease(leaseId);
  } catch (error) {
    console.error("Concurrency limit failed", error);
    return new Response("Rate limiter unavailable", {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  }

  if (!lease.acquired) {
    return new Response("Too many concurrent requests", {
      status: 429,
      headers: {
        "Retry-After": String(lease.retryAfter),
        "X-Concurrency-Limit": String(MAX_CONCURRENT),
        "X-Concurrency-Remaining": "0",
      },
    });
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, WORK_SECONDS * 1000));

    return new Response("Hello from a concurrency-limited Neon Function", {
      headers: {
        "X-Concurrency-Limit": String(MAX_CONCURRENT),
        "X-Concurrency-Remaining": String(lease.remaining),
      },
    });
  } finally {
    try {
      await releaseLease(leaseId);
    } catch (error) {
      console.error("Failed to release concurrency lease", error);
    }
  }
}

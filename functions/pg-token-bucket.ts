import { createDatabasePool } from "./database.ts";

const CAPACITY = 3;
const REFILL_SECONDS = 3;
const POLICY_KEY = "pg-token-bucket";
const SUBJECT_KEY = "global";

const pool = createDatabasePool();

type TokenResult = {
  allowed: boolean;
  remaining: number;
  resetAfter: number;
  retryAfter: number;
};

async function takeToken(): Promise<TokenResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO rate_limit.token_buckets (
         policy_key,
         subject_key,
         available_tokens,
         last_refill_at,
         last_request_allowed,
         updated_at
       )
       VALUES ($1, $2, $3, clock_timestamp(), true, clock_timestamp())
       ON CONFLICT (policy_key, subject_key) DO NOTHING`,
      [POLICY_KEY, SUBJECT_KEY, CAPACITY],
    );

    const { rows } = await client.query<{
      available_tokens: number;
      elapsed_seconds: number;
    }>(
      `SELECT
         available_tokens,
         greatest(
           0,
           extract(epoch FROM (clock_timestamp() - last_refill_at))
         )::double precision AS elapsed_seconds
       FROM rate_limit.token_buckets
       WHERE policy_key = $1 AND subject_key = $2
       FOR UPDATE`,
      [POLICY_KEY, SUBJECT_KEY],
    );

    const refilled = Math.min(
      CAPACITY,
      rows[0].available_tokens + rows[0].elapsed_seconds / REFILL_SECONDS,
    );
    const allowed = refilled >= 1;
    const availableTokens = allowed ? refilled - 1 : refilled;

    await client.query(
      `UPDATE rate_limit.token_buckets
       SET available_tokens = $3,
           last_refill_at = clock_timestamp(),
           last_request_allowed = $4,
           updated_at = clock_timestamp()
       WHERE policy_key = $1 AND subject_key = $2`,
      [POLICY_KEY, SUBJECT_KEY, availableTokens, allowed],
    );
    await client.query("COMMIT");

    return {
      allowed,
      remaining: Math.floor(availableTokens),
      resetAfter: Math.ceil((CAPACITY - availableTokens) * REFILL_SECONDS),
      retryAfter: Math.max(
        1,
        Math.ceil((1 - availableTokens) * REFILL_SECONDS),
      ),
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

export default async function handler(_request: Request) {
  let result: TokenResult;

  try {
    result = await takeToken();
  } catch (error) {
    console.error("Token-bucket rate limit failed", error);
    return new Response("Rate limiter unavailable", {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  }

  const headers = {
    "RateLimit-Limit": String(CAPACITY),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.resetAfter),
  };

  if (!result.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...headers, "Retry-After": String(result.retryAfter) },
    });
  }

  return new Response("Hello from a Postgres token-bucket Neon Function", {
    headers,
  });
}

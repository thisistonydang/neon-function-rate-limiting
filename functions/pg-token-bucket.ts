import { attachDatabasePool } from "@neon/functions";
import { Pool } from "pg";

const CAPACITY = 3;
const REFILL_SECONDS = 3;
const POLICY_KEY = "pg-token-bucket";
const SUBJECT_KEY = "global";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
attachDatabasePool(pool);

export default async function handler(_request: Request) {
  const { rows } = await pool.query<{
    allowed: boolean;
    remaining: number;
    reset_after: number;
    retry_after: number;
  }>(
    `WITH params AS MATERIALIZED (
       SELECT clock_timestamp() AS now
     ),
     decision AS (
       INSERT INTO rate_limit.token_buckets (
         policy_key,
         subject_key,
         available_tokens,
         last_refill_at,
         last_request_allowed,
         updated_at
       )
       SELECT $1, $2, $4::double precision - 1, now, true, now
       FROM params
       ON CONFLICT (policy_key, subject_key)
       DO UPDATE SET
         available_tokens = CASE
           WHEN least(
             $4::double precision,
             token_buckets.available_tokens
               + extract(epoch FROM (EXCLUDED.last_refill_at - token_buckets.last_refill_at))
                 / $3::double precision
           ) >= 1
           THEN least(
             $4::double precision,
             token_buckets.available_tokens
               + extract(epoch FROM (EXCLUDED.last_refill_at - token_buckets.last_refill_at))
                 / $3::double precision
           ) - 1
           ELSE least(
             $4::double precision,
             token_buckets.available_tokens
               + extract(epoch FROM (EXCLUDED.last_refill_at - token_buckets.last_refill_at))
                 / $3::double precision
           )
         END,
         last_refill_at = EXCLUDED.last_refill_at,
         last_request_allowed = least(
           $4::double precision,
           token_buckets.available_tokens
             + extract(epoch FROM (EXCLUDED.last_refill_at - token_buckets.last_refill_at))
               / $3::double precision
         ) >= 1,
         updated_at = EXCLUDED.updated_at
       RETURNING available_tokens, last_request_allowed
     )
     SELECT
       last_request_allowed AS allowed,
       floor(available_tokens)::integer AS remaining,
       ceil(($4::double precision - available_tokens) * $3::double precision)::integer AS reset_after,
       greatest(
         1,
         ceil((1 - available_tokens) * $3::double precision)::integer
       ) AS retry_after
     FROM decision`,
    [POLICY_KEY, SUBJECT_KEY, REFILL_SECONDS, CAPACITY],
  );

  const result = rows[0];
  const headers = {
    "RateLimit-Limit": String(CAPACITY),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.reset_after),
  };

  if (!result.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...headers, "Retry-After": String(result.retry_after) },
    });
  }

  return new Response("Hello from a Postgres token-bucket Neon Function", {
    headers,
  });
}

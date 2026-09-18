import { createDatabasePool } from "./database.ts";

const LIMIT = 3;
const WINDOW_SECONDS = 10;
const POLICY_KEY = "pg-fixed-window";
const SUBJECT_KEY = "global";

const pool = createDatabasePool();

export default async function handler(_request: Request) {
  try {
    const { rows } = await pool.query<{
      request_count: string | null;
      retry_after: number;
    }>(
      `WITH params AS MATERIALIZED (
         SELECT to_timestamp(
           floor(extract(epoch FROM clock_timestamp()) / $3::integer)
           * $3::integer
         ) AS window_start
       ),
       cleanup AS (
         DELETE FROM rate_limit.fixed_windows
         WHERE policy_key = $1
           AND subject_key = $2
           AND expires_at < clock_timestamp()
       ),
       attempt AS (
         INSERT INTO rate_limit.fixed_windows (
           policy_key,
           subject_key,
           window_start,
           request_count,
           expires_at
         )
         SELECT
           $1,
           $2,
           window_start,
           1,
           window_start + ($3::integer * interval '1 second')
         FROM params
         ON CONFLICT (policy_key, subject_key, window_start)
         DO UPDATE SET request_count = fixed_windows.request_count + 1
         WHERE fixed_windows.request_count < $4::integer
         RETURNING request_count
       )
       SELECT
         attempt.request_count,
         greatest(
           1,
           ceil(extract(epoch FROM (
             params.window_start
             + ($3::integer * interval '1 second')
             - clock_timestamp()
           )))
         )::integer AS retry_after
       FROM params
       LEFT JOIN attempt ON true`,
      [POLICY_KEY, SUBJECT_KEY, WINDOW_SECONDS, LIMIT],
    );

    const count = rows[0].request_count;
    const retryAfter = rows[0].retry_after;
    const headers = {
      "RateLimit-Limit": String(LIMIT),
      "RateLimit-Remaining": String(count === null ? 0 : LIMIT - Number(count)),
      "RateLimit-Reset": String(retryAfter),
    };

    if (count === null) {
      return new Response("Too many requests", {
        status: 429,
        headers: { ...headers, "Retry-After": String(retryAfter) },
      });
    }

    return new Response("Hello from a Postgres rate-limited Neon Function", {
      headers,
    });
  } catch (error) {
    console.error("Fixed-window rate limit failed", error);
    return new Response("Rate limiter unavailable", {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  }
}

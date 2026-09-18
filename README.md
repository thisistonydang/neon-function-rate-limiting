# Neon Function rate-limiting examples

Rate-limiting patterns for Neon Functions.

## Examples

| Function         | Use it when                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `unprotected`    | Baseline for comparison. Do not use it for protected work.                      |
| `pgfixedwindow`  | You need a simple request limit and can accept bursts around window boundaries. |
| `pgtokenbucket`  | You want to allow short bursts while controlling the sustained request rate.    |
| `pgconcurrency`  | You need to limit simultaneous expensive or long-running operations.            |
| `upstashsliding` | You need a shared sliding-window limit without querying Postgres per request.   |

The protected examples use `SUBJECT_KEY = "global"` and small limits for manual testing. A global policy protects total endpoint capacity, but one caller can consume it for everyone. For per-caller limits, replace the subject with a verified user ID, organization ID, or API-key hash. Never trust an identity supplied directly by the caller.

## Test limits

| Function         | Limit                                                   |
| ---------------- | ------------------------------------------------------- |
| `pgfixedwindow`  | 3 requests in each fixed 10-second window               |
| `pgtokenbucket`  | 3-token capacity, with 1 token restored every 3 seconds |
| `pgconcurrency`  | 2 active requests, with 5 seconds of simulated work     |
| `upstashsliding` | 3 requests during a sliding 10-second window            |

## Prerequisites

- Node.js 24
- Neon CLI 5
- `psql`
- A linked Neon project in a region that supports Neon Functions
- An Upstash Redis database for the `upstashsliding` example

## Setup

Install dependencies and link the repository to a Neon project:

```sh
npm install
neon link
```

`neon link` writes the selected branch configuration to `.neon` and its environment variables to `.env.local`. Both files are ignored by Git.

### Configure Upstash

Create an Upstash Redis database. Add the two values shown in `.env.example` to the existing `.env.local` file. Do not replace the Neon variables already in that file.

```text
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

The Redis key prefix includes this application name and `NEON_BRANCH`. Each Neon branch therefore has separate counters. Change the application namespace in `functions/upstash-sliding-window.ts` if you copy the example into another project that shares the same Redis database.

### Apply migrations

Run migrations in order through a direct, unpooled database connection:

```sh
psql "$(neon connection-string)" -v ON_ERROR_STOP=1 \
  -f migrations/001_create_fixed_windows.sql \
  -f migrations/002_create_token_buckets.sql \
  -f migrations/003_create_concurrency_leases.sql
```

The Functions use the pooled `DATABASE_URL` at runtime.

### Check and deploy

```sh
npm run check
neon config plan --env .env.local
neon deploy --env .env.local
```

The deploy command prints every Function URL.

## Manual testing

Set `URL` to the Function URL printed by `neon deploy`.

### Unprotected

```sh
URL="https://your-unprotected-function-url"
curl -i "$URL"
```

Expected: `200` on every request.

### Fixed window, token bucket, or Upstash sliding window

Wait for the previous test window to clear, then run:

```sh
URL="https://your-function-url"
for request in 1 2 3 4; do
  curl -i "$URL"
done
```

Expected: the first 3 requests return `200`, and the fourth returns `429`.

### Concurrency

```sh
URL="https://your-concurrency-function-url"
seq 3 | xargs -P 3 -I {} curl -sS -w " HTTP %{http_code}\n" "$URL"
```

Expected: 2 requests finish with `200`, and 1 request returns `429` immediately.

## Responses

- `200`: the request is allowed.
- `429 Too Many Requests`: the configured limit was reached.
- `503 Rate limiter unavailable`: Postgres or Upstash could not make a safe decision.

Rate-limit responses include limit, remaining, reset, or retry headers where they apply.

## Production notes

- These Postgres patterns suit low to moderate request volume. Consider Redis or edge rate limiting when a database operation on every request is too expensive.
- Managed services such as Cloudflare can apply rate limits before requests reach the Function.
- Database and Upstash failures fail closed with `503 Rate limiter unavailable`.
- The concurrency lease must last longer than the protected operation. Renew the lease when work can outlive `LEASE_SECONDS`.
- The examples remove expired fixed windows and concurrency leases lazily. Periodic cleanup is useful when many subjects stop making requests.
- Rate limiting is not complete DDoS protection because requests already reached the Function.
- Add authentication, monitoring, load tests, and limits appropriate to your workload before production use.

## License

[MIT](LICENSE)

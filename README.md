# Neon Function rate-limiting examples

Rate-limiting patterns for Neon Functions and Lakebase Postgres.

## Examples

| Function           | Use it when                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `unprotected`      | Baseline for comparison. Do not use it for protected work.                       |
| `pgfixedwindow`    | You need a simple request limit and can accept bursts around window boundaries.  |
| `pgtokenbucket`    | You want to allow short bursts while controlling the sustained request rate.     |
| `pgconcurrency`    | You need to limit simultaneous expensive or long-running operations.             |
| `upstashsliding`   | You need a shared sliding-window limit without querying Postgres per request.    |

The protected examples currently use `SUBJECT_KEY = "global"` and small limits for manual testing. A global policy is useful for protecting total endpoint capacity, but one caller can consume it for everyone. For per-caller limits, replace the subject with a verified user ID, organization ID, or API-key hash. Do not trust a caller-supplied identity.

## Apply migrations

Run migrations in order with the direct, unpooled database connection:

```sh
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f migrations/001_create_fixed_windows.sql \
  -f migrations/002_create_token_buckets.sql \
  -f migrations/003_create_concurrency_leases.sql
```

Functions use the pooled `DATABASE_URL` at runtime.

## Configure Upstash

Create an Upstash Redis database and copy `.env.example` to `.env.local`. Keep the existing Neon variables and replace the two placeholder values:

```text
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Deploy with the environment file so Neon uploads the credentials to the Function:

```sh
neon deploy --env .env.local
```

The Upstash example fails closed with `503` when Redis fails or takes longer than one second. Change this policy only after deciding whether allowing unmetered requests is safe for your workload.

## Production notes

- These Postgres patterns suit low to moderate request volume. Consider Redis or edge rate limiting when a database operation on every request is too expensive.
- Database failures fail closed with `503 Rate limiter unavailable`.
- The concurrency lease must last longer than the protected operation. Renew the lease when work can outlive `LEASE_SECONDS`.
- The examples remove expired fixed windows and concurrency leases lazily. Periodic cleanup is useful when many subjects stop making requests.
- Rate limiting is not complete DDoS protection because requests already reached the Function.
- Add authentication, monitoring, load tests, and limits appropriate to your workload before production use.

## Check

```sh
npm run check
npx neon@5 config plan
```

import { waitUntil } from "@neon/functions";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const LIMIT = 3;
const WINDOW = "10 s";
const SUBJECT_KEY = "global";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(LIMIT, WINDOW),
  prefix: `neon-function-rate-limiting:${process.env.NEON_BRANCH ?? "local"}:sliding-window`,
  timeout: 1_000,
  analytics: false,
});

export default async function handler(_request: Request) {
  try {
    const result = await ratelimit.limit(SUBJECT_KEY);
    waitUntil(result.pending);

    if (result.reason === "timeout") {
      return new Response("Rate limiter unavailable", {
        status: 503,
        headers: { "Retry-After": "1" },
      });
    }

    const resetAfter = Math.max(
      1,
      Math.ceil((result.reset - Date.now()) / 1_000),
    );
    const headers = {
      "RateLimit-Limit": String(result.limit),
      "RateLimit-Remaining": String(result.remaining),
      "RateLimit-Reset": String(resetAfter),
    };

    if (!result.success) {
      return new Response("Too many requests", {
        status: 429,
        headers: { ...headers, "Retry-After": String(resetAfter) },
      });
    }

    return new Response("Hello from an Upstash rate-limited Neon Function", {
      headers,
    });
  } catch (error) {
    console.error("Upstash rate limit failed", error);
    return new Response("Rate limiter unavailable", {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  }
}

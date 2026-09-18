import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  functions: {
    unprotected: {
      name: "Unprotected function",
      source: "functions/unprotected.ts",
    },
    pgfixedwindow: {
      name: "Postgres fixed-window rate limit",
      source: "functions/pg-fixed-window.ts",
    },
    pgtokenbucket: {
      name: "Postgres token-bucket rate limit",
      source: "functions/pg-token-bucket.ts",
    },
    pgconcurrency: {
      name: "Postgres concurrency limit",
      source: "functions/pg-concurrency.ts",
    },
    upstashsliding: {
      name: "Upstash sliding-window rate limit",
      source: "functions/upstash-sliding-window.ts",
      env: {
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL!,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN!,
      },
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});

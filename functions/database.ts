import { attachDatabasePool } from "@neon/functions";
import { Pool } from "pg";

const DATABASE_TIMEOUT_MS = 5_000;

export function createDatabasePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.searchParams.set("sslmode", "verify-full");

  const pool = new Pool({
    connectionString: databaseUrl.toString(),
    max: 5,
    connectionTimeoutMillis: DATABASE_TIMEOUT_MS,
    statement_timeout: DATABASE_TIMEOUT_MS,
  });
  attachDatabasePool(pool);

  return pool;
}

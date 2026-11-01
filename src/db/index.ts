import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Netlify Database exposes NETLIFY_DB_URL; DATABASE_URL is kept for local development.
const databaseUrl = process.env.DATABASE_URL ?? process.env.NETLIFY_DB_URL;

// Route modules are imported while `next build` collects page data, so only
// fail outside the build phase when no connection string is configured.
if (!databaseUrl && process.env.NEXT_PHASE !== "phase-production-build") {
  throw new Error("DATABASE_URL or NETLIFY_DB_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

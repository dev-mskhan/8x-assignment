/**
 * Drizzle database client factory.
 *
 * Creates the Drizzle client from a PostgreSQL connection pool.
 * Used by apps/server/src/core/db/db.ts during startup.
 *
 * Only one database client should exist in the application (AGENTS.md §7).
 * Do not call createDrizzleClient() from multiple places.
 *
 * Implemented in Phase 1.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index";

export type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Creates a new Drizzle client with the given PostgreSQL connection string.
 * The pool is managed internally — call pool.end() via the returned client's
 * $client property during shutdown.
 */
export function createDrizzleClient(connectionUrl: string): {
  db: DrizzleClient;
  pool: Pool;
} {
  const pool = new Pool({
    connectionString: connectionUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const db = drizzle(pool, { schema });

  return { db, pool };
}

/**
 * Centralized Drizzle database client.
 *
 * Only this module calls drizzle(). All other code uses getDb().
 * Do not call drizzle() anywhere else in the application (AGENTS.md §7).
 *
 * Implemented in Phase 1.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@marketplace/database";

export type Db = NodePgDatabase<typeof schema>;

let _db: Db | null = null;

/**
 * Returns the singleton database client.
 * Must be initialized via initDb() during startup before calling getDb().
 */
export function getDb(): Db {
  if (!_db) {
    throw new Error("Database not initialized. Call initDb() during startup.");
  }
  return _db;
}

/**
 * Initializes the database client with the given connection string.
 * Called once during application startup.
 *
 * TODO: Phase 1 — implement with pg pool + drizzle
 */
export async function initDb(_connectionUrl: string): Promise<void> {
  throw new Error("Not implemented — Phase 1");
}

/**
 * Closes the database connection pool.
 * Called during graceful shutdown.
 *
 * TODO: Phase 1 — implement
 */
export async function closeDb(): Promise<void> {
  // TODO: Phase 1
}

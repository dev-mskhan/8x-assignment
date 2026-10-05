/**
 * Centralized Drizzle database client.
 *
 * Only this module calls drizzle(). All other code uses getDb().
 * Do not call drizzle() anywhere else in the application (AGENTS.md §7).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@marketplace/database";
import { createLogger } from "../logger/logger";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const logger = createLogger("db");

let _db: Db | null = null;
let _pool: Pool | null = null;

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
 * Returns the raw pg Pool (for health checks, transactions, etc.)
 */
export function getPool(): Pool {
  if (!_pool) {
    throw new Error("Database pool not initialized. Call initDb() during startup.");
  }
  return _pool;
}

/**
 * Initializes the database client with the given connection string.
 * Called once during application startup.
 */
export async function initDb(connectionUrl: string): Promise<void> {
  const pool = new Pool({
    connectionString: connectionUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Verify connectivity
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    logger.info("Database connection established");
  } finally {
    client.release();
  }

  _pool = pool;
  _db = drizzle(pool, { schema });
}

/**
 * Closes the database connection pool.
 * Called during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _db = null;
    _pool = null;
    logger.info("Database connection closed");
  }
}

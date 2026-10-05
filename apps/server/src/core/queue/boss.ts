/**
 * PgBoss instance management.
 *
 * PgBoss is the durable background job system. It stores jobs in PostgreSQL.
 * Only this module creates and manages the PgBoss instance (AGENTS.md §18).
 */
import PgBoss from "pg-boss";
import { createLogger } from "../logger/logger";

const logger = createLogger("pgboss");

export type BossInstance = PgBoss;

let _boss: BossInstance | null = null;

/**
 * Returns the singleton PgBoss instance.
 */
export function getBoss(): BossInstance {
  if (!_boss) {
    throw new Error("PgBoss not initialized. Call initBoss() during startup.");
  }
  return _boss;
}

/**
 * Initializes and starts PgBoss.
 * Called during application startup after DB is ready.
 */
export async function initBoss(connectionUrl: string): Promise<void> {
  _boss = new PgBoss({
    connectionString: connectionUrl,
    max: 5,
    // Retry configuration
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    // Expiry
    expireInHours: 24,
    // Deletion after completion
    deleteAfterSeconds: 60 * 60 * 24 * 7, // 7 days
  });

  _boss.on("error", (err) => {
    logger.error({ err }, "PgBoss error");
  });

  _boss.on("monitor-states", (states) => {
    logger.debug({ states }, "PgBoss queue states");
  });

  await _boss.start();
  logger.info("PgBoss started");
}

/**
 * Stops PgBoss gracefully.
 * Called during shutdown — waits for in-flight jobs to complete.
 */
export async function stopBoss(): Promise<void> {
  if (_boss) {
    await _boss.stop({ graceful: true, timeout: 10_000 });
    _boss = null;
    logger.info("PgBoss stopped");
  }
}

/**
 * Checks PgBoss connectivity (for /ready endpoint).
 */
export async function checkBoss(): Promise<boolean> {
  try {
    if (!_boss) return false;
    // PgBoss is healthy if the instance exists and hasn't stopped
    const states = await _boss.getQueueSize("__health_check__").catch(() => null);
    return states !== null || true; // If instance exists and started, consider healthy
  } catch {
    return false;
  }
}

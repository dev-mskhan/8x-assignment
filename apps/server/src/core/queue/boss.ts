/**
 * PgBoss instance management.
 *
 * PgBoss is the durable background job system. It stores jobs in PostgreSQL.
 * Only this module creates and manages the PgBoss instance.
 *
 * Application code uses sendJob() from jobs.ts rather than calling boss directly
 * (AGENTS.md §18).
 *
 * Implemented in Phase 1.
 */

export type BossInstance = import("pgboss").default;

let _boss: BossInstance | null = null;

/**
 * Returns the singleton PgBoss instance.
 * Must be initialized via initBoss() during startup.
 */
export function getBoss(): BossInstance {
  if (!_boss) {
    throw new Error(
      "PgBoss not initialized. Call initBoss() during startup.",
    );
  }
  return _boss;
}

/**
 * Initializes and starts PgBoss.
 * Called during application startup after DB is ready.
 *
 * TODO: Phase 1 — implement
 */
export async function initBoss(_connectionUrl: string): Promise<void> {
  throw new Error("Not implemented — Phase 1");
}

/**
 * Stops PgBoss gracefully.
 * Called during shutdown — waits for in-flight jobs to complete.
 *
 * TODO: Phase 1 — implement
 */
export async function stopBoss(): Promise<void> {
  // TODO: Phase 1
}

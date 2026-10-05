/**
 * Worker process entry point.
 *
 * Responsibilities (per AGENTS.md §4):
 * - Start PgBoss
 * - Register all background workers
 * - Process asynchronous jobs
 * - Graceful shutdown
 *
 * Workers are registered here by calling module-specific register functions:
 *   registerNotificationWorkers(boss);
 *   registerEmailWorkers(boss);
 *   registerOrderWorkers(boss);
 *   registerCatalogWorkers(boss);
 *
 * Workers are thin — business logic belongs in module services.
 * Do not put business logic directly inside worker callbacks (AGENTS.md §19).
 *
 * Implemented in Phase 1.
 */

// TODO: Phase 1 — implement worker startup + graceful shutdown
// TODO: Phase 2+ — register module workers as they are built
async function startWorker(): Promise<void> {
  throw new Error("Not implemented — Phase 1");
}

startWorker().catch((err) => {
  console.error("Fatal worker startup error:", err);
  process.exit(1);
});

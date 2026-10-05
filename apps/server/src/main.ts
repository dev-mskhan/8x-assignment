/**
 * API process entry point.
 *
 * Startup order (per AGENTS.md §47):
 * 1. Validate environment
 * 2. Initialize logger
 * 3. Initialize database
 * 4. Initialize Redis
 * 5. Create Fastify app
 * 6. Register plugins
 * 7. Register routes
 * 8. Register WebSocket handlers
 * 9. Start HTTP server
 * 10. Start PgBoss
 * 11. Register workers
 * 12. Start outbox publisher
 *
 * Implemented in Phase 1.
 */

// TODO: Phase 1 — implement full startup sequence
async function main(): Promise<void> {
  // Phase 1: validate env, boot Fastify, connect DB/Redis/PgBoss
  throw new Error("Not implemented — Phase 1");
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

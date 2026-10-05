/**
 * Transactional outbox publisher.
 *
 * The outbox pattern ensures that asynchronous side effects are reliably
 * triggered even if the process crashes between DB commit and job enqueue
 * (AGENTS.md §22–23).
 *
 * Flow:
 *   DB transaction
 *     ├── domain changes
 *     └── INSERT outbox_events
 *          ↓ commit
 *       OutboxPublisher polls
 *          ↓
 *       sendJob() → PgBoss
 *          ↓
 *       Worker → Service
 *
 * Implemented in Phase 1.
 */

export interface OutboxPublisher {
  /** Start the polling loop */
  start(): Promise<void>;
  /** Stop the polling loop gracefully */
  stop(): Promise<void>;
}

/**
 * Creates the outbox publisher instance.
 * Polls for pending outbox_events and dispatches them via PgBoss.
 *
 * TODO: Phase 1 — implement polling loop
 */
export function createOutboxPublisher(): OutboxPublisher {
  return {
    async start() {
      // TODO: Phase 1
    },
    async stop() {
      // TODO: Phase 1
    },
  };
}

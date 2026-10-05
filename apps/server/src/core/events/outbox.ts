/**
 * Transactional outbox publisher.
 *
 * Polls outbox_events for PENDING rows and dispatches them via PgBoss.
 * The outbox guarantees that asynchronous side effects are not lost even
 * if the process crashes between DB commit and job enqueue (AGENTS.md §22).
 *
 * Flow:
 *   DB transaction (domain changes + INSERT outbox_events)
 *     ↓ commit
 *   OutboxPublisher polls every 2 seconds
 *     ↓
 *   sendJob() → PgBoss → Worker → Service
 */
import { sql } from "drizzle-orm";
import { createLogger } from "../logger/logger";
import { getDb } from "../db/db";
import { sendJob } from "../queue/jobs";

const logger = createLogger("outbox");

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 50;

interface OutboxRow extends Record<string, unknown> {
  id: string;
  type: string;
  aggregate_id: string;
  payload: unknown;
}

export interface OutboxPublisher {
  start(): void;
  stop(): void;
}

/**
 * Creates the outbox publisher instance.
 */
export function createOutboxPublisher(): OutboxPublisher {
  let _timer: ReturnType<typeof setInterval> | null = null;
  let _running = false;

  async function processBatch(): Promise<void> {
    // Phase 2 will wire this to the real outbox_events table.
    // For Phase 1: no-op if table doesn't exist yet.
    try {
      const db = getDb();

      // Safely check if the table exists before querying
      const existsResult = await db
        .execute<{ exists: boolean }>(
          sql`SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'outbox_events'
          )`,
        )
        .catch(() => null);

      if (!existsResult) return;

      const firstRow = existsResult.rows[0];
      if (!firstRow || firstRow.exists !== true) return;

      // Fetch and lock pending events atomically — typed via generic parameter
      const fetchResult = await db
        .execute<OutboxRow>(
          sql`
            UPDATE outbox_events
            SET status = 'processing', updated_at = NOW()
            WHERE id IN (
              SELECT id FROM outbox_events
              WHERE status = 'pending'
              ORDER BY created_at ASC
              LIMIT ${BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, type, aggregate_id, payload
          `,
        )
        .catch(() => null);

      if (!fetchResult) return;

      const events = fetchResult.rows;

      for (const event of events) {
        try {
          await sendJob(event.type, {
            ...(event.payload as object),
            aggregateId: event.aggregate_id,
            outboxEventId: event.id,
          });

          await db.execute(
            sql`UPDATE outbox_events SET status = 'completed', updated_at = NOW() WHERE id = ${event.id}`,
          );
        } catch (err) {
          logger.error(
            { err, eventId: event.id, eventType: event.type },
            "Failed to dispatch outbox event",
          );
          await db
            .execute(
              sql`UPDATE outbox_events SET status = 'failed', updated_at = NOW() WHERE id = ${event.id}`,
            )
            .catch(() => {});
        }
      }

      if (events.length > 0) {
        logger.debug({ count: events.length }, "Outbox events dispatched");
      }
    } catch (err) {
      // Non-fatal: log and continue polling
      logger.warn({ err }, "Outbox poll cycle error (non-fatal)");
    }
  }

  return {
    start(): void {
      if (_running) return;
      _running = true;
      logger.info("Outbox publisher started");
      _timer = setInterval(() => {
        void processBatch();
      }, POLL_INTERVAL_MS);
    },

    stop(): void {
      if (_timer) {
        clearInterval(_timer);
        _timer = null;
      }
      _running = false;
      logger.info("Outbox publisher stopped");
    },
  };
}

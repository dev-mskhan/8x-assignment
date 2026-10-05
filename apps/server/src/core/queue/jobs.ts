/**
 * Central job dispatch abstraction.
 *
 * All application code uses sendJob() rather than calling PgBoss directly.
 * This keeps PgBoss implementation details centralized (AGENTS.md §18).
 *
 * Usage:
 *   import { sendJob } from "@/core/queue/jobs";
 *   import { ORDER_JOBS } from "@/modules/orders/orders.jobs";
 *
 *   await sendJob(ORDER_JOBS.SEND_CONFIRMATION, { orderId });
 *
 * Implemented in Phase 1.
 */

export interface SendJobOptions {
  /** Unique key to prevent duplicate job insertion */
  idempotencyKey?: string;
  /** Delay before the job becomes available (seconds) */
  startAfterSeconds?: number;
  /** Number of retry attempts on failure */
  retryLimit?: number;
  /** Delay between retries (seconds) */
  retryDelaySeconds?: number;
  /** Job expiry timeout (seconds) */
  expireInSeconds?: number;
}

/**
 * Enqueues a job by name with the given payload.
 * Should be called from service layer, not from controllers or repositories.
 *
 * TODO: Phase 1 — implement using getBoss()
 */
export async function sendJob<T extends object>(
  _jobName: string,
  _data: T,
  _options?: SendJobOptions,
): Promise<string | null> {
  throw new Error("Not implemented — Phase 1");
}

/**
 * Central job dispatch abstraction.
 *
 * All application code uses sendJob() rather than calling PgBoss directly.
 * This keeps PgBoss implementation details centralized (AGENTS.md §18).
 *
 * Usage:
 *   import { sendJob } from "@/core/queue/jobs";
 *   import { ORDER_JOBS } from "@/modules/orders/orders.jobs";
 *   await sendJob(ORDER_JOBS.SEND_CONFIRMATION, { orderId });
 */
import { getBoss } from "./boss";
import { createLogger } from "../logger/logger";

const logger = createLogger("jobs");

export interface SendJobOptions {
  /** Unique key to prevent duplicate job insertion */
  singletonKey?: string;
  /** Delay before the job becomes available — number (seconds), ISO string, or Date */
  startAfter?: number | string | Date;
  /** Number of retry attempts on failure */
  retryLimit?: number;
  /** Delay between retries (seconds) */
  retryDelay?: number;
  /** Job expiry timeout (seconds) */
  expireInSeconds?: number;
}

/**
 * Enqueues a job by name with the given payload.
 * Should be called from service layer, not from controllers or repositories.
 * Returns the job ID or null if enqueue failed.
 */
export async function sendJob<T extends object>(
  jobName: string,
  data: T,
  options: SendJobOptions = {},
): Promise<string | null> {
  try {
    const boss = getBoss();

    // Build send options — only include defined keys because pg-boss uses
    // exactOptionalPropertyTypes-compatible signatures internally.
    const sendOptions: Record<string, unknown> = {};
    if (options.singletonKey !== undefined) sendOptions["singletonKey"] = options.singletonKey;
    if (options.startAfter !== undefined) sendOptions["startAfter"] = options.startAfter;
    if (options.retryLimit !== undefined) sendOptions["retryLimit"] = options.retryLimit;
    if (options.retryDelay !== undefined) sendOptions["retryDelay"] = options.retryDelay;
    if (options.expireInSeconds !== undefined) sendOptions["expireInSeconds"] = options.expireInSeconds;

    const jobId = await boss.send(jobName, data, sendOptions as Parameters<typeof boss.send>[2]);
    logger.debug({ jobName, jobId }, "Job enqueued");
    return jobId;
  } catch (err) {
    logger.error({ err, jobName }, "Failed to enqueue job");
    return null;
  }
}

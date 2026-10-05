/**
 * Worker registration helper.
 *
 * Workers are thin — business logic belongs in services (AGENTS.md §19).
 *
 * Usage:
 *   registerWorker(boss, { queue: ORDER_JOBS.EXPIRE, concurrency: 5 }, async (job) => {
 *     await orderService.expireOrder(job.data.orderId);
 *   });
 */
import type { BossInstance } from "./boss";
import { createLogger } from "../logger/logger";

const logger = createLogger("worker");

export interface WorkerOptions {
  queue: string;
  /** How many jobs this worker processes in parallel */
  concurrency?: number;
  teamConcurrency?: number;
}

export type WorkerHandler<T extends object = object> = (job: {
  id: string;
  name: string;
  data: T;
}) => Promise<void>;

/**
 * Registers a PgBoss worker for the given queue.
 * The handler receives the job payload and should call a service method —
 * not contain business logic itself (AGENTS.md §19).
 *
 * Error handling:
 *  - Handler errors are caught and logged; PgBoss retries per its retry policy.
 *  - Unhandled promise rejections from PgBoss.work are forwarded via the boss error event.
 */
export function registerWorker<T extends object>(
  boss: BossInstance,
  options: WorkerOptions,
  handler: WorkerHandler<T>,
): void {
  void boss.work<T>(
    options.queue,
    { teamConcurrency: options.concurrency ?? options.teamConcurrency ?? 1 },
    async (job) => {
      logger.debug({ queue: options.queue, jobId: job.id }, "Processing job");
      try {
        await handler({ id: job.id, name: job.name, data: job.data });
        logger.debug({ queue: options.queue, jobId: job.id }, "Job completed");
      } catch (err) {
        logger.error({ queue: options.queue, jobId: job.id, err }, "Job handler failed");
        throw err; // re-throw so PgBoss marks the job as failed and retries
      }
    },
  );
  logger.info({ queue: options.queue, concurrency: options.concurrency ?? 1 }, "Worker registered");
}

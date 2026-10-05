/**
 * Worker registration helper.
 *
 * Workers are thin — business logic belongs in services (AGENTS.md §19).
 *
 * Usage:
 *   registerWorker(boss, { queue: ORDER_JOBS.EXPIRE, concurrency: 5 }, async (job) => {
 *     await orderService.expireOrder(job.data.orderId);
 *   });
 *
 * Implemented in Phase 1.
 */
import type { BossInstance } from "./boss";

export interface WorkerOptions {
  queue: string;
  /** How many jobs this worker processes in parallel */
  concurrency?: number;
  /** Job-level timeout in seconds */
  teamConcurrency?: number;
}

export type WorkerHandler<T extends object = object> = (job: {
  id: string;
  name: string;
  data: T;
}) => Promise<void>;

/**
 * Registers a worker for the given queue.
 * The handler receives the job payload — it should call a service method,
 * not contain business logic itself.
 *
 * TODO: Phase 1 — implement using PgBoss.work()
 */
export function registerWorker<T extends object>(
  _boss: BossInstance,
  _options: WorkerOptions,
  _handler: WorkerHandler<T>,
): void {
  // TODO: Phase 1
}

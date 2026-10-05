/**
 * Centralized Redis client.
 *
 * Only this module creates ioredis connections.
 * All application code uses getRedis() (AGENTS.md §25).
 *
 * Fail-open policy: Redis failures must not take down the API
 * for non-critical operations. Cache reads/writes wrap with try/catch
 * and fall back to PostgreSQL.
 *
 * Implemented in Phase 1.
 */

export type RedisClient = import("ioredis").Redis;

let _redis: RedisClient | null = null;

/**
 * Returns the singleton Redis client.
 * Must be initialized via initRedis() during startup.
 */
export function getRedis(): RedisClient {
  if (!_redis) {
    throw new Error("Redis not initialized. Call initRedis() during startup.");
  }
  return _redis;
}

/**
 * Initializes the Redis connection.
 * Called once during application startup.
 *
 * TODO: Phase 1 — implement with ioredis
 */
export async function initRedis(_url: string): Promise<void> {
  throw new Error("Not implemented — Phase 1");
}

/**
 * Closes the Redis connection.
 * Called during graceful shutdown.
 *
 * TODO: Phase 1 — implement
 */
export async function closeRedis(): Promise<void> {
  // TODO: Phase 1
}

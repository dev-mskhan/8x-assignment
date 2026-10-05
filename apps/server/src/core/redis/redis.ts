/**
 * Centralized Redis client.
 *
 * Two ioredis instances:
 *   - _redis: for commands (GET/SET/DEL, publishing)
 *   - _subscriber: for subscriptions (SUBSCRIBE/PSUBSCRIBE)
 *
 * Fail-open policy: Redis failures must not take down the API
 * for non-critical operations (AGENTS.md §27).
 */
import Redis from "ioredis";
import { createLogger } from "../logger/logger";

const logger = createLogger("redis");

let _redis: Redis | null = null;
let _subscriber: Redis | null = null;

function createClient(url: string, name: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: true,
    reconnectOnError: (err) => {
      logger.warn({ err: err.message }, `Redis ${name}: reconnecting after error`);
      return true;
    },
  });

  client.on("error", (err: Error) => {
    logger.warn({ err: err.message }, `Redis ${name} error (non-fatal)`);
  });

  client.on("connect", () => {
    logger.info(`Redis ${name} connected`);
  });

  client.on("close", () => {
    logger.info(`Redis ${name} connection closed`);
  });

  return client;
}

/**
 * Returns the singleton Redis command client.
 */
export function getRedis(): Redis {
  if (!_redis) {
    throw new Error("Redis not initialized. Call initRedis() during startup.");
  }
  return _redis;
}

/**
 * Returns the Redis subscriber client (used exclusively for SUBSCRIBE).
 */
export function getSubscriber(): Redis {
  if (!_subscriber) {
    throw new Error("Redis subscriber not initialized. Call initRedis() during startup.");
  }
  return _subscriber;
}

/**
 * Initializes both Redis clients.
 * Called once during application startup.
 */
export async function initRedis(url: string): Promise<void> {
  _redis = createClient(url, "command");
  _subscriber = createClient(url, "subscriber");

  // Connect both — fail-open: log warning if Redis is unavailable
  await Promise.all([
    _redis.connect().catch((err: Error) => {
      logger.warn({ err: err.message }, "Redis command client failed to connect (non-fatal)");
    }),
    _subscriber.connect().catch((err: Error) => {
      logger.warn({ err: err.message }, "Redis subscriber client failed to connect (non-fatal)");
    }),
  ]);
}

/**
 * Closes both Redis connections.
 * Called during graceful shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => _redis?.disconnect());
    _redis = null;
  }
  if (_subscriber) {
    await _subscriber.quit().catch(() => _subscriber?.disconnect());
    _subscriber = null;
  }
  logger.info("Redis connections closed");
}

/**
 * Checks Redis connectivity (for /ready endpoint).
 */
export async function checkRedis(): Promise<boolean> {
  try {
    if (!_redis) return false;
    await _redis.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Redis Pub/Sub abstraction.
 *
 * Hides ioredis implementation details from modules (AGENTS.md §25).
 * Used for live, ephemeral cross-instance WebSocket fan-out only.
 *
 * Redis Pub/Sub is NOT durable. Important events must be persisted
 * via the outbox/PgBoss pipeline BEFORE being published here.
 *
 * Channel naming convention: <module>:<type>:<identifier>
 * Example: user:{userId}:events, system:events
 *
 * Implemented in Phase 7.
 */

export type PubSubHandler = (message: string) => void;

/**
 * Publish a message to a Redis channel.
 * Fails open — errors are logged but do not throw.
 *
 * TODO: Phase 7 — implement
 */
export async function publish(
  _channel: string,
  _message: unknown,
): Promise<void> {
  // TODO: Phase 7
}

/**
 * Subscribe to a Redis channel.
 * Returns an unsubscribe function.
 *
 * TODO: Phase 7 — implement
 */
export function subscribe(
  _channel: string,
  _handler: PubSubHandler,
): () => void {
  // TODO: Phase 7
  return () => {};
}

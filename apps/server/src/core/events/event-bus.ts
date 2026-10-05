/**
 * In-process event bus (lightweight, synchronous).
 *
 * Used for in-process pub/sub within a single request lifecycle.
 * NOT a replacement for the outbox or Redis Pub/Sub.
 *
 * For durable side effects: use the outbox (outbox.ts).
 * For cross-instance realtime: use Redis Pub/Sub (pubsub.ts).
 * For durable async work: use PgBoss (jobs.ts).
 *
 * Implemented in Phase 1 if needed; may remain a thin stub.
 */

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface EventBus {
  emit<T>(event: string, payload: T): void;
  on<T>(event: string, handler: EventHandler<T>): void;
  off<T>(event: string, handler: EventHandler<T>): void;
}

/**
 * Creates a simple in-process event bus.
 * TODO: Phase 1 — implement if needed
 */
export function createEventBus(): EventBus {
  const handlers = new Map<string, EventHandler[]>();
  return {
    emit(event, payload) {
      handlers.get(event)?.forEach((h) => void h(payload));
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler as EventHandler);
    },
    off(event, handler) {
      const list = handlers.get(event);
      if (!list) return;
      const idx = list.indexOf(handler as EventHandler);
      if (idx !== -1) list.splice(idx, 1);
    },
  };
}

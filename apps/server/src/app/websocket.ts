/**
 * WebSocket server setup.
 *
 * Responsibilities (per AGENTS.md §5):
 * - Authenticate WebSocket connections (session/token check on upgrade)
 * - Maintain in-memory connection registry: Map<UserId, Set<WebSocket>>
 * - Subscribe to Redis Pub/Sub channels (user:{userId}:events)
 * - Forward relevant events to connected clients
 * - Clean up disconnected clients
 *
 * Must not contain business rules.
 * Cross-instance fan-out uses Redis Pub/Sub.
 *
 * Implemented in Phase 7.
 */
import type { FastifyInstance } from "fastify";

// TODO: Phase 7 — implement WebSocket handler
export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  // Placeholder — WebSocket endpoint registered but not yet implemented
  void app;
}

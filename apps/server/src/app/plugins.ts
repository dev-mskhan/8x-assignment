/**
 * Global Fastify plugin registration.
 *
 * Registers:
 * - @fastify/helmet       (security headers)
 * - @fastify/cors         (CORS)
 * - @fastify/cookie       (cookies)
 * - @fastify/rate-limit   (rate limiting)
 * - @fastify/sensible     (HTTP utilities)
 * - @fastify/swagger      (OpenAPI spec)
 * - @fastify/swagger-ui   (Swagger UI at /docs)
 * - @fastify/websocket    (WebSocket support)
 * - authentication hooks  (requireAuth, requireRole)
 *
 * Implemented in Phase 1.
 */
import type { FastifyInstance } from "fastify";

// TODO: Phase 1 — register all plugins
export async function registerPlugins(app: FastifyInstance): Promise<void> {
  throw new Error("Not implemented — Phase 1");
}

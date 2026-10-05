/**
 * Fastify application factory.
 *
 * Creates and returns a configured Fastify instance.
 * Does not contain business logic.
 * Plugins and routes are registered separately (plugins.ts / routes.ts).
 *
 * Implemented in Phase 1.
 */
import type { FastifyInstance } from "fastify";

// TODO: Phase 1 — create real Fastify instance with logger + type provider
export async function buildApp(): Promise<FastifyInstance> {
  throw new Error("Not implemented — Phase 1");
}

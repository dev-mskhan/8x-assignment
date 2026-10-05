/**
 * Module route registration.
 *
 * Registers all module routes under /api/v1.
 * Example (Phase 1+):
 *   app.register(healthRoutes);
 *   app.register(authRoutes, { prefix: "/api/v1/auth" });
 *   app.register(catalogRoutes, { prefix: "/api/v1" });
 *
 * Implemented incrementally from Phase 1.
 */
import type { FastifyInstance } from "fastify";

// TODO: Phase 1 — register operational routes (/health, /ready, /api/v1/meta)
// TODO: Phase 2+ — register module routes as they are built
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  throw new Error("Not implemented — Phase 1");
}

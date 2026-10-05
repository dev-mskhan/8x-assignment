/**
 * Fastify application factory.
 *
 * Creates and returns a configured Fastify instance.
 * Does not contain business logic.
 * Plugins and routes are registered via registerPlugins() / registerRoutes().
 */
import Fastify, { type FastifyInstance, FastifyBaseLogger } from "fastify";
import { serverEnv } from "@marketplace/env";
import { getRootLogger } from "../core/logger/logger";
import { registerPlugins } from "./plugins";
import { registerRoutes } from "./routes";
import { registerWebSocket } from "./websocket";
import { errorHandler } from "../core/errors/error-handler";

// Import augmentation so request.user is typed
import "../core/auth/context";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Cast through unknown — Pino Logger satisfies FastifyBaseLogger at runtime
    // but their TypeScript types diverge on version/levels properties.
    logger: getRootLogger() as unknown as FastifyBaseLogger,
    trustProxy: true,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",
    genReqId: () => crypto.randomUUID(),
    ajv: {
      customOptions: {
        removeAdditional: false,
        useDefaults: true,
        coerceTypes: false,
        allErrors: true,
      },
    },
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Plugins (helmet, cors, cookie, rate-limit, swagger)
  await registerPlugins(app);

  // HTTP routes
  await registerRoutes(app);

  // WebSocket (stub for Phase 1, implemented in Phase 7)
  registerWebSocket(app);

  // Log all registered routes in development
  if (serverEnv.NODE_ENV === "development") {
    void app.ready().then(() => {
      const routes = app.printRoutes({ includeHooks: false });
      // Use the root logger directly — avoids Pino/FastifyBaseLogger type mismatch
      getRootLogger().debug({ routes }, "Registered routes");
    });
  }

  return app;
}

/**
 * Route registration.
 *
 * Operational routes (Phase 1):
 *   GET /health          — liveness
 *   GET /ready           — readiness (DB + Redis + PgBoss)
 *   GET /api/v1/meta     — API metadata
 *   GET /docs            — Swagger UI (registered by plugin)
 *   GET /api/v1/openapi.json — OpenAPI spec (registered by plugin)
 *
 * Module routes added from Phase 2 onward.
 *
 * Swagger schema covers all response cases: 200, 503, 500.
 * Zod schemas live in @marketplace/shared and are used for runtime validation
 * where applicable.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  healthResponseSchema,
  readinessResponseSchema,
  metaResponseSchema,
  errorResponseSchema,
} from "@marketplace/shared";
import { checkRedis } from "../core/redis/redis";
import { checkBoss } from "../core/queue/boss";
import { getPool } from "../core/db/db";
import { createLogger } from "../core/logger/logger";
import { catalogRoutes } from "../modules/catalog/catalog.routes";
import { authRoutes }    from "../modules/auth/auth.routes";
import { usersRoutes }   from "../modules/users/users.routes";

const logger = createLogger("routes");

// ---- Shared Swagger JSON Schema fragments ---------------------------------

const errorResponseJsonSchema = {
  type: "object",
  required: ["success", "error"],
  properties: {
    success: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", example: "INTERNAL_ERROR" },
        message: { type: "string", example: "An unexpected error occurred" },
        details: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

// ---- Route registration --------------------------------------------------

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /health --------------------------------------------------------
  // Liveness: always 200 if the process is running.
  // Does NOT check DB or Redis — use /ready for that.
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Liveness check",
        description: [
          "Returns `200 ok` as long as the API process is alive.",
          "Does **not** check downstream dependencies.",
          "Use `/ready` for a full dependency health check.",
          "",
          "Suitable for load-balancer liveness probes.",
        ].join("\n"),
        response: {
          200: {
            description: "API process is running",
            type: "object",
            required: ["status", "timestamp"],
            properties: {
              status: { type: "string", enum: ["ok"], example: "ok" },
              timestamp: {
                type: "string",
                format: "date-time",
                example: "2026-10-05T12:00:00.000Z",
              },
            },
          },
          500: { description: "Unexpected server error", ...errorResponseJsonSchema },
        },
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const result = healthResponseSchema.parse({
        status: "ok",
        timestamp: new Date().toISOString(),
      });
      return reply.status(200).send(result);
    },
  );

  // ---- GET /ready ---------------------------------------------------------
  // Readiness: checks DB, Redis, PgBoss with 2 s timeout each.
  app.get(
    "/ready",
    {
      schema: {
        tags: ["health"],
        summary: "Readiness check",
        description: [
          "Checks all infrastructure dependencies.",
          "",
          "Returns `200 ok` when all checks pass.",
          "Returns `503 degraded` when one or more checks fail.",
          "",
          "Each check has a 2-second timeout.",
          "Suitable for load-balancer readiness probes.",
          "",
          "Checks performed:",
          "- **database** — PostgreSQL `SELECT 1`",
          "- **redis** — Redis `PING`",
          "- **pgboss** — PgBoss instance health",
        ].join("\n"),
        response: {
          200: {
            description: "All checks passed — service is ready",
            type: "object",
            required: ["status", "checks"],
            properties: {
              status: { type: "string", enum: ["ok"], example: "ok" },
              checks: {
                type: "object",
                required: ["database", "redis", "pgboss"],
                properties: {
                  database: { type: "string", enum: ["ok", "fail"] },
                  redis: { type: "string", enum: ["ok", "fail"] },
                  pgboss: { type: "string", enum: ["ok", "fail"] },
                },
                example: { database: "ok", redis: "ok", pgboss: "ok" },
              },
            },
          },
          503: {
            description: "One or more checks failed — service is not fully ready",
            type: "object",
            required: ["status", "checks"],
            properties: {
              status: { type: "string", enum: ["degraded"], example: "degraded" },
              checks: {
                type: "object",
                required: ["database", "redis", "pgboss"],
                properties: {
                  database: { type: "string", enum: ["ok", "fail"] },
                  redis: { type: "string", enum: ["ok", "fail"] },
                  pgboss: { type: "string", enum: ["ok", "fail"] },
                },
                example: { database: "fail", redis: "ok", pgboss: "fail" },
              },
            },
          },
          500: {
            description: "Unexpected server error during health check",
            ...errorResponseJsonSchema,
          },
        },
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const TIMEOUT_MS = 2_000;

      function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
        return Promise.race([
          promise,
          new Promise<T>((resolve) =>
            setTimeout(() => resolve(fallback), TIMEOUT_MS),
          ),
        ]);
      }

      let dbOk = false;
      let redisOk = false;
      let bossOk = false;

      try {
        [dbOk, redisOk, bossOk] = await Promise.all([
          withTimeout(
            getPool()
              .query("SELECT 1")
              .then(() => true)
              .catch(() => false),
            false,
          ),
          withTimeout(checkRedis(), false),
          withTimeout(checkBoss(), false),
        ]);
      } catch {
        // Non-fatal: report partial results
      }

      const checks = {
        database: dbOk ? ("ok" as const) : ("fail" as const),
        redis: redisOk ? ("ok" as const) : ("fail" as const),
        pgboss: bossOk ? ("ok" as const) : ("fail" as const),
      };

      const allOk = dbOk && redisOk && bossOk;

      const result = readinessResponseSchema.parse({
        status: allOk ? "ok" : "degraded",
        checks,
      });

      return reply.status(allOk ? 200 : 503).send(result);
    },
  );

  // ---- GET /api/v1/meta ---------------------------------------------------
  app.get(
    "/api/v1/meta",
    {
      schema: {
        tags: ["meta"],
        summary: "API metadata",
        description: [
          "Returns API name, version, and current environment.",
          "",
          "Useful for confirming which API version is deployed.",
        ].join("\n"),
        response: {
          200: {
            description: "API metadata",
            type: "object",
            required: ["name", "version", "environment", "timestamp"],
            properties: {
              name: { type: "string", example: "marketplace-api" },
              version: { type: "string", example: "0.0.1" },
              environment: {
                type: "string",
                enum: ["development", "test", "production"],
                example: "development",
              },
              timestamp: {
                type: "string",
                format: "date-time",
                example: "2026-10-05T12:00:00.000Z",
              },
            },
          },
          500: { description: "Unexpected server error", ...errorResponseJsonSchema },
        },
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const result = metaResponseSchema.parse({
        name: "marketplace-api",
        version: "0.0.1",
        environment: (process.env["NODE_ENV"] ?? "development") as
          | "development"
          | "test"
          | "production",
        timestamp: new Date().toISOString(),
      });
      return reply.status(200).send(result);
    },
  );

  // ---- Module routes -------------------------------------------------------
  await app.register(catalogRoutes, { prefix: "/api/v1" });
  await app.register(authRoutes,  { prefix: "/api/v1" });
  await app.register(usersRoutes, { prefix: "/api/v1" });

  // ---- Catch-all 404 handler -----------------------------------------------
  app.setNotFoundHandler((_req: FastifyRequest, reply: FastifyReply) => {
    void reply.status(404).send(
      errorResponseSchema.parse({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Route not found",
        },
      }),
    );
  });

  logger.info("Routes registered");
}

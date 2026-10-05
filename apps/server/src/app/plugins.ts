/**
 * Global Fastify plugin registration.
 *
 * Order matters — plugins register in sequence.
 * Security plugins (helmet, cors) are registered first.
 */
import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { serverEnv } from "@marketplace/env";
import { createLogger } from "../core/logger/logger";

const logger = createLogger("plugins");

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  // ---- Security -----------------------------------------------------------
  await app.register(helmet, {
    contentSecurityPolicy: serverEnv.NODE_ENV === "production",
  });

  await app.register(cors, {
    origin: serverEnv.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // ---- Cookies ------------------------------------------------------------
  await app.register(cookie, {
    secret: serverEnv.COOKIE_SECRET,
    hook: "onRequest",
    parseOptions: {},
  });

  // ---- Rate limiting ------------------------------------------------------
  await app.register(rateLimit, {
    max: serverEnv.RATE_LIMIT_MAX,
    timeWindow: serverEnv.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) =>
      (req.headers["x-forwarded-for"] as string) || req.ip || "unknown",
    errorResponseBuilder: (_req, context) => ({
      success: false,
      error: {
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded. Retry after ${context.after}`,
      },
    }),
  });

  // ---- HTTP utilities -----------------------------------------------------
  await app.register(sensible);

  // ---- OpenAPI / Swagger --------------------------------------------------
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Marketplace API",
        description:
          "Amazon-style multi-seller marketplace API — modular monolith",
        version: "0.0.1",
        contact: {
          name: "Marketplace API",
        },
      },
      servers: [
        {
          url: serverEnv.APP_URL,
          description:
            serverEnv.NODE_ENV === "production" ? "Production" : "Development",
        },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "access_token",
            description: "Signed HttpOnly cookie containing the JWT access token",
          },
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "Bearer token (non-production only — for API testing convenience)",
          },
        },
      },
      security: [{ cookieAuth: [] }],
      tags: [
        { name: "health", description: "Health and readiness endpoints" },
        { name: "meta", description: "API metadata" },
        { name: "auth", description: "Authentication (Phase 3)" },
        { name: "catalog", description: "Products and categories (Phase 2+)" },
        { name: "cart", description: "Shopping cart (Phase 4)" },
        { name: "orders", description: "Order management (Phase 4+)" },
        { name: "sellers", description: "Seller marketplace (Phase 5)" },
        { name: "payments", description: "Payment processing (Phase 6)" },
        { name: "notifications", description: "Notifications (Phase 7)" },
        { name: "search", description: "Search and AI (Phase 8)" },
        { name: "admin", description: "Admin operations (Phase 9)" },
      ],
    },
    hideUntagged: false,
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: false,
    transformStaticCSP: (header) => header,
  });

  // ---- Request ID ---------------------------------------------------------
  app.addHook("onRequest", (_req, _reply, done) => {
    done();
  });

  app.addHook("onSend", (req, reply, _payload, done) => {
    void reply.header("x-request-id", req.id);
    done();
  });

  logger.info("Plugins registered");
}

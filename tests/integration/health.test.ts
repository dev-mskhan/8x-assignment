/**
 * Smoke test — Phase 1 (Chunk 16)
 *
 * Verifies the Fastify application lifecycle without requiring a live
 * PostgreSQL, Redis, or PgBoss instance.
 *
 * Tests:
 *   GET /health       → 200, { status: "ok", timestamp: <iso> }
 *   GET /api/v1/meta  → 200, { name: "marketplace-api", ... }
 *
 * The test sets the minimum required environment variables before
 * importing anything from the workspace so that @marketplace/env
 * parses successfully.
 */

// ---- Set env vars BEFORE any workspace imports --------------------------
// This must happen before @marketplace/env is evaluated.
process.env["NODE_ENV"] = "test";
process.env["PORT"] = "3099";
process.env["HOST"] = "127.0.0.1";
process.env["APP_URL"] = "http://localhost:3099";
process.env["CORS_ORIGINS"] = "http://localhost:3099";
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test_db";
process.env["REDIS_URL"] = "redis://localhost:6379";
process.env["JWT_SECRET"] = "test-jwt-secret-must-be-at-least-32-chars-long!";
process.env["SESSION_SECRET"] = "test-session-secret-must-be-32chars!!";
process.env["COOKIE_SECRET"] = "test-cookie-secret-must-be-32chars!!";

// ---- Imports (after env is set) -----------------------------------------
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// Inline require so vitest doesn't hoist the import above the env setup
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { buildApp } = await import("../../apps/server/src/app/app");

// -------------------------------------------------------------------------

describe("Smoke test — app lifecycle", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- GET /health --------------------------------------------------------
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(200);

      const body = res.json<{ status: string; timestamp: string }>();
      expect(body.status).toBe("ok");
      expect(typeof body.timestamp).toBe("string");
      // Must be a valid ISO-8601 date
      expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    });
  });

  // ---- GET /api/v1/meta ---------------------------------------------------
  describe("GET /api/v1/meta", () => {
    it("returns 200 with marketplace-api metadata", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/meta",
      });

      expect(res.statusCode).toBe(200);

      const body = res.json<{
        name: string;
        version: string;
        environment: string;
        timestamp: string;
      }>();
      expect(body.name).toBe("marketplace-api");
      expect(body.version).toBe("0.0.1");
      expect(["development", "test", "production"]).toContain(body.environment);
      expect(typeof body.timestamp).toBe("string");
    });
  });

  // ---- GET /ready ---------------------------------------------------------
  // /ready will return 503 (degraded) because DB/Redis/PgBoss are not
  // connected in this smoke test. That's the correct behaviour — just
  // verify the shape, not the status.
  describe("GET /ready", () => {
    it("returns readiness check with correct response shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/ready",
      });

      // Either 200 (all ok) or 503 (degraded) — both are valid in smoke test
      expect([200, 503]).toContain(res.statusCode);

      const body = res.json<{
        status: string;
        checks: { database: string; redis: string; pgboss: string };
      }>();
      expect(["ok", "degraded"]).toContain(body.status);
      expect(["ok", "fail"]).toContain(body.checks.database);
      expect(["ok", "fail"]).toContain(body.checks.redis);
      expect(["ok", "fail"]).toContain(body.checks.pgboss);
    });
  });

  // ---- 404 handler --------------------------------------------------------
  describe("unknown route", () => {
    it("returns 404 with error shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/does-not-exist",
      });

      expect(res.statusCode).toBe(404);

      const body = res.json<{ success: boolean; error: { code: string } }>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });
});

/**
 * Auth routes.
 *
 * All auth endpoints — public unless noted.
 * Rate limiting applied on login/register/forgot via route-level config
 * using AUTH_RATE_LIMIT_MAX / AUTH_RATE_LIMIT_WINDOW_MS from env.
 *
 * Registered at prefix /api/v1 (see app/routes.ts).
 *
 * AGENTS.md §11: No SQL, business logic, or direct Redis/PgBoss here.
 */
import type { FastifyInstance } from "fastify";
import { serverEnv } from "@marketplace/env";
import { requireAuth } from "../../core/auth/hooks";
import {
  registerHandler,
  loginHandler,
  logoutHandler,
  logoutAllHandler,
  refreshHandler,
  meHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  googleInitiateHandler,
  googleCallbackHandler,
  googleVerifyHandler,
  listSessionsHandler,
} from "./auth.controller";

const authRateLimit = {
  max:        serverEnv.AUTH_RATE_LIMIT_MAX,
  timeWindow: serverEnv.AUTH_RATE_LIMIT_WINDOW_MS,
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── Registration ─────────────────────────────────────────────────────────
  app.post(
    "/auth/register",
    {
      config: { rateLimit: authRateLimit },
      schema: {
        tags: ["auth"],
        summary: "Register a new customer account",
        body: {
          type: "object",
          required: ["email", "password", "name"],
          properties: {
            email:    { type: "string", format: "email" },
            password: { type: "string", minLength: 8, maxLength: 128 },
            name:     { type: "string", minLength: 1, maxLength: 255 },
          },
        },
      },
    },
    registerHandler,
  );

  // ── Login ─────────────────────────────────────────────────────────────────
  app.post(
    "/auth/login",
    {
      config: { rateLimit: authRateLimit },
      schema: {
        tags: ["auth"],
        summary: "Login with email and password",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email:    { type: "string", format: "email" },
            password: { type: "string", minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    loginHandler,
  );

  // ── Logout ────────────────────────────────────────────────────────────────
  app.post(
    "/auth/logout",
    {
      preHandler: [requireAuth],
      schema: { tags: ["auth"], summary: "Logout current session" },
    },
    logoutHandler,
  );

  app.post(
    "/auth/logout-all",
    {
      preHandler: [requireAuth],
      schema: { tags: ["auth"], summary: "Logout all sessions" },
    },
    logoutAllHandler,
  );

  // ── Refresh ───────────────────────────────────────────────────────────────
  app.post(
    "/auth/refresh",
    {
      schema: { tags: ["auth"], summary: "Rotate access + refresh tokens" },
    },
    refreshHandler,
  );

  // ── Me ────────────────────────────────────────────────────────────────────
  app.get(
    "/auth/me",
    {
      preHandler: [requireAuth],
      schema: { tags: ["auth"], summary: "Get current authenticated user" },
    },
    meHandler,
  );

  // ── Sessions ──────────────────────────────────────────────────────────────
  app.get(
    "/auth/me/sessions",
    {
      preHandler: [requireAuth],
      schema: { tags: ["auth"], summary: "List active sessions for current user" },
    },
    listSessionsHandler,
  );

  // ── Password Reset ────────────────────────────────────────────────────────
  app.post(
    "/auth/password/forgot",
    {
      config: { rateLimit: authRateLimit },
      schema: {
        tags: ["auth"],
        summary: "Request password reset email",
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
          },
        },
      },
    },
    forgotPasswordHandler,
  );

  app.post(
    "/auth/password/reset",
    {
      config: { rateLimit: authRateLimit },
      schema: {
        tags: ["auth"],
        summary: "Reset password with token",
        body: {
          type: "object",
          required: ["token", "newPassword"],
          properties: {
            token:       { type: "string" },
            newPassword: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    resetPasswordHandler,
  );

  // ── Google OAuth PKCE ─────────────────────────────────────────────────────
  app.get(
    "/auth/google",
    {
      schema: {
        tags: ["auth"],
        summary: "Initiate Google OAuth PKCE flow",
        description: "Returns authUrl. Client redirects browser to it. Returns 501 if Google OAuth not configured.",
      },
    },
    googleInitiateHandler,
  );

  app.get(
    "/auth/google/callback",
    {
      schema: {
        tags: ["auth"],
        summary: "Google OAuth callback (server-side)",
        description: "Handles Google redirect. Redirects browser to FRONTEND_URL/auth/callback#access_token=...",
        querystring: {
          type: "object",
          properties: {
            code:  { type: "string" },
            state: { type: "string" },
          },
        },
      },
    },
    googleCallbackHandler,
  );

  app.post(
    "/auth/google/verify",
    {
      schema: {
        tags: ["auth"],
        summary: "Exchange OAuth fragment token for HttpOnly cookies",
        description: "Frontend calls this after reading access_token from URL fragment. Sets proper HttpOnly cookies.",
        body: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
          },
        },
      },
    },
    googleVerifyHandler,
  );
}

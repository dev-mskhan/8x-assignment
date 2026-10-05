/**
 * Auth controller.
 *
 * HTTP boundary — reads request, calls service, sets cookies, returns response.
 * No business logic here (AGENTS.md §12).
 *
 * Cookie strategy:
 *  - access_token:  HttpOnly, path=/, 15 min
 *  - refresh_token: HttpOnly, path=/api/v1/auth/refresh, 7 days
 *  - Logout clears both cookies
 *
 * OAuth:
 *  - GET /auth/google          → returns { authUrl }
 *  - GET /auth/google/callback → redirects to FRONTEND_URL/auth/callback#access_token=...
 *  - POST /auth/google/verify  → exchanges fragment token for HttpOnly cookies
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { serverEnv } from "@marketplace/env";
import {
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
} from "../../core/auth/cookies";
import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  getActiveSessions,
  forgotPassword,
  resetPassword,
  initiateGoogleOAuth,
  handleGoogleCallback,
  verifyGoogleToken,
} from "./auth.service";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyGoogleTokenSchema,
} from "@marketplace/shared";
import { ValidationError, UnauthorizedError } from "../../core/errors/app-error";

// ─────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────

export async function registerHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = registerSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  const ctx = { userAgent: request.headers["user-agent"], ip: request.ip };
  const result = await register(input.data, ctx);

  setAccessTokenCookie(reply, result.accessToken);
  setRefreshTokenCookie(reply, result.refreshToken);

  await reply.status(201).send({ success: true, data: { user: result.user } });
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────

export async function loginHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = loginSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  const ctx = { userAgent: request.headers["user-agent"], ip: request.ip };
  const result = await login(input.data, ctx);

  setAccessTokenCookie(reply, result.accessToken);
  setRefreshTokenCookie(reply, result.refreshToken);

  await reply.status(200).send({ success: true, data: { user: result.user } });
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await logout(request.user.sessionId);
  clearAuthCookies(reply);
  await reply.status(200).send({ success: true, data: null });
}

export async function logoutAllHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await logoutAll(request.user.userId);
  clearAuthCookies(reply);
  await reply.status(200).send({ success: true, data: null });
}

// ─────────────────────────────────────────────
// REFRESH
// ─────────────────────────────────────────────

export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rawCookie = request.cookies[REFRESH_TOKEN_COOKIE];
  if (!rawCookie) throw new UnauthorizedError("No refresh token");

  const unsigned = request.unsignCookie(rawCookie);
  if (!unsigned.valid || !unsigned.value) throw new UnauthorizedError("Invalid refresh token");

  const ctx = { userAgent: request.headers["user-agent"], ip: request.ip };
  const result = await refresh(unsigned.value, ctx);

  setAccessTokenCookie(reply, result.accessToken);
  setRefreshTokenCookie(reply, result.refreshToken);

  await reply.status(200).send({ success: true, data: null });
}

// ─────────────────────────────────────────────
// ME
// ─────────────────────────────────────────────

export async function meHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await getMe(request.user.userId);
  await reply.status(200).send({ success: true, data: { user } });
}

// ─────────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────────

export async function forgotPasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = forgotPasswordSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  await forgotPassword(input.data.email);
  // Always 200 — no enumeration
  await reply.status(200).send({ success: true, data: null });
}

export async function resetPasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = resetPasswordSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  await resetPassword(input.data);
  await reply.status(200).send({ success: true, data: null });
}

// ─────────────────────────────────────────────
// GOOGLE OAUTH
// ─────────────────────────────────────────────

export async function googleInitiateHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { authUrl } = await initiateGoogleOAuth();
  await reply.status(200).send({ success: true, data: { authUrl } });
}

export async function googleCallbackHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = request.query as Record<string, string>;
  const { code, state } = query;

  if (!code || !state) throw new UnauthorizedError("Missing code or state");

  const ctx = { userAgent: request.headers["user-agent"], ip: request.ip };
  const result = await handleGoogleCallback(code, state, ctx);

  // Token in URL fragment — not query param, not logged by servers
  // Frontend reads it client-side, then calls POST /auth/google/verify
  const redirectUrl = `${serverEnv.FRONTEND_URL}/auth/callback#access_token=${result.accessToken}`;
  await reply.redirect(302, redirectUrl);
}

export async function googleVerifyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const input = verifyGoogleTokenSchema.safeParse(request.body);
  if (!input.success) throw new ValidationError("Validation failed", input.error.flatten());

  const ctx = { userAgent: request.headers["user-agent"], ip: request.ip };
  const result = await verifyGoogleToken(input.data.token, ctx);

  setAccessTokenCookie(reply, result.accessToken);
  setRefreshTokenCookie(reply, result.refreshToken);

  await reply.status(200).send({ success: true, data: { user: result.user } });
}

// ─────────────────────────────────────────────
// SESSIONS (via auth/me/sessions — listed under auth module)
// ─────────────────────────────────────────────

export async function listSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessions = await getActiveSessions(request.user.userId, request.user.sessionId);
  await reply.status(200).send({ success: true, data: { sessions } });
}

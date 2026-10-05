/**
 * Auth cookie helpers.
 *
 * Cookies are HttpOnly, signed, and Secure in production.
 * The access_token cookie is path=/  (read on every request).
 * The refresh_token cookie is path-scoped to /api/v1/auth/refresh only.
 */
import type { FastifyReply } from "fastify";
import { serverEnv } from "@marketplace/env";

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

const IS_PROD = serverEnv.NODE_ENV === "production";

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "strict" as const,
    signed: true,
  };
}

/**
 * Sets the access token cookie (path=/, 15 min).
 */
export function setAccessTokenCookie(reply: FastifyReply, token: string): void {
  // setCookie returns `this` (FastifyReply) — void to satisfy no-floating-promises
  void reply.setCookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    path: "/",
    maxAge: 15 * 60, // 15 minutes
  });
}

/**
 * Sets the refresh token cookie (path-scoped, 7 days).
 */
export function setRefreshTokenCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    path: "/api/v1/auth/refresh",
    maxAge: serverEnv.SESSION_TTL_SECONDS,
  });
}

/**
 * Clears both auth cookies (used on logout).
 */
export function clearAuthCookies(reply: FastifyReply): void {
  void reply.clearCookie(ACCESS_TOKEN_COOKIE, { path: "/" });
  void reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/api/v1/auth/refresh" });
}

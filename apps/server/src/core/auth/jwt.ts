/**
 * JWT utilities for access and refresh tokens.
 *
 * Access token:  short-lived (15 min), signed with JWT_SECRET
 * Refresh token: long-lived (7 days), signed with SESSION_SECRET
 *
 * Token payload: { userId, role, sessionId }
 * Identity is ALWAYS derived from the verified JWT — never trusted from client input.
 */
import jwt from "jsonwebtoken";
import type { UserRole } from "@marketplace/shared";
import { serverEnv } from "@marketplace/env";
import { UnauthorizedError } from "../errors/app-error";

export interface TokenPayload {
  userId: string;
  role: UserRole;
  sessionId: string;
}

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";

/**
 * Signs a short-lived access token (15 min).
 */
export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, serverEnv.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
    issuer: "marketplace-api",
    audience: "marketplace-client",
  });
}

/**
 * Signs a long-lived refresh token (7 days).
 */
export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, serverEnv.SESSION_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL,
    issuer: "marketplace-api",
    audience: "marketplace-client",
  });
}

/**
 * Verifies an access token and returns the decoded payload.
 * Throws UnauthorizedError if invalid, expired, or tampered.
 */
export function verifyAccessToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, serverEnv.JWT_SECRET, {
      issuer: "marketplace-api",
      audience: "marketplace-client",
    }) as TokenPayload & jwt.JwtPayload;

    return {
      userId: payload.userId,
      role: payload.role,
      sessionId: payload.sessionId,
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Access token expired");
    }
    throw new UnauthorizedError("Invalid access token");
  }
}

/**
 * Verifies a refresh token and returns the decoded payload.
 * Throws UnauthorizedError if invalid, expired, or tampered.
 */
export function verifyRefreshToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, serverEnv.SESSION_SECRET, {
      issuer: "marketplace-api",
      audience: "marketplace-client",
    }) as TokenPayload & jwt.JwtPayload;

    return {
      userId: payload.userId,
      role: payload.role,
      sessionId: payload.sessionId,
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Refresh token expired");
    }
    throw new UnauthorizedError("Invalid refresh token");
  }
}

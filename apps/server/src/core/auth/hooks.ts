/**
 * Fastify pre-handler auth hooks.
 *
 * requireAuth:
 *   1. Reads access_token from signed cookie
 *   2. Falls back to Authorization: Bearer <token> ONLY in non-production
 *   3. Verifies JWT, sets request.user
 *   4. Throws UnauthorizedError if missing/invalid/expired
 *
 * requireRole(...roles):
 *   Runs requireAuth first, then checks request.user.role.
 *   Throws ForbiddenError if role not in allowed set.
 *
 * Identity is ALWAYS derived from verified JWT — never from request body.
 */
import type {
  FastifyRequest,
  FastifyReply,
  preHandlerAsyncHookHandler,
} from "fastify";
import type { UserRole } from "@marketplace/shared";
import { serverEnv } from "@marketplace/env";
import { verifyAccessToken } from "./jwt";
import { ACCESS_TOKEN_COOKIE } from "./cookies";
import { UnauthorizedError, ForbiddenError } from "../errors/app-error";

/**
 * Extracts the raw token string from cookie or (non-prod) Bearer header.
 */
function extractToken(request: FastifyRequest): string {
  // 1. Signed cookie (primary, always)
  const cookieValue = request.cookies[ACCESS_TOKEN_COOKIE];
  if (cookieValue) {
    const unsigned = request.unsignCookie(cookieValue);
    if (unsigned.valid && unsigned.value) {
      return unsigned.value;
    }
  }

  // 2. Bearer token fallback — ONLY in non-production (for test convenience)
  if (serverEnv.NODE_ENV !== "production") {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }
  }

  throw new UnauthorizedError("Authentication required");
}

/**
 * Pre-handler hook: requires a valid authenticated session.
 * Sets request.user on success.
 */
export const requireAuth: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply,
) => {
  const token = extractToken(request);
  const payload = verifyAccessToken(token);
  request.user = payload;
};

/**
 * Pre-handler hook factory: requires auth + specific role(s).
 *
 * Usage:
 *   app.post("/seller/products", { preHandler: requireRole("SELLER") }, handler)
 *   app.post("/admin/users", { preHandler: requireRole("ADMIN") }, handler)
 */
export function requireRole(...roles: UserRole[]): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    // Inline token extraction + auth check (avoids calling async hook from hook)
    const token = extractToken(request);
    const payload = verifyAccessToken(token);
    request.user = payload;

    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError(
        `This action requires one of the following roles: ${roles.join(", ")}`,
      );
    }
  };
}

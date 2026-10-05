/**
 * Fastify pre-handler auth hooks.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  requireAuth       — stateless JWT verification only               │
 * │  requireAuthStrict — JWT + DB session revocation check (+ cache)   │
 * │  requireRole(...)  — requireAuthStrict + role guard                │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * requireAuth (stateless):
 *   1. Reads access_token from signed cookie
 *   2. Falls back to Authorization: Bearer <token> ONLY in non-production
 *   3. Verifies JWT signature + expiry, sets request.user
 *   4. No DB call — fast, safe for ordinary customer routes
 *   Gap: a revoked session's access token remains valid until JWT expiry.
 *
 * requireAuthStrict (stateful):
 *   Same as requireAuth, plus:
 *   5. Checks a Redis cache key `auth:session:valid:{sessionId}` (30 s TTL)
 *   6. On cache miss: queries sessions table — throws 401 if revoked/expired
 *   7. On cache hit: skips DB — revoked sessions can still pass for ≤30 s
 *   Use on: seller actions, admin routes, payment mutations, any write that
 *   must honour immediate revocation within a tight window.
 *
 * requireRole(...roles):
 *   Uses requireAuthStrict internally — privileged roles always get the
 *   stateful check; a freshly-revoked ADMIN/SELLER cannot act within 30 s.
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
import { findSessionById } from "../../modules/auth/auth.repository";
import { createLogger } from "../logger/logger";

// Redis import is lazy to avoid circular startup issues — getRedis() is only
// called at request time, after initRedis() has already run.
import { getRedis } from "../redis/redis";

const logger = createLogger("auth.hooks");

/**
 * How long (seconds) a "session is valid" result is cached in Redis.
 * A revoked session can still pass strict checks for up to this window.
 * 30 s is a deliberate tradeoff: negligible UX impact, avoids a DB hit
 * on every sensitive request. Reduce to 0 for zero-tolerance revocation
 * (every strict request hits the DB).
 */
const SESSION_VALID_CACHE_TTL_SECONDS = 30;

/** Redis key for the session-validity cache entry */
function sessionValidKey(sessionId: string): string {
  return `auth:session:valid:${sessionId}`;
}

/**
 * Explicitly invalidates the session-validity cache entry for a session.
 * Call this immediately after revoking a session so that requireAuthStrict
 * blocks the revoked session on the next request, rather than serving the
 * cached "valid" result for up to SESSION_VALID_CACHE_TTL_SECONDS.
 *
 * Best-effort — Redis errors are logged but not re-thrown.
 */
export async function invalidateSessionCache(sessionId: string): Promise<void> {
  try {
    await getRedis().del(sessionValidKey(sessionId));
  } catch (err) {
    logger.warn({ sessionId, err }, "Failed to invalidate session cache (non-fatal)");
  }
}

// ── Token extraction ────────────────────────────────────────────────────────

/**
 * Extracts the raw JWT string from the signed cookie, or (non-prod only)
 * from an Authorization: Bearer header.
 */
function extractToken(request: FastifyRequest): string {
  // 1. Signed cookie (primary path — always checked)
  const cookieValue = request.cookies[ACCESS_TOKEN_COOKIE];
  if (cookieValue) {
    const unsigned = request.unsignCookie(cookieValue);
    if (unsigned.valid && unsigned.value) {
      return unsigned.value;
    }
  }

  // 2. Bearer header fallback — ONLY in non-production (test/dev convenience)
  if (serverEnv.NODE_ENV !== "production") {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }
  }

  throw new UnauthorizedError("Authentication required");
}

// ── Session revocation check (DB + Redis cache) ────────────────────────────

/**
 * Verifies that the session is still active in the database.
 * Results are cached in Redis for SESSION_VALID_CACHE_TTL_SECONDS to avoid
 * a DB round-trip on every sensitive request.
 *
 * Cache key: auth:session:valid:{sessionId}  value: "1"
 *
 * Fail-open policy for Redis: if Redis is unavailable, we fall through to
 * the DB check rather than denying access.
 */
async function assertSessionActive(sessionId: string): Promise<void> {
  // 1. Try Redis cache first
  try {
    const redis = getRedis();
    const cached = await redis.get(sessionValidKey(sessionId));
    if (cached === "1") {
      // Cache hit — session was valid within the last TTL window
      return;
    }
  } catch (err) {
    // Redis unavailable — log and fall through to DB
    logger.warn({ sessionId, err }, "Redis session cache unavailable — falling back to DB");
  }

  // 2. DB lookup
  const session = await findSessionById(sessionId);

  if (!session) {
    throw new UnauthorizedError("Session not found");
  }
  if (session.revokedAt !== null) {
    // Ensure no stale cache entry can revalidate a revoked session
    try {
      await getRedis().del(sessionValidKey(sessionId));
    } catch {
      // best-effort cleanup — ignore Redis errors here
    }
    throw new UnauthorizedError("Session has been revoked");
  }
  if (session.expiresAt < new Date()) {
    throw new UnauthorizedError("Session has expired");
  }

  // 3. Write back to Redis cache (best-effort)
  try {
    await getRedis().set(sessionValidKey(sessionId), "1", "EX", SESSION_VALID_CACHE_TTL_SECONDS);
  } catch {
    // Non-fatal — the DB check already succeeded
  }
}

// ── Exported hooks ──────────────────────────────────────────────────────────

/**
 * requireAuth — stateless JWT-only check.
 *
 * Fast and cheap. A revoked session's access token remains valid until
 * the JWT expires (default 15 min). Suitable for:
 *   - Customer-owned data reads and writes
 *   - Any route where a 15-min window after revocation is acceptable
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
 * requireAuthStrict — JWT check + DB session revocation check (cached).
 *
 * Adds a Redis-cached DB lookup to verify the session hasn't been revoked.
 * Revocation takes effect within SESSION_VALID_CACHE_TTL_SECONDS (30 s).
 * Use on:
 *   - Seller product/inventory mutations
 *   - Admin operations
 *   - Payment captures and refunds
 *   - Any action where near-immediate revocation is required
 */
export const requireAuthStrict: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply,
) => {
  const token = extractToken(request);
  const payload = verifyAccessToken(token);
  request.user = payload;

  await assertSessionActive(payload.sessionId);
};

/**
 * requireRole(...roles) — requireAuthStrict + role guard.
 *
 * Privileged routes (SELLER, ADMIN) always use the strict session check.
 * A freshly-revoked admin or seller cannot act within the 30-second window.
 *
 * Usage:
 *   app.post("/seller/products", { preHandler: [requireRole("SELLER")] }, handler)
 *   app.delete("/admin/users/:id", { preHandler: [requireRole("ADMIN")] }, handler)
 */
export function requireRole(...roles: UserRole[]): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = extractToken(request);
    const payload = verifyAccessToken(token);
    request.user = payload;

    // Role check first — avoids a DB hit for callers with the wrong role
    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError(
        `This action requires one of the following roles: ${roles.join(", ")}`,
      );
    }

    // Strict session check — privileged roles always verify revocation
    await assertSessionActive(payload.sessionId);
  };
}

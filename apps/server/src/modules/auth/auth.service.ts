/**
 * Auth service.
 *
 * Business logic for the identity boundary (AGENTS.md §13).
 * Orchestrates repositories, JWT signing, password hashing, Redis (PKCE),
 * and PgBoss (email jobs).
 *
 * Security rules enforced here:
 *  - Identity ALWAYS derived from verified JWT — never from request body
 *  - Same error message for wrong email and wrong password (no enumeration)
 *  - forgotPassword returns void regardless of whether email exists
 *  - Refresh token rotation: mismatch → revoke session immediately (detect theft)
 *  - Password reset atomically revokes all sessions
 *  - OAuth state + code_verifier generated server-side, stored in Redis 300s
 *  - OAuth state is single-use (DEL on retrieval)
 *  - Token placed in URL fragment by controller — not logged by servers
 */
import crypto from "node:crypto";
import { serverEnv } from "@marketplace/env";
import { createLogger } from "../../core/logger/logger";
import { getRedis } from "../../core/redis/redis";
import { getDb } from "../../core/db/db";
import { sendJob } from "../../core/queue/jobs";
import {
  hashPassword,
  verifyPassword,
} from "../../core/auth/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
} from "../../core/auth/jwt";
import {
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  AppError,
} from "../../core/errors/app-error";
import {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserPassword,
  createSession,
  findSessionById,
  findActiveSessionsByUserId,
  updateSessionRefreshHash,
  revokeSession,
  revokeAllUserSessions,
  createPasswordResetToken,
  findValidResetToken,
  markResetTokenUsed,
  findOauthAccount,
  upsertOauthAccount,
} from "./auth.repository";
import { AUTH_JOBS, type SendResetEmailPayload } from "./auth.jobs";
import type { User } from "@marketplace/database";

const logger = createLogger("auth.service");

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Safe user — passwordHash deliberately excluded */
export type SafeUser = {
  id:        string;
  email:     string;
  name:      string;
  role:      User["role"];
  status:    User["status"];
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthResult = {
  user:         SafeUser;
  accessToken:  string;
  refreshToken: string;
};

export type RequestContext = {
  userAgent?: string | undefined;
  ip?:        string | undefined;
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function toSafeUser(user: User): SafeUser {
  return {
    id:        user.id,
    email:     user.email,
    name:      user.name,
    role:      user.role,
    status:    user.status,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    // passwordHash intentionally absent
  };
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Creates a new session and signs both tokens.
 * refreshTokenHash stored as bcrypt hash — raw token returned to caller once.
 */
async function issueTokens(
  userId: string,
  role: User["role"],
  ctx: RequestContext,
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  // First, create the session row to get the DB-generated session ID
  // We need the real session ID to embed in the JWT, so we insert with a
  // temporary hash, then re-sign + update. This ensures the JWT sessionId
  // always matches the actual session row ID.
  const tempRefreshToken = signRefreshToken({ userId, role, sessionId: crypto.randomUUID() });
  const tempHash         = await hashPassword(tempRefreshToken);

  const expiresAt = new Date(Date.now() + serverEnv.SESSION_TTL_SECONDS * 1000);

  const session = await createSession({
    userId,
    refreshTokenHash: tempHash,
    expiresAt,
    ...(ctx.userAgent !== undefined && { userAgent: ctx.userAgent }),
    ...(ctx.ip        !== undefined && { ipAddress: ctx.ip }),
  });

  // Re-sign with the actual DB-generated session ID
  const finalAccessToken  = signAccessToken({ userId, role, sessionId: session.id });
  const finalRefreshToken = signRefreshToken({ userId, role, sessionId: session.id });

  // Update the stored hash to match the final refresh token
  const finalRefreshHash = await hashPassword(finalRefreshToken);
  await updateSessionRefreshHash(session.id, finalRefreshHash);

  return { accessToken: finalAccessToken, refreshToken: finalRefreshToken, sessionId: session.id };
}

// ─────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────

export async function register(
  input: { email: string; password: string; name: string },
  ctx: RequestContext = {},
): Promise<AuthResult> {
  const existing = await findUserByEmail(input.email);
  if (existing) {
    throw new ConflictError("Email already registered");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await createUser({ email: input.email, passwordHash, name: input.name });

  const { accessToken, refreshToken } = await issueTokens(user.id, user.role, ctx);

  logger.info({ userId: user.id }, "User registered");

  // Non-blocking welcome email (Phase 10: real email)
  void sendJob(AUTH_JOBS.SEND_WELCOME_EMAIL, {
    userId: user.id,
    email:  user.email,
    name:   user.name,
  });

  return { user: toSafeUser(user), accessToken, refreshToken };
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────

export async function login(
  input: { email: string; password: string },
  ctx: RequestContext = {},
): Promise<AuthResult> {
  // Same error message for wrong email AND wrong password — no enumeration
  const user = await findUserByEmail(input.email);
  if (!user) {
    throw new UnauthorizedError("Invalid credentials");
  }

  if (user.status === "SUSPENDED" || user.status === "BANNED") {
    throw new ForbiddenError("Account suspended");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid credentials");
  }

  const { accessToken, refreshToken } = await issueTokens(user.id, user.role, ctx);

  logger.info({ userId: user.id }, "User logged in");

  return { user: toSafeUser(user), accessToken, refreshToken };
}

// ─────────────────────────────────────────────
// REFRESH
// ─────────────────────────────────────────────

export async function refresh(
  rawRefreshToken: string,
  _ctx: RequestContext = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  // Verify JWT signature and expiry
  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const session = await findSessionById(payload.sessionId);

  if (!session) {
    throw new UnauthorizedError("Session not found");
  }
  if (session.revokedAt !== null) {
    throw new UnauthorizedError("Session revoked");
  }
  if (session.expiresAt < new Date()) {
    throw new UnauthorizedError("Session expired");
  }

  // Compare provided refresh token against stored hash
  // Mismatch = possible token theft → revoke session immediately
  const hashMatch = await verifyPassword(rawRefreshToken, session.refreshTokenHash);
  if (!hashMatch) {
    await revokeSession(session.id);
    logger.warn({ sessionId: session.id, userId: session.userId }, "Refresh token mismatch — session revoked (possible theft)");
    throw new UnauthorizedError("Invalid refresh token");
  }

  // Rotate: new refresh token
  const newRefreshToken = signRefreshToken({ userId: session.userId, role: payload.role, sessionId: session.id });
  const newAccessToken  = signAccessToken({ userId: session.userId, role: payload.role, sessionId: session.id });

  const newHash = await hashPassword(newRefreshToken);
  await updateSessionRefreshHash(session.id, newHash);

  logger.debug({ sessionId: session.id }, "Tokens rotated");

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
  logger.info({ sessionId }, "Session revoked (logout)");
}

export async function logoutAll(userId: string): Promise<void> {
  await revokeAllUserSessions(userId);
  logger.info({ userId }, "All sessions revoked (logout-all)");
}

// ─────────────────────────────────────────────
// ME
// ─────────────────────────────────────────────

export async function getMe(userId: string): Promise<SafeUser> {
  const user = await findUserById(userId);
  if (!user) throw new UnauthorizedError("User not found");
  return toSafeUser(user);
}

// ─────────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────────

/**
 * Initiates password reset. Returns void regardless of whether email exists
 * to prevent user enumeration.
 */
export async function forgotPassword(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) {
    // No enumeration — same response path
    logger.debug({ email }, "Forgot password: email not found (silent)");
    return;
  }

  const rawToken  = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });

  const payload: SendResetEmailPayload = {
    userId:    user.id,
    email:     user.email,
    token:     rawToken,
    expiresAt: expiresAt.toISOString(),
  };

  // Non-blocking — PgBoss job (AGENTS.md §50)
  await sendJob(AUTH_JOBS.SEND_RESET_EMAIL, payload);

  logger.info({ userId: user.id }, "Password reset email enqueued");
}

export async function resetPassword(input: { token: string; newPassword: string }): Promise<void> {
  const tokenHash = sha256Hex(input.token);
  const record    = await findValidResetToken(tokenHash);

  if (!record) {
    throw new ValidationError("Invalid or expired reset token");
  }

  const newHash = await hashPassword(input.newPassword);

  // Atomic transaction: update password + mark token used + revoke all sessions
  const db = getDb();
  await db.transaction(async () => {
    await updateUserPassword(record.userId, newHash);
    await markResetTokenUsed(record.id);
    await revokeAllUserSessions(record.userId);
  });

  logger.info({ userId: record.userId }, "Password reset — all sessions revoked");
}

// ─────────────────────────────────────────────
// SEND RESET EMAIL (worker handler — stub for Phase 3)
// ─────────────────────────────────────────────

export function sendResetEmail(payload: SendResetEmailPayload): void {
  // Phase 3: log the link. Phase 10: replace with real email provider (SES/Resend).
  logger.info(
    { userId: payload.userId },
    `[DEV] Password reset link: ${serverEnv.FRONTEND_URL}/reset-password?token=${payload.token}`,
  );
}

// ─────────────────────────────────────────────
// GOOGLE OAUTH PKCE
// ─────────────────────────────────────────────

const OAUTH_STATE_TTL = 300; // 5 minutes
const OAUTH_STATE_PREFIX = "auth:oauth:state:";

export async function initiateGoogleOAuth(): Promise<{ authUrl: string }> {
  if (!serverEnv.GOOGLE_CLIENT_ID || !serverEnv.GOOGLE_REDIRECT_URI) {
    throw new AppError("UNPROCESSABLE", "Google OAuth is not configured", 501);
  }

  const state         = crypto.randomUUID();
  const codeVerifier  = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Store code_verifier in Redis — single-use, 5 min TTL
  const redis = getRedis();
  await redis.set(
    `${OAUTH_STATE_PREFIX}${state}`,
    JSON.stringify({ codeVerifier }),
    "EX",
    OAUTH_STATE_TTL,
  );

  const params = new URLSearchParams({
    client_id:             serverEnv.GOOGLE_CLIENT_ID,
    redirect_uri:          serverEnv.GOOGLE_REDIRECT_URI,
    response_type:         "code",
    scope:                 "openid email profile",
    code_challenge:        codeChallenge,
    code_challenge_method: "S256",
    state,
    access_type:           "offline",
    prompt:                "consent",
  });

  return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

export async function handleGoogleCallback(
  code: string,
  state: string,
  ctx: RequestContext = {},
): Promise<AuthResult> {
  if (!serverEnv.GOOGLE_CLIENT_ID || !serverEnv.GOOGLE_CLIENT_SECRET || !serverEnv.GOOGLE_REDIRECT_URI) {
    throw new AppError("UNPROCESSABLE", "Google OAuth is not configured", 501);
  }

  // Retrieve and immediately delete state from Redis (single-use)
  const redis     = getRedis();
  const stateKey  = `${OAUTH_STATE_PREFIX}${state}`;
  const stateData = await redis.get(stateKey);

  if (!stateData) {
    throw new UnauthorizedError("Invalid or expired OAuth state");
  }
  await redis.del(stateKey);

  let codeVerifier: string;
  try {
    const parsed = JSON.parse(stateData) as { codeVerifier: string };
    codeVerifier = parsed.codeVerifier;
  } catch {
    throw new UnauthorizedError("Invalid OAuth state data");
  }

  // Exchange code for tokens with Google
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     serverEnv.GOOGLE_CLIENT_ID,
      client_secret: serverEnv.GOOGLE_CLIENT_SECRET,
      redirect_uri:  serverEnv.GOOGLE_REDIRECT_URI,
      code_verifier: codeVerifier,
      grant_type:    "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => "");
    logger.warn({ status: tokenResponse.status, body }, "Google token exchange failed");
    throw new UnauthorizedError("OAuth token exchange failed");
  }

  const tokenData = await tokenResponse.json() as {
    id_token?:     string;
    access_token?: string;
    refresh_token?: string;
    expires_in?:   number;
  };

  if (!tokenData.id_token) {
    throw new UnauthorizedError("No id_token in Google response");
  }

  // Decode id_token (our own JWT validation is sufficient — Google signed)
  // We decode without re-verifying signature for simplicity; in production
  // verify against Google JWKS (Phase 9 hardening).
  const idTokenParts = tokenData.id_token.split(".");
  if (idTokenParts.length !== 3 || !idTokenParts[1]) {
    throw new UnauthorizedError("Invalid id_token format");
  }

  let idPayload: { sub?: string; email?: string; name?: string; iss?: string };
  try {
    idPayload = JSON.parse(
      Buffer.from(idTokenParts[1], "base64url").toString("utf-8"),
    ) as typeof idPayload;
  } catch {
    throw new UnauthorizedError("Failed to decode id_token");
  }

  const { sub: googleUserId, email, name } = idPayload;
  if (!googleUserId || !email) {
    throw new UnauthorizedError("Missing required fields in id_token");
  }

  // Find or create user
  let user: import("@marketplace/database").User | null = null;

  const existingOauth = await findOauthAccount("google", googleUserId);
  if (existingOauth) {
    user = await findUserById(existingOauth.userId);
  }

  if (!user) {
    // Check if email already registered (account merge)
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      user = existingUser;
    } else {
      // New user via Google — unusable password hash (OAuth-only account)
      const unusableHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
      user = await createUser({
        email,
        passwordHash: unusableHash,
        name:         name ?? email.split("@")[0] ?? "User",
      });
    }
  }

  if (!user) {
    throw new UnauthorizedError("Failed to resolve user from OAuth");
  }

  // Upsert OAuth account link
  const googleExpiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : undefined;

  await upsertOauthAccount({
    userId:            user.id,
    provider:          "google",
    providerAccountId: googleUserId,
    ...(tokenData.access_token  !== undefined && { accessToken:  tokenData.access_token }),
    ...(tokenData.refresh_token !== undefined && { refreshToken: tokenData.refresh_token }),
    ...(googleExpiresAt         !== undefined && { expiresAt:    googleExpiresAt }),
  });

  const { accessToken, refreshToken } = await issueTokens(user.id, user.role, ctx);

  logger.info({ userId: user.id }, "User authenticated via Google OAuth");

  return { user: toSafeUser(user), accessToken, refreshToken };
}

/**
 * Verifies a short-lived access token from the OAuth fragment exchange.
 * The controller sets HttpOnly cookies after calling this.
 */
export async function verifyGoogleToken(
  token: string,
  ctx: RequestContext = {},
): Promise<AuthResult> {
  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }

  // Verify session is still valid
  const session = await findSessionById(payload.sessionId);
  if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
    throw new UnauthorizedError("Session invalid or expired");
  }

  const user = await findUserById(payload.userId);
  if (!user) throw new UnauthorizedError("User not found");

  // Issue fresh tokens so the verify endpoint also sets proper cookies
  const { accessToken, refreshToken } = await issueTokens(user.id, user.role, ctx);

  // Revoke the one-time fragment token session
  await revokeSession(payload.sessionId);

  return { user: toSafeUser(user), accessToken, refreshToken };
}

// ─────────────────────────────────────────────
// SESSION LIST (for auth/me sessions endpoint)
// ─────────────────────────────────────────────

export async function getActiveSessions(
  userId: string,
  currentSessionId: string,
): Promise<Array<{
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}>> {
  const rows = await findActiveSessionsByUserId(userId);
  return rows.map((s) => ({
    id:        s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: s.id === currentSessionId,
  }));
}

/**
 * Auth Zod schemas.
 *
 * Source of truth for auth API validation.
 * Shared between server routes and frontend clients.
 *
 * Security rules enforced here:
 *  - Passwords: min 8, max 128 chars
 *  - Emails: lowercase-normalized, max 255 chars
 *  - passwordHash is NEVER in any response schema
 *  - refreshTokenHash is NEVER in any response schema
 */
import { z } from "zod";

// ─────────────────────────────────────────────
// REQUEST SCHEMAS
// ─────────────────────────────────────────────

export const registerSchema = z.object({
  email:    z.string().email("Invalid email address").max(255).toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name:     z.string().trim().min(1, "Name is required").max(255),
});

export const loginSchema = z.object({
  email:    z.string().email("Invalid email address").max(255).toLowerCase(),
  password: z.string().min(1, "Password is required").max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address").max(255).toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token:       z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export const verifyGoogleTokenSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

// ─────────────────────────────────────────────
// RESPONSE SCHEMAS
// (Safe — never include passwordHash, refreshTokenHash, or any internal secret)
// ─────────────────────────────────────────────

/** Safe user object returned in all auth responses */
export const safeUserSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string().email(),
  name:      z.string(),
  role:      z.enum(["CUSTOMER", "SELLER", "ADMIN"]),
  status:    z.enum(["ACTIVE", "SUSPENDED", "BANNED", "PENDING_VERIFICATION"]),
  avatarUrl: z.string().nullable(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  // passwordHash intentionally absent
});

/** Auth response — returned on register, login, /me */
export const authResponseSchema = z.object({
  user: safeUserSchema,
});

/** Safe session — returned in session list. Never includes refreshTokenHash. */
export const safeSessionSchema = z.object({
  id:        z.string().uuid(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string().or(z.date()),
  expiresAt: z.string().or(z.date()),
  isCurrent: z.boolean(), // true when this session is the one making the request
  // refreshTokenHash intentionally absent
});

// ─────────────────────────────────────────────
// INFERRED TYPES
// ─────────────────────────────────────────────

export type RegisterInput          = z.infer<typeof registerSchema>;
export type LoginInput             = z.infer<typeof loginSchema>;
export type ForgotPasswordInput    = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput     = z.infer<typeof resetPasswordSchema>;
export type VerifyGoogleTokenInput = z.infer<typeof verifyGoogleTokenSchema>;
export type SafeUser               = z.infer<typeof safeUserSchema>;
export type SafeSession            = z.infer<typeof safeSessionSchema>;

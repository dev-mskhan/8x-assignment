/**
 * Auth domain schema.
 *
 * Tables: users, sessions, password_reset_tokens
 *
 * These are table definitions only — no business logic.
 * Migrations are created in Phase 2.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---- Enums -----------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", [
  "CUSTOMER",
  "SELLER",
  "ADMIN",
]);

export const userStatusEnum = pgEnum("user_status", [
  "ACTIVE",
  "SUSPENDED",
  "BANNED",
  "PENDING_VERIFICATION",
]);

// ---- Tables ----------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: userRoleEnum("role").notNull().default("CUSTOMER"),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    roleIdx: index("users_role_idx").on(t.role),
    statusIdx: index("users_status_idx").on(t.status),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 45 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdIdx: index("sessions_user_id_idx").on(t.userId),
    tokenHashIdx: uniqueIndex("sessions_refresh_token_hash_idx").on(
      t.refreshTokenHash,
    ),
    expiresAtIdx: index("sessions_expires_at_idx").on(t.expiresAt),
  }),
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("password_reset_tokens_hash_idx").on(t.tokenHash),
    userIdIdx: index("password_reset_tokens_user_id_idx").on(t.userId),
  }),
);

// ---- Types -----------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// ─────────────────────────────────────────────
// OAUTH ACCOUNTS
// Pre-wired for Phase 3 Google OAuth PKCE flow.
//
// PKCE flow (server-side):
//   1. Server generates code_verifier (random, stored server-side in Redis with TTL)
//   2. Server derives code_challenge = base64url(sha256(code_verifier))
//   3. Server sends authorization URL to client (code_challenge, state param)
//   4. Google redirects back with ?code=...&state=...
//   5. Server verifies state, retrieves code_verifier, exchanges code → tokens
//   6. Server upserts this table row + creates session
//
// access_token / refresh_token are server-side only — never returned in API responses.
// ─────────────────────────────────────────────

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id:                uuid("id").primaryKey().defaultRandom(),
    userId:            uuid("user_id")
                         .notNull()
                         .references(() => users.id, { onDelete: "cascade" }),
    provider:          text("provider").notNull(),           // e.g. "google"
    providerAccountId: text("provider_account_id").notNull(),
    accessToken:       text("access_token"),
    refreshToken:      text("refresh_token"),
    expiresAt:         timestamp("expires_at", { withTimezone: true }),
    createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One (provider, providerAccountId) per row — prevents duplicate OAuth link
    providerAccountIdx: uniqueIndex("oauth_accounts_provider_account_idx")
      .on(t.provider, t.providerAccountId),
    // One Google account per user
    userProviderIdx: uniqueIndex("oauth_accounts_user_provider_idx")
      .on(t.userId, t.provider),
    userIdIdx: index("oauth_accounts_user_id_idx").on(t.userId),
  }),
);

export type OauthAccount    = typeof oauthAccounts.$inferSelect;
export type NewOauthAccount = typeof oauthAccounts.$inferInsert;

/**
 * Auth repository.
 *
 * Persistence logic only — no business rules (AGENTS.md §14).
 *
 * Security invariants enforced here:
 *  - passwordHash is NEVER returned by findActiveSessionsByUserId or any list query
 *  - refreshTokenHash is NEVER returned by findActiveSessionsByUserId
 *  - All writes use explicit columns
 */
import { eq, and, gt, lt, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "../../core/db/db";
import {
  users,
  sessions,
  passwordResetTokens,
  oauthAccounts,
  type User,
  type Session,
  type OauthAccount,
} from "@marketplace/database";

// Infer PasswordResetToken locally — not always re-exported
type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Safe session — no refreshTokenHash — for session list endpoint
export type SafeSessionRow = {
  id:        string;
  userId:    string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<User | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function createUser(data: {
  email:        string;
  passwordHash: string;
  name:         string;
  role?:        "CUSTOMER" | "SELLER" | "ADMIN";
}): Promise<User> {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({
      email:        data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      name:         data.name,
      role:         data.role ?? "CUSTOMER",
    })
    .returning();
  if (!row) throw new Error("Failed to create user");
  return row;
}

export async function updateUser(
  id: string,
  data: Partial<{ name: string; avatarUrl: string | null; status: User["status"] }>,
): Promise<User> {
  const db = getDb();
  // Build a typed partial update — only include defined fields
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (data.name      !== undefined) set.name      = data.name;
  if (data.avatarUrl !== undefined) set.avatarUrl  = data.avatarUrl === null ? null : data.avatarUrl;
  if (data.status    !== undefined) set.status     = data.status;

  const [row] = await db
    .update(users)
    .set(set)
    .where(eq(users.id, id))
    .returning();
  if (!row) throw new Error("User not found");
  return row;
}

export async function updateUserPassword(id: string, passwordHash: string): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id));
}

// ─────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────

export async function createSession(data: {
  userId:           string;
  refreshTokenHash: string;
  userAgent?:       string | undefined;
  ipAddress?:       string | undefined;
  expiresAt:        Date;
}): Promise<Session> {
  const db = getDb();
  const insert: typeof sessions.$inferInsert = {
    userId:           data.userId,
    refreshTokenHash: data.refreshTokenHash,
    expiresAt:        data.expiresAt,
  };
  if (data.userAgent !== undefined) insert.userAgent = data.userAgent;
  if (data.ipAddress !== undefined) insert.ipAddress = data.ipAddress;

  const [row] = await db.insert(sessions).values(insert).returning();
  if (!row) throw new Error("Failed to create session");
  return row;
}

export async function findSessionById(id: string): Promise<Session | null> {
  const db = getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row ?? null;
}

/**
 * Active non-expired sessions for a user.
 * refreshTokenHash deliberately excluded — never expose to clients.
 */
export async function findActiveSessionsByUserId(userId: string): Promise<SafeSessionRow[]> {
  const db = getDb();
  const now = new Date();
  return db
    .select({
      id:        sessions.id,
      userId:    sessions.userId,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .orderBy(sessions.createdAt);
}

export async function updateSessionRefreshHash(id: string, refreshTokenHash: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ refreshTokenHash })
    .where(eq(sessions.id, id));
}

export async function revokeSession(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, id));
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function deleteExpiredSessions(): Promise<void> {
  const db = getDb();
  const now = new Date();
  // Delete sessions that are both expired AND revoked
  await db
    .delete(sessions)
    .where(and(isNotNull(sessions.revokedAt), lt(sessions.expiresAt, now)));
}

// ─────────────────────────────────────────────
// PASSWORD RESET TOKENS
// ─────────────────────────────────────────────

export async function createPasswordResetToken(data: {
  userId:    string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<PasswordResetToken> {
  const db = getDb();
  const [row] = await db.insert(passwordResetTokens).values(data).returning();
  if (!row) throw new Error("Failed to create password reset token");
  return row;
}

export async function findValidResetToken(tokenHash: string): Promise<PasswordResetToken | null> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    );
  return row ?? null;
}

export async function markResetTokenUsed(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, id));
}

export async function deleteUserResetTokens(userId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId));
}

// ─────────────────────────────────────────────
// OAUTH ACCOUNTS
// ─────────────────────────────────────────────

export async function findOauthAccount(
  provider: string,
  providerAccountId: string,
): Promise<OauthAccount | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, providerAccountId),
      ),
    );
  return row ?? null;
}

export async function upsertOauthAccount(data: {
  userId:            string;
  provider:          string;
  providerAccountId: string;
  accessToken?:      string | undefined;
  refreshToken?:     string | undefined;
  expiresAt?:        Date | undefined;
}): Promise<OauthAccount> {
  const db = getDb();
  const insert: typeof oauthAccounts.$inferInsert = {
    userId:            data.userId,
    provider:          data.provider,
    providerAccountId: data.providerAccountId,
  };
  if (data.accessToken  !== undefined) insert.accessToken  = data.accessToken;
  if (data.refreshToken !== undefined) insert.refreshToken = data.refreshToken;
  if (data.expiresAt    !== undefined) insert.expiresAt    = data.expiresAt;

  const [row] = await db
    .insert(oauthAccounts)
    .values(insert)
    .onConflictDoUpdate({
      target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
      set: {
        updatedAt: new Date(),
        // Only set fields that were actually provided — exactOptionalPropertyTypes
        ...(data.accessToken  !== undefined && { accessToken:  data.accessToken }),
        ...(data.refreshToken !== undefined && { refreshToken: data.refreshToken }),
        ...(data.expiresAt    !== undefined && { expiresAt:    data.expiresAt }),
      },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert OAuth account");
  return row;
}

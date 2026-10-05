/**
 * Users repository.
 *
 * Persistence logic only — no business rules (AGENTS.md §14).
 *
 * Ownership invariants enforced at DB level:
 *  - All address mutations include AND user_id = userId in WHERE clause
 *  - setDefaultAddress uses a DB transaction — atomically clears then sets
 *  - passwordHash never returned from profile queries
 *  - refreshTokenHash never returned from session list queries
 */
import { eq, and, gt, isNull } from "drizzle-orm";
import { getDb } from "../../core/db/db";
import {
  users,
  addresses,
  sessions,
  type User,
  type Address,
  type NewAddress,
} from "@marketplace/database";

// Safe profile — no passwordHash
export type SafeUserProfile = Omit<User, "passwordHash">;

// Safe session row — no refreshTokenHash
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
// PROFILE
// ─────────────────────────────────────────────

/**
 * Returns user profile without passwordHash.
 */
export async function findUserProfileById(id: string): Promise<SafeUserProfile | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id:        users.id,
      email:     users.email,
      name:      users.name,
      role:      users.role,
      status:    users.status,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

/**
 * Updates profile fields. Returns safe profile (no passwordHash).
 */
export async function updateUserProfile(
  id: string,
  data: { name?: string | undefined; avatarUrl?: string | null | undefined },
): Promise<SafeUserProfile> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name      !== undefined) set["name"]      = data.name;
  if (data.avatarUrl !== undefined) set["avatarUrl"]  = data.avatarUrl;

  const [row] = await db
    .update(users)
    .set(set as Partial<typeof users.$inferInsert>)
    .where(eq(users.id, id))
    .returning({
      id:        users.id,
      email:     users.email,
      name:      users.name,
      role:      users.role,
      status:    users.status,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    });
  if (!row) throw new Error("User not found");
  return row;
}

// ─────────────────────────────────────────────
// ADDRESSES
// ─────────────────────────────────────────────

export async function findAddressesByUserId(userId: string): Promise<Address[]> {
  const db = getDb();
  return db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, userId))
    .orderBy(addresses.isDefault, addresses.createdAt);
}

export async function findAddressById(id: string): Promise<Address | null> {
  const db = getDb();
  const [row] = await db.select().from(addresses).where(eq(addresses.id, id));
  return row ?? null;
}

export async function createAddress(data: NewAddress): Promise<Address> {
  const db = getDb();
  const [row] = await db.insert(addresses).values(data).returning();
  if (!row) throw new Error("Failed to create address");
  return row;
}

/**
 * Updates an address — ownership enforced: userId must match in WHERE.
 * Returns null if not found or wrong owner (no existence leak to caller).
 */
export async function updateAddress(
  id: string,
  userId: string,
  data: Partial<Omit<Address, "id" | "userId" | "createdAt" | "updatedAt">>,
): Promise<Address | null> {
  const db = getDb();
  const [row] = await db
    .update(addresses)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(addresses.id, id),
        eq(addresses.userId, userId), // ownership enforced at DB level
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Deletes an address — ownership enforced: userId must match in WHERE.
 */
export async function deleteAddress(id: string, userId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(addresses)
    .where(
      and(
        eq(addresses.id, id),
        eq(addresses.userId, userId), // ownership enforced at DB level
      ),
    );
}

/**
 * Sets one address as default for a user.
 * Transaction: clears all user defaults first, then sets the target.
 * Ownership enforced at DB level on the SET step.
 */
export async function setDefaultAddress(id: string, userId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // 1. Clear all existing defaults for this user
    await tx
      .update(addresses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(addresses.userId, userId));

    // 2. Set the target address as default (ownership enforced)
    await tx
      .update(addresses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(addresses.id, id),
          eq(addresses.userId, userId), // ownership enforced at DB level
        ),
      );
  });
}

// ─────────────────────────────────────────────
// SESSIONS (for session management UI)
// ─────────────────────────────────────────────

/**
 * Returns active sessions for a user — for session management UI.
 * refreshTokenHash deliberately excluded — never expose to clients.
 */
export async function findActiveSessionsForUser(userId: string): Promise<SafeSessionRow[]> {
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

/**
 * Revokes a session — ownership enforced: userId must match in WHERE.
 * Returns true if a row was actually revoked, false if not found / wrong owner.
 */
export async function revokeSessionForUser(id: string, userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.id, id),
        eq(sessions.userId, userId), // ownership enforced at DB level
        isNull(sessions.revokedAt),  // only if not already revoked
      ),
    )
    .returning({ id: sessions.id });
  return result.length > 0;
}

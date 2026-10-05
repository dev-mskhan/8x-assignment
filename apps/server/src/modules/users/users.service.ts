/**
 * Users service.
 *
 * Business logic for user profile, addresses, and session management (AGENTS.md §13).
 *
 * Ownership invariants:
 *  - userId always comes from request.user.userId (JWT) — never from body
 *  - Address ownership verified before any mutation (returns 404, not 403)
 *  - Session ownership verified before revocation
 */
import { createLogger } from "../../core/logger/logger";
import {
  NotFoundError,
} from "../../core/errors/app-error";
import {
  findUserProfileById,
  updateUserProfile,
  findAddressesByUserId,
  findAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  findActiveSessionsForUser,
  revokeSessionForUser,
  type SafeUserProfile,
} from "./users.repository";
import type { Address, NewAddress } from "@marketplace/database";

const logger = createLogger("users.service");

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────

export async function getMyProfile(userId: string): Promise<SafeUserProfile> {
  const user = await findUserProfileById(userId);
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export async function updateMyProfile(
  userId: string,
  input: { name?: string | undefined; avatarUrl?: string | null | undefined },
): Promise<SafeUserProfile> {
  const updated = await updateUserProfile(userId, input);
  logger.info({ userId }, "Profile updated");
  return updated;
}

// ─────────────────────────────────────────────
// ADDRESSES
// ─────────────────────────────────────────────

export async function getMyAddresses(userId: string): Promise<Address[]> {
  return findAddressesByUserId(userId);
}

export async function addAddress(
  userId: string,
  input: Omit<NewAddress, "userId">,
): Promise<Address> {
  const address = await createAddress({ ...input, userId });
  logger.info({ userId, addressId: address.id }, "Address created");
  return address;
}

export async function editAddress(
  userId: string,
  addressId: string,
  input: Partial<Omit<Address, "id" | "userId" | "createdAt" | "updatedAt">>,
): Promise<Address> {
  // Verify ownership first — returns null if not found or wrong user
  const existing = await findAddressById(addressId);
  if (!existing || existing.userId !== userId) {
    // Return 404, not 403 — no existence leak (AGENTS.md §4 ownership rule)
    throw new NotFoundError("Address not found");
  }

  const updated = await updateAddress(addressId, userId, input);
  if (!updated) throw new NotFoundError("Address not found");

  logger.info({ userId, addressId }, "Address updated");
  return updated;
}

export async function removeAddress(userId: string, addressId: string): Promise<void> {
  const existing = await findAddressById(addressId);
  if (!existing || existing.userId !== userId) {
    throw new NotFoundError("Address not found");
  }
  await deleteAddress(addressId, userId);
  logger.info({ userId, addressId }, "Address deleted");
}

export async function makeDefaultAddress(userId: string, addressId: string): Promise<Address[]> {
  const existing = await findAddressById(addressId);
  if (!existing || existing.userId !== userId) {
    throw new NotFoundError("Address not found");
  }
  await setDefaultAddress(addressId, userId);
  logger.info({ userId, addressId }, "Default address set");
  return findAddressesByUserId(userId);
}

// ─────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────

export async function getMySessions(
  userId: string,
  currentSessionId: string,
): Promise<Array<{
  id:        string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}>> {
  const rows = await findActiveSessionsForUser(userId);
  return rows.map((s) => ({
    id:        s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: s.id === currentSessionId,
  }));
}

export async function revokeMySession(
  userId: string,
  sessionId: string,
  currentSessionId: string,
): Promise<void> {
  if (sessionId === currentSessionId) {
    // Revoking own current session is allowed (equivalent to logout for that session)
  }
  const revoked = await revokeSessionForUser(sessionId, userId);
  if (!revoked) {
    // Not found or wrong owner — return 404, not 403 (no existence leak)
    throw new NotFoundError("Session not found");
  }
  logger.info({ userId, sessionId }, "Session revoked via session manager");
}

/**
 * Password hashing utilities using bcrypt.
 *
 * 12 rounds — strong enough for production, fast enough for tests.
 * Passwords are NEVER stored in plaintext and NEVER appear in logs.
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/**
 * Hashes a plain-text password.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Verifies a plain-text password against a stored hash.
 * Returns true if they match.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

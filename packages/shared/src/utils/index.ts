/**
 * Shared utility functions.
 *
 * Pure, deterministic helpers with no side effects.
 * Module-specific utilities live in their respective modules.
 */

/**
 * Encodes a cursor for pagination from an object.
 * Uses base64url encoding to keep cursors opaque to clients.
 */
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Decodes a pagination cursor back to its original value.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor<T extends Record<string, unknown>>(
  cursor: string,
): T | null {
  try {
    return JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8"),
    ) as T;
  } catch {
    return null;
  }
}

/**
 * Picks a subset of keys from an object.
 * Useful for creating safe DTOs without exposing sensitive fields.
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  return Object.fromEntries(
    keys.filter((k) => k in obj).map((k) => [k, obj[k]]),
  ) as Pick<T, K>;
}

/**
 * Omits a subset of keys from an object.
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const set = new Set<string>(keys as string[]);
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !set.has(k)),
  ) as Omit<T, K>;
}

/**
 * Sleeps for the given number of milliseconds.
 * For use in tests or retry logic only — do not use in hot paths.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns a value clamped between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generates a short human-readable reference from a UUID.
 * Used for order references, return IDs, etc.
 * NOT suitable as a unique key — always use UUID as primary key.
 */
export function shortRef(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
}

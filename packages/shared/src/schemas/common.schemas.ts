/**
 * Common primitive Zod schemas.
 *
 * Extracted into a separate file to avoid circular imports.
 * Domain schema files (catalog, auth, users, etc.) import from here,
 * not from ./index, so that index.ts can safely re-export everything
 * without creating a TDZ circular dependency.
 */
import { z } from "zod";

/** UUID validation */
export const uuidSchema = z.string().uuid();

/** ISO-8601 date string */
export const isoDateSchema = z.string().datetime({ offset: true });

/** Cursor pagination query params */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Positive money amount — validated as string to avoid float precision issues */
export const moneySchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal number with up to 2 decimal places");

/** Non-empty trimmed string */
export const nonEmptyString = z.string().trim().min(1);

/** URL string */
export const urlSchema = z.string().url();

/** Email address */
export const emailSchema = z.string().email().toLowerCase();

/** Password — minimum 8 chars, at least one letter and one number */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must not exceed 128 characters");

/** Realtime event envelope */
export const realtimeEventSchema = z.object({
  type: z.string(),
  version: z.number().int().positive(),
  id: uuidSchema,
  timestamp: isoDateSchema,
  data: z.unknown(),
});

export type RealtimeEvent<T = unknown> = {
  type: string;
  version: number;
  id: string;
  timestamp: string;
  data: T;
};

/**
 * Users Zod schemas.
 *
 * Source of truth for user profile and address validation.
 * Shared between server routes and frontend clients.
 */
import { z } from "zod";

// ─────────────────────────────────────────────
// PROFILE SCHEMAS
// ─────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name:      z.string().trim().min(1, "Name cannot be empty").max(255).optional(),
  avatarUrl: z.string().url("Invalid URL").max(500).nullable().optional(),
});

// ─────────────────────────────────────────────
// ADDRESS SCHEMAS
// ─────────────────────────────────────────────

export const createAddressSchema = z.object({
  label:        z.string().trim().max(50).optional(),
  fullName:     z.string().trim().min(1, "Full name is required").max(255),
  phone:        z.string().trim().min(5, "Phone number too short").max(30),
  addressLine1: z.string().trim().min(1, "Address line 1 is required").max(255),
  addressLine2: z.string().trim().max(255).optional(),
  city:         z.string().trim().min(1, "City is required").max(100),
  state:        z.string().trim().max(100).optional(),
  postalCode:   z.string().trim().min(1, "Postal code is required").max(20),
  country:      z.string().trim().min(2, "Country is required").max(100),
  isDefault:    z.boolean().default(false),
});

export const updateAddressSchema = createAddressSchema.partial();

/** Full address response DTO */
export const addressSchema = z.object({
  id:           z.string().uuid(),
  userId:       z.string().uuid(),
  label:        z.string().nullable(),
  fullName:     z.string(),
  phone:        z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city:         z.string(),
  state:        z.string().nullable(),
  postalCode:   z.string(),
  country:      z.string(),
  isDefault:    z.boolean(),
  createdAt:    z.string().or(z.date()),
  updatedAt:    z.string().or(z.date()),
});

// ─────────────────────────────────────────────
// INFERRED TYPES
// ─────────────────────────────────────────────

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type AddressDto         = z.infer<typeof addressSchema>;

/**
 * Shared API response schemas (Zod).
 *
 * Used at route boundaries for validation and as the source of truth
 * for Swagger/OpenAPI schema generation.
 *
 * Rule: Zod schemas live in packages/shared — not scattered in modules.
 * Module-specific schemas import from here and extend as needed.
 */
import { z } from "zod";

// ---- Generic response wrappers -------------------------------------------

export const successResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export const errorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
});

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
  }),
});

// ---- Health / Readiness schemas ------------------------------------------

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export const readinessCheckSchema = z.enum(["ok", "fail"]);

export const readinessResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: readinessCheckSchema,
    redis: readinessCheckSchema,
    pgboss: readinessCheckSchema,
  }),
});

// ---- Meta schema ---------------------------------------------------------

export const metaResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  environment: z.enum(["development", "test", "production"]),
  timestamp: z.string().datetime(),
});

// ---- Pagination schemas --------------------------------------------------

export const cursorPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(
  itemSchema: T,
) =>
  z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

// ---- Common param schemas ------------------------------------------------

export const uuidParamSchema = z.object({
  id: z.string().uuid("Invalid UUID"),
});

export const idParamSchema = z.object({
  id: z.string().uuid("Invalid UUID"),
});

// ---- Export types --------------------------------------------------------

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type MetaResponse = z.infer<typeof metaResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

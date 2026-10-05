/**
 * Shared type definitions.
 *
 * Common types used across modules.
 * Module-specific types live in their respective modules.
 */

/** Standard API success response shape */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

/** Standard API error response shape */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Cursor-based pagination parameters */
export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

/** Cursor-based pagination result */
export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

/** User role enum */
export type UserRole = "CUSTOMER" | "SELLER" | "ADMIN";

/** Common resource ownership check */
export interface OwnedResource {
  userId: string;
}

/** ISO-8601 UTC timestamp string */
export type IsoTimestamp = string;

/** UUID string */
export type Uuid = string;

/**
 * Shared Zod schemas.
 *
 * Reusable validation schemas used across multiple modules.
 * Module-specific schemas live in their respective modules.
 *
 * NOTE: Primitive schemas live in ./common.schemas to avoid circular
 * import TDZ errors. Domain files (catalog, auth, users) import from
 * ./common.schemas directly — never from ./index.
 */

// Primitives (source of truth — also re-exported here for consumers)
export * from "./common.schemas";

// Domain-specific schemas
export * from "./catalog.schemas";
export * from "./auth.schemas";
export * from "./users.schemas";

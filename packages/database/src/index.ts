/**
 * @marketplace/database — public API
 *
 * Exports:
 * - All table schemas (re-exported from schema/index.ts)
 * - Database client factory
 *
 * Usage in apps/server:
 *   import { createDrizzleClient } from "@marketplace/database";
 *   import * as schema from "@marketplace/database";
 */
export * from "./schema/index";
export { createDrizzleClient } from "./client";
export type { DrizzleClient } from "./client";

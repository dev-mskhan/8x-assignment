/**
 * Re-exports the validated server environment from the shared env package.
 *
 * Business modules import from here:
 *   import { serverEnv } from "@/config/env";
 *
 * Never use process.env directly in business code (AGENTS.md §41).
 */
export { serverEnv } from "@marketplace/env";

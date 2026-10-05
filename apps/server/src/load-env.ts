/**
 * Dotenv loader — must be imported FIRST in main.ts and register-workers.ts.
 *
 * Loads the .env file from the monorepo root before any other module
 * (including @marketplace/env) is evaluated. This is necessary because
 * @marketplace/env calls parseServerEnv() at module load time.
 *
 * Resolution order:
 *   1. Look for .env relative to process.cwd() (monorepo root when run via pnpm)
 *   2. Walk up to find .env if cwd is apps/server
 *
 * In production, environment variables are injected by the platform (Docker/K8s)
 * and dotenv is a no-op (override: false is the default).
 */
import path from "path";
import { config } from "dotenv";

// Try monorepo root first (pnpm run from workspace root sets cwd to package dir)
const results = [
  config({ path: path.resolve(process.cwd(), ".env") }),
  config({ path: path.resolve(process.cwd(), "../../.env") }),
  config({ path: path.resolve(__dirname, "../../../.env") }),
];

// Silent — if none found dotenv is a no-op, env vars must be set by platform
const loaded = results.find((r) => r.parsed);
if (loaded?.parsed) {
  // Only log in non-production to avoid leaking info
  if (process.env["NODE_ENV"] !== "production") {
    process.stdout.write(
      `[load-env] Loaded .env from dotenv (${Object.keys(loaded.parsed).length} vars)\n`,
    );
  }
}

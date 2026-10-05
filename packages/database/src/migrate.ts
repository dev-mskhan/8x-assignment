/**
 * Standalone migration runner.
 *
 * Execution order:
 *   1. Apply 0000_vector_extension.sql directly (not journal-tracked — extensions
 *      are idempotent via IF NOT EXISTS and don't need Drizzle tracking)
 *   2. Run Drizzle journal-tracked migrations (0001_initial_schema.sql, …)
 *
 * Usage:
 *   DATABASE_URL=... tsx src/migrate.ts
 *   pnpm db:migrate  (reads DATABASE_URL from .env via dotenv/config)
 *
 * Does NOT depend on @marketplace/env — runs standalone before app boots.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

// Load .env from the monorepo root (three levels up from packages/database/)
config({ path: resolve(__dirname, "../../../.env") });

async function runMigrations(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  console.log("Connecting to database…");
  const pool = new Pool({ connectionString });

  try {
    // ── Step 1: Apply vector extension SQL directly ──────────────────────────
    // This file is intentionally outside the Drizzle journal because PostgreSQL
    // extensions can only be created by superusers and the statement is
    // idempotent (CREATE EXTENSION IF NOT EXISTS).
    const extensionSql = readFileSync(
      resolve(__dirname, "../migrations/0000_vector_extension.sql"),
      "utf8",
    );
    console.log("Applying 0000_vector_extension.sql…");
    await pool.query(extensionSql);
    console.log("✓ Extensions ready");

    // ── Step 2: Run Drizzle journal-tracked migrations ────────────────────────
    console.log("Running Drizzle migrations…");
    const db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: resolve(__dirname, "../migrations"),
    });

    console.log("✓ All migrations applied successfully");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void runMigrations();

import "dotenv/config";
import { Pool } from "pg";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../../.env") });

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

async function main() {
  const r1 = await pool.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
  console.log("vector extension installed:", r1.rows.length > 0 ? "YES" : "NO");

  const r2 = await pool.query("SELECT version()");
  console.log("pg version:", r2.rows[0].version);

  const r3 = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  console.log("existing tables:", r3.rows.map((r: { tablename: string }) => r.tablename).join(", ") || "(none)");

  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

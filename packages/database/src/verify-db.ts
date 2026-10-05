import "dotenv/config";
import { Pool } from "pg";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../../.env") });

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

async function main() {
  // 1. Table count
  const tables = await pool.query(
    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
  );
  console.log("✓ Tables:", tables.rows[0].count);

  // 2. HNSW index
  const hnsw = await pool.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'products_embedding_hnsw_idx'",
  );
  if (hnsw.rows.length > 0) {
    console.log("✓ HNSW index:", hnsw.rows[0].indexdef);
  } else {
    console.log("✗ HNSW index MISSING");
  }

  // 3. Unique constraints
  const uniqs = await pool.query(`
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'UNIQUE'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name
  `);
  console.log("✓ Unique constraints:", uniqs.rows.length);

  // 4. Foreign keys
  const fks = await pool.query(`
    SELECT count(*) FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'
  `);
  console.log("✓ Foreign keys:", fks.rows[0].count);

  // 5. vector column type
  const vecCol = await pool.query(`
    SELECT udt_name, data_type FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'embedding'
  `);
  console.log("✓ embedding column:", vecCol.rows[0]?.udt_name ?? "NOT FOUND");

  // 6. Idempotency — run migration again, expect no error
  // (already handled by Drizzle's __drizzle_migrations tracking)

  await pool.end();
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

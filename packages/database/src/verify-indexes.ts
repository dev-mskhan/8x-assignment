import "dotenv/config";
import { Pool } from "pg";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../../.env") });
const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

async function main() {
  const r = await pool.query(`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
  const total = r.rows.length;
  const unique = r.rows.filter((row: { indexname: string }) => row.indexname.includes("idx")).length;
  console.log(`Total indexes: ${total}`);
  console.log("Key indexes present:");
  const keyIndexes = [
    "users_email_idx",
    "sellers_store_slug_idx",
    "sellers_user_id_idx",
    "products_slug_idx",
    "product_variants_sku_idx",
    "orders_order_number_idx",
    "orders_idempotency_key_idx",
    "payments_idempotency_key_idx",
    "outbox_events_status_created_at_idx",
    "products_embedding_hnsw_idx",
    "carts_user_id_idx",
    "cart_items_cart_variant_idx",
  ];
  for (const name of keyIndexes) {
    const found = r.rows.some((row: { indexname: string }) => row.indexname === name);
    console.log(`  ${found ? "✓" : "✗"} ${name}`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });

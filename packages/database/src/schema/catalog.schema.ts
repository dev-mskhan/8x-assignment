/**
 * Catalog domain schema.
 *
 * Tables: sellers, categories, products, product_variants
 *
 * Key rules (AGENTS.md + PRODUCTION_CHECKLIST.md):
 *  - Money: numeric(12,2) — never float
 *  - embedding: vector(1536) — matches EMBEDDING_DIMENSIONS=1536 env var
 *  - HNSW index on embedding for cosine similarity (text-embedding-3-small)
 *  - seller_id FK routes ownership through sellers table, not users
 *  - specifications JSONB — correct for variable product metadata
 *  - reserved_stock supports inventory reservation at checkout
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from "drizzle-orm/pg-core";
import { users } from "./auth.schema";

// ─────────────────────────────────────────────
// CUSTOM VECTOR TYPE (pgvector)
// drizzle-orm 0.30.x does not ship a built-in vector column.
// We define a custom column type that maps to PostgreSQL's vector(n) type.
// The extension is enabled via the manual 0000_vector_extension.sql migration.
// ─────────────────────────────────────────────

const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  },
});

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const sellerStatusEnum = pgEnum("seller_status", [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
]);

export const productStatusEnum = pgEnum("product_status", [
  "DRAFT",
  "ACTIVE",
  "OUT_OF_STOCK",
  "ARCHIVED",
]);

// ─────────────────────────────────────────────
// SELLERS
// ─────────────────────────────────────────────

export const sellers = pgTable(
  "sellers",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    userId:         uuid("user_id")
                      .notNull()
                      .references(() => users.id, { onDelete: "cascade" }),
    storeName:      text("store_name").notNull(),
    storeSlug:      text("store_slug").notNull(),
    description:    text("description"),
    logoUrl:        text("logo_url"),
    bannerUrl:      text("banner_url"),
    // Flexible seller registration metadata: GST, PAN, bank account details, etc.
    businessInfo:   jsonb("business_info"),
    rating:         numeric("rating", { precision: 3, scale: 2 }).notNull().default("0"),
    reviewCount:    integer("review_count").notNull().default(0),
    // Platform commission percentage — default 5%
    commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).notNull().default("5.00"),
    status:         sellerStatusEnum("status").notNull().default("PENDING"),
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One seller per user account
    userIdIdx:     uniqueIndex("sellers_user_id_idx").on(t.userId),
    // Slug is the public-facing URL segment — must be unique
    storeSlugIdx:  uniqueIndex("sellers_store_slug_idx").on(t.storeSlug),
    statusIdx:     index("sellers_status_idx").on(t.status),
  }),
);

// ─────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    name:        text("name").notNull(),
    slug:        text("slug").notNull(),
    description: text("description"),
    imageUrl:    text("image_url"),
    // NULL = top-level category; non-null = sub-category
    parentId:    uuid("parent_id"),
    sortOrder:   integer("sort_order").notNull().default(0),
    isActive:    boolean("is_active").notNull().default(true),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx:     uniqueIndex("categories_slug_idx").on(t.slug),
    parentIdIdx: index("categories_parent_id_idx").on(t.parentId),
    isActiveIdx: index("categories_is_active_idx").on(t.isActive),
  }),
);

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

export const products = pgTable(
  "products",
  {
    id:            uuid("id").primaryKey().defaultRandom(),
    sellerId:      uuid("seller_id")
                     .notNull()
                     .references(() => sellers.id, { onDelete: "cascade" }),
    categoryId:    uuid("category_id")
                     .notNull()
                     .references(() => categories.id),
    title:         text("title").notNull(),
    slug:          text("slug").notNull(),
    description:   text("description"),
    brand:         text("brand"),
    // Array of image URLs — JSONB because count is variable and no FK needed
    images:        jsonb("images").notNull().default([]),
    // Flexible product attributes: { "GPU": "RTX 4060", "RAM": "16GB", ... }
    specifications: jsonb("specifications"),
    ratingAverage: numeric("rating_average", { precision: 3, scale: 2 }).notNull().default("0"),
    reviewCount:   integer("review_count").notNull().default(0),
    status:        productStatusEnum("status").notNull().default("DRAFT"),
    // pgvector embedding for semantic search (Phase 8).
    // Dimensions must match EMBEDDING_DIMENSIONS env var (default 1536).
    // Seed data uses placeholder zeros; real vectors generated by PgBoss job in Phase 8.
    // HNSW index (vector_cosine_ops) defined below — requires pgvector extension first.
    embedding:     vector("embedding", { dimensions: 1536 }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx:      uniqueIndex("products_slug_idx").on(t.slug),
    sellerIdIdx:  index("products_seller_id_idx").on(t.sellerId),
    categoryIdx:  index("products_category_id_idx").on(t.categoryId),
    statusIdx:    index("products_status_idx").on(t.status),
    // Note: HNSW index for the embedding column is created via raw SQL in migration
    // 0000_vector_extension.sql because drizzle-orm 0.30.x does not support
    // .using("hnsw", ...) syntax. The index is:
    //   CREATE INDEX products_embedding_hnsw_idx ON products
    //   USING hnsw (embedding vector_cosine_ops);
    // This is applied after the table is created.
  }),
);

// ─────────────────────────────────────────────
// PRODUCT VARIANTS
// ─────────────────────────────────────────────

export const productVariants = pgTable(
  "product_variants",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    productId:      uuid("product_id")
                      .notNull()
                      .references(() => products.id, { onDelete: "cascade" }),
    // SKU is a business identity key — must be globally unique across all sellers
    sku:            text("sku").notNull(),
    // Variant-specific attributes: { "color": "Midnight Black", "storage": "512GB" }
    attributes:     jsonb("attributes"),
    // Money: numeric(12,2) — never float (AGENTS.md §7, PRODUCTION_CHECKLIST §8)
    price:          numeric("price", { precision: 12, scale: 2 }).notNull(),
    compareAtPrice: numeric("compare_at_price", { precision: 12, scale: 2 }),
    // stock = total physical stock; reserved_stock = held during checkout
    // available = stock - reserved_stock
    stock:          integer("stock").notNull().default(0),
    reservedStock:  integer("reserved_stock").notNull().default(0),
    weightGrams:    integer("weight_grams"),
    imageUrl:       text("image_url"),
    isActive:       boolean("is_active").notNull().default(true),
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skuIdx:              uniqueIndex("product_variants_sku_idx").on(t.sku),
    productIdIdx:        index("product_variants_product_id_idx").on(t.productId),
    // Composite index for "active variants for product" — used in catalog queries
    productActiveIdx:    index("product_variants_product_active_idx").on(t.productId, t.isActive),
  }),
);

// ---- Types -----------------------------------------------------------------

export type Seller         = typeof sellers.$inferSelect;
export type NewSeller      = typeof sellers.$inferInsert;
export type Category       = typeof categories.$inferSelect;
export type NewCategory    = typeof categories.$inferInsert;
export type Product        = typeof products.$inferSelect;
export type NewProduct     = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;

// Re-export the vector custom type so consumers can use it if needed
export { vector as vectorColumn };

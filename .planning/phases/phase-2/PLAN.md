# Phase 2 — Database, Core Domain & Seed Data
## PLAN.md

**Status:** `ready-for-execution`
**Depends on:** Phase 1 (complete)
**Blocks:** Phase 3 (Authentication & Users)

---

## Mandatory Pre-Read

Before executing any chunk in this phase:

1. `AGENTS.md` — architectural contract (no microservices, one DB client, one Redis client)
2. `.planning/PRODUCTION_CHECKLIST.md` — Tier 1 rules apply during every chunk; Tier 2 gate runs at phase end
3. `.planning/TESTING_CONTEXT.md` — integration tests use `buildApp()` + `app.inject()` + real PostgreSQL

---

## Phase Goal

Produce the complete, authoritative PostgreSQL domain model for the entire marketplace:

- 18 domain tables across 6 schema files
- pgvector extension enabled via manual migration
- HNSW index on `products.embedding` for semantic search
- Drizzle migrations runnable from a clean database
- Realistic seed data (5+ categories, 30+ products, 2 sellers, mixed orders/states)
- Public catalog read-only API (8 endpoints)
- OAuth PKCE scaffolding baked in now so Phase 3 does not require a migration rewrite

---

## Repository State at Phase Start

```
packages/database/src/
  schema/
    auth.schema.ts     ← EXISTS (users, sessions, password_reset_tokens)
    index.ts           ← EXISTS (only exports auth)
  client.ts            ← EXISTS
  index.ts             ← EXISTS
  # NO drizzle.config.ts
  # NO migrate.ts
  # NO seed.ts
  # NO migrations/ directory

apps/server/src/
  modules/             ← empty (.gitkeep)
  app/routes.ts        ← EXISTS (health/ready/meta only)
```

---

## Chunk Sequence

```
Chunk A — Drizzle tooling (config + migrate runner + drizzle-orm-helpers)
Chunk B — Schema: auth additions (oauth_accounts)
Chunk C — Schema: users domain (addresses)
Chunk D — Schema: catalog domain (categories, products, product_variants)
Chunk E — Schema: commerce domain (carts, cart_items, wishlists, orders,
                                   order_items, payments, coupons,
                                   returns, return_items)
Chunk F — Schema: fulfillment domain (shipments, shipment_tracking)
Chunk G — Schema: notifications domain (notifications, conversations,
                                        messages, outbox_events)
Chunk H — Schema barrel update + typecheck
Chunk I — Migration: manual 0000_vector_extension (pgvector)
Chunk J — Migration: drizzle-kit generate + verify
Chunk K — Migration runner smoke test (apply to dev DB from scratch)
Chunk L — Seed data
Chunk M — Catalog module (repository + service + controller + routes)
Chunk N — Wire catalog routes into app/routes.ts
Chunk O — Tier 2 phase gate (EXPLAIN ANALYZE + build + typecheck + lint + tests)
```

---

## Chunk A — Drizzle Tooling

### Files to create

**`packages/database/drizzle.config.ts`**

```typescript
import type { Config } from "drizzle-kit";
import { config } from "dotenv";
import { resolve } from "path";

// Load root .env when running drizzle-kit directly
config({ path: resolve(__dirname, "../../../.env") });

export default {
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"]!,
  },
  // Introspect comments as schema
  verbose: true,
  strict: true,
} satisfies Config;
```

**`packages/database/src/migrate.ts`**

- Import `drizzle-orm/node-postgres` migrator
- Load `migrations/` directory
- Connect with `DATABASE_URL` from env
- Run `migrate(db, { migrationsFolder: "./migrations" })`
- Log each migration applied
- Exit 0 on success, exit 1 on error
- Must not depend on `@marketplace/env` (standalone runner)

### Tier 1 checklist
- ✅ No business logic — tooling only
- ✅ Uses `DATABASE_URL` from process.env (standalone context, env package not available in migration runner)
- ✅ Drizzle config points to schema barrel, not individual files

---

## Chunk B — Schema: Auth Additions

### Decision

The existing `auth.schema.ts` stays intact — Phase 1 already established users, sessions, password_reset_tokens. We add `oauth_accounts` to support Phase 3 Google OAuth PKCE without requiring a later migration that touches the same schema file.

**`packages/database/src/schema/auth.schema.ts`** — APPEND:

```typescript
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    userId:          uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider:        text("provider").notNull(),           // "google"
    providerAccountId: text("provider_account_id").notNull(),
    accessToken:     text("access_token"),
    refreshToken:    text("refresh_token"),
    expiresAt:       timestamp("expires_at", { withTimezone: true }),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerAccountIdx: uniqueIndex("oauth_accounts_provider_account_idx")
      .on(t.provider, t.providerAccountId),
    userProviderIdx: uniqueIndex("oauth_accounts_user_provider_idx")
      .on(t.userId, t.provider),
    userIdIdx: index("oauth_accounts_user_id_idx").on(t.userId),
  }),
);

export type OauthAccount    = typeof oauthAccounts.$inferSelect;
export type NewOauthAccount = typeof oauthAccounts.$inferInsert;
```

### Phase 3 PKCE context baked in here

The `oauth_accounts` table is added now so Phase 3 can implement the full flow without a new migration affecting the auth schema. The PKCE flow works as follows:

```
1. Client hits GET /api/v1/auth/google
2. Server generates:
     code_verifier  = crypto.randomBytes(32) → base64url  (stored server-side in session/Redis TTL)
     code_challenge = sha256(code_verifier)  → base64url  (sent to Google)
     state          = crypto.randomUUID()    (stored server-side; checked on callback)
3. Server returns Google authorization URL with:
     response_type=code
     client_id, redirect_uri, scope
     code_challenge, code_challenge_method=S256
     state
4. Google redirects to GET /api/v1/auth/google/callback?code=...&state=...
5. Server verifies state, retrieves code_verifier
6. Server POSTs to Google token endpoint:
     code, redirect_uri, code_verifier, client_id, client_secret
7. Google returns access_token + id_token
8. Server upserts user + oauth_accounts row
9. Server creates session → sets HttpOnly cookie
```

The `code_verifier` and `state` are short-lived (5-minute TTL) and stored server-side (Redis or `password_reset_tokens`-style table). They are NEVER sent to the client.

### Env additions needed in Phase 3

Add to `packages/env/src/server.ts` (note here; not done in Phase 2 to keep scope clean):

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

### Tier 1 checklist
- ✅ unique constraint on (provider, provider_account_id) — prevents duplicate OAuth links
- ✅ unique constraint on (user_id, provider) — one Google account per user
- ✅ access/refresh tokens stored but never returned in API responses (enforced in Phase 3 DTOs)
- ✅ FK → users with cascade delete

---

## Chunk C — Schema: Users Domain

**`packages/database/src/schema/users.schema.ts`** — CREATE:

```typescript
/**
 * Users domain schema.
 * Tables: addresses
 *
 * Intentionally separate from auth.schema.ts per AGENTS.md §7 domain grouping.
 * Users-auth relationship is via FK to auth.users.
 */
import {
  pgTable, uuid, text, boolean,
  timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.schema";

export const addresses = pgTable(
  "addresses",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    userId:       uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    label:        text("label"),                  // "Home", "Office", etc.
    fullName:     text("full_name").notNull(),
    phone:        text("phone").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city:         text("city").notNull(),
    state:        text("state"),
    postalCode:   text("postal_code").notNull(),
    country:      text("country").notNull(),
    isDefault:    boolean("is_default").notNull().default(false),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:        index("addresses_user_id_idx").on(t.userId),
    defaultAddressIdx: index("addresses_user_default_idx").on(t.userId, t.isDefault),
  }),
);

export type Address    = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
```

### Tier 1 checklist
- ✅ FK to users with cascade delete
- ✅ userId indexed (FK pattern)
- ✅ composite index on (userId, isDefault) for fast default-address lookup
- ✅ No business rules in schema — `isDefault` uniqueness enforced at service layer

---

## Chunk D — Schema: Catalog Domain

**`packages/database/src/schema/catalog.schema.ts`** — CREATE:

### Tables: `sellers`, `categories`, `products`, `product_variants`

**Sellers**

```
id, user_id FK → users, store_name, store_slug (unique),
description, logo_url, banner_url,
business_info JSONB,                  ← flexible: GST, PAN, bank details
rating numeric(3,2) default 0,
review_count integer default 0,
commission_rate numeric(5,2) default 5.00,
status seller_status_enum,
created_at, updated_at
```

Indexes: `uniqueIndex(store_slug)`, `uniqueIndex(user_id)`, `index(status)`

**Categories**

```
id, name, slug (unique),
description, image_url,
parent_id uuid self-ref (nullable — NULL = top-level),
sort_order integer default 0,
is_active boolean default true,
created_at
```

Indexes: `uniqueIndex(slug)`, `index(parent_id)`, `index(is_active)`

**Products**

```
id,
seller_id FK → sellers (cascade delete),
category_id FK → categories,
title text NOT NULL,
slug text NOT NULL UNIQUE,
description text,
brand text,
images JSONB default '[]',
specifications JSONB,             ← { "GPU": "RTX 4060", "RAM": "16GB", ... }
rating_average numeric(3,2) default 0,
review_count integer default 0,
status product_status_enum default 'DRAFT',
embedding vector(1536),           ← pgvector; HNSW index created separately
created_at, updated_at
```

Indexes: `uniqueIndex(slug)`, `index(seller_id)`, `index(category_id)`, `index(status)`,
HNSW: `index("products_embedding_hnsw_idx").using("hnsw", embedding.op("vector_cosine_ops"))`

> **Note:** The HNSW index is defined in the Drizzle schema but the `vector` extension must exist first. The manual migration `0000_vector_extension.sql` is applied before drizzle-kit output.

**Product Variants**

```
id,
product_id FK → products (cascade delete),
sku text UNIQUE NOT NULL,
attributes JSONB,                 ← { "color": "Midnight Black", "storage": "512GB" }
price numeric(12,2) NOT NULL,
compare_at_price numeric(12,2),
stock integer NOT NULL default 0,
reserved_stock integer NOT NULL default 0,
weight_grams integer,
image_url text,
is_active boolean NOT NULL default true,
created_at, updated_at
```

Indexes: `uniqueIndex(sku)`, `index(product_id)`, `index(product_id, is_active)`

### Enums (defined in this file)

```typescript
export const sellerStatusEnum = pgEnum("seller_status", ["PENDING", "ACTIVE", "SUSPENDED"]);
export const productStatusEnum = pgEnum("product_status", ["DRAFT", "ACTIVE", "OUT_OF_STOCK", "ARCHIVED"]);
```

### Tier 1 checklist
- ✅ Money as `numeric(12,2)` — never float
- ✅ `embedding vector(1536)` — matches `EMBEDDING_DIMENSIONS=1536` in env
- ✅ HNSW index with `vector_cosine_ops` — correct for text-embedding-3-small cosine similarity
- ✅ `reserved_stock` column — supports inventory reservation pattern (Chunk E checkout)
- ✅ `specifications JSONB` — correct for flexible product metadata (GPU, RAM, storage, etc.)
- ✅ `store_slug` unique constraint — enforces seller URL uniqueness
- ✅ `product_slug` unique constraint — prevents duplicate catalog URLs
- ✅ `sku` unique constraint — SKU is a business identity key
- ✅ seller_id → sellers FK (not users) — ownership routed through sellers table
- ✅ `business_info JSONB` — appropriate for variable seller registration metadata

---

## Chunk E — Schema: Commerce Domain

**`packages/database/src/schema/commerce.schema.ts`** — CREATE:

### Tables

**Carts** — one per user, created lazily

```
id, user_id FK → users (cascade) UNIQUE,
created_at, updated_at
```

**Cart Items**

```
id, cart_id FK → carts (cascade),
product_id FK → products, variant_id FK → product_variants (nullable),
quantity integer NOT NULL CHECK (quantity > 0),
created_at, updated_at
UNIQUE (cart_id, variant_id) — one row per variant per cart
```

**Wishlists** — one per user

```
id, user_id FK → users (cascade) UNIQUE,
created_at
```

**Wishlist Items**

```
id, wishlist_id FK → wishlists (cascade),
product_id FK → products (cascade),
created_at
UNIQUE (wishlist_id, product_id)
```

**Orders**

```
id,
order_number text UNIQUE NOT NULL,        ← human-readable, e.g. ORD-20261005-0001
idempotency_key text UNIQUE NOT NULL,     ← client-provided, deduplication
user_id FK → users,
shipping_address JSONB NOT NULL,          ← snapshot at checkout time
billing_address JSONB,
coupon_id FK → coupons (nullable),
coupon_snapshot JSONB,                    ← snapshot of coupon value at checkout
subtotal numeric(12,2) NOT NULL,
discount numeric(12,2) NOT NULL default 0,
shipping_fee numeric(12,2) NOT NULL default 0,
tax numeric(12,2) NOT NULL default 0,
total numeric(12,2) NOT NULL,
status order_status_enum NOT NULL default 'PENDING',
payment_status payment_status_enum NOT NULL default 'PENDING',
notes text,
created_at, updated_at
```

> Address snapshots prevent historical orders from showing a changed address.
> Coupon snapshot prevents price changes on coupon from affecting historical orders.

**Order Items** — snapshot of purchase-time data

```
id, order_id FK → orders (cascade),
product_id FK → products,
variant_id FK → product_variants (nullable),
seller_id FK → sellers,
title_snapshot text NOT NULL,             ← product title at purchase time
sku_snapshot text NOT NULL,               ← variant SKU at purchase time
attributes_snapshot JSONB,               ← variant attributes at purchase time
unit_price_snapshot numeric(12,2) NOT NULL, ← price at purchase time
quantity integer NOT NULL CHECK (quantity > 0),
subtotal_snapshot numeric(12,2) NOT NULL  ← unit_price * quantity
```

Indexes: `index(order_id)`, `index(product_id)`, `index(seller_id)`, `index(variant_id)`

> `unit_price_snapshot` + `subtotal_snapshot` protect historical financial integrity.
> Later catalog price changes NEVER affect existing order records.

**Payments**

```
id, order_id FK → orders,
provider text NOT NULL,               ← "cod", "stripe", "paystack"
provider_payment_id text UNIQUE,      ← external transaction ID (nullable until confirmed)
amount numeric(12,2) NOT NULL,
currency text NOT NULL default 'USD',
method text,                          ← "card", "cod", "bank_transfer"
status payment_status_enum NOT NULL default 'PENDING',
idempotency_key text UNIQUE NOT NULL, ← prevents duplicate payment records
metadata JSONB,                       ← provider-specific data
created_at, updated_at
```

Indexes: `index(order_id)`, `uniqueIndex(provider_payment_id)`, `uniqueIndex(idempotency_key)`

**Coupons**

```
id, code text UNIQUE NOT NULL,
type coupon_type_enum NOT NULL,       ← "PERCENTAGE" | "FIXED"
value numeric(12,2) NOT NULL CHECK (value > 0),
minimum_order_value numeric(12,2),
maximum_discount numeric(12,2),
usage_limit integer,
used_count integer NOT NULL default 0,
starts_at timestamp,
expires_at timestamp,
is_active boolean NOT NULL default true,
created_at, updated_at
```

Indexes: `uniqueIndex(code)`, `index(is_active, expires_at)`

**Returns**

```
id, order_id FK → orders, user_id FK → users,
return_number text UNIQUE NOT NULL,
reason return_reason_enum NOT NULL,   ← "DEFECTIVE" | "WRONG_ITEM" | "NOT_AS_DESCRIBED" | "CHANGED_MIND" | "OTHER"
description text,
images JSONB default '[]',
refund_amount numeric(12,2),
status return_status_enum NOT NULL default 'REQUESTED',
created_at, updated_at
```

**Return Items**

```
id, return_id FK → returns (cascade),
order_item_id FK → order_items,
quantity integer NOT NULL CHECK (quantity > 0),
unit_refund_amount numeric(12,2)
```

### Enums (defined in this file)

```typescript
export const orderStatusEnum   = pgEnum("order_status",   ["PENDING","CONFIRMED","PROCESSING","SHIPPED","DELIVERED","CANCELLED","RETURN_REQUESTED","RETURN_APPROVED","RETURN_IN_TRANSIT","RETURN_RECEIVED","REFUND_PENDING","REFUNDED"]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING","AUTHORIZED","PAID","FAILED","REFUNDED","PARTIALLY_REFUNDED"]);
export const couponTypeEnum    = pgEnum("coupon_type",     ["PERCENTAGE","FIXED"]);
export const returnReasonEnum  = pgEnum("return_reason",   ["DEFECTIVE","WRONG_ITEM","NOT_AS_DESCRIBED","CHANGED_MIND","OTHER"]);
export const returnStatusEnum  = pgEnum("return_status",   ["REQUESTED","APPROVED","REJECTED","IN_TRANSIT","RECEIVED","REFUND_PENDING","REFUNDED"]);
```

### Tier 1 checklist
- ✅ `idempotency_key` unique on orders — prevents duplicate checkout
- ✅ `idempotency_key` unique on payments — prevents duplicate payment records
- ✅ All money fields `numeric(12,2)`
- ✅ `unit_price_snapshot` + `subtotal_snapshot` on order_items — historical financial integrity
- ✅ `shipping_address JSONB` snapshot — order address frozen at checkout
- ✅ `coupon_snapshot JSONB` — coupon terms frozen at checkout
- ✅ `CHECK (quantity > 0)` on cart_items, order_items, return_items
- ✅ UNIQUE (cart_id, variant_id) — prevents duplicate cart rows for same variant
- ✅ `provider_payment_id UNIQUE` — prevents duplicate provider transaction records

---

## Chunk F — Schema: Fulfillment Domain

**`packages/database/src/schema/fulfillment.schema.ts`** — CREATE:

```
shipments:
  id, order_id FK → orders,
  carrier text, tracking_number text,
  status shipment_status_enum NOT NULL default 'PENDING',
  estimated_delivery timestamp,
  shipped_at timestamp, delivered_at timestamp,
  created_at, updated_at

shipment_tracking:
  id, shipment_id FK → shipments (cascade),
  status text NOT NULL,
  location text,
  description text,
  occurred_at timestamp NOT NULL,
  created_at
```

Indexes: `index(order_id)`, `index(tracking_number)` on shipments; `index(shipment_id)` on tracking

Enum:

```typescript
export const shipmentStatusEnum = pgEnum("shipment_status", [
  "PENDING","SHIPPED","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED","RETURNED"
]);
```

### Tier 1 checklist
- ✅ Separate `shipment_tracking` table (not JSONB array) — enables proper indexing and querying per-event
- ✅ Timestamps on individual tracking events for timeline sorting
- ✅ FK on both tables

---

## Chunk G — Schema: Notifications Domain

**`packages/database/src/schema/notifications.schema.ts`** — CREATE:

```
notifications:
  id, user_id FK → users (cascade),
  type notification_type_enum NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data JSONB,             ← { orderId, productId, etc. } — only stable IDs, no copies of business data
  read_at timestamp,
  created_at

outbox_events:
  id uuid PK defaultRandom,
  type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_type text NOT NULL,
  payload JSONB NOT NULL,
  status outbox_status_enum NOT NULL default 'pending',
  created_at, updated_at, processed_at timestamp

conversations:
  id, user_id FK → users (cascade),
  title text,
  last_message_at timestamp,
  created_at, updated_at

messages:
  id, conversation_id FK → conversations (cascade),
  role message_role_enum NOT NULL,   ← "USER" | "ASSISTANT"
  content text NOT NULL,
  product_ids JSONB default '[]',    ← product IDs shown in this message
  metadata JSONB,
  created_at
```

Indexes:
- notifications: `index(user_id)`, `index(user_id, read_at)` (unread count queries)
- outbox_events: `index(status, created_at)` — outbox poll query; `index(aggregate_id)`
- conversations: `index(user_id)`
- messages: `index(conversation_id)`, `index(conversation_id, created_at)`

Enums:

```typescript
export const notificationTypeEnum = pgEnum("notification_type", [
  "ORDER","PAYMENT","SHIPMENT","RETURN","PROMOTION","SYSTEM","REVIEW"
]);
export const outboxStatusEnum     = pgEnum("outbox_status", ["pending","processing","completed","failed"]);
export const messageRoleEnum      = pgEnum("message_role", ["USER","ASSISTANT"]);
```

### Tier 1 checklist
- ✅ `outbox_events` table now matches `outbox.ts` in `core/events/` exactly — the publisher polls `status='pending'`, marks `processing`, then `completed`/`failed`
- ✅ `index(status, created_at)` on outbox_events — critical for the poll query performance
- ✅ `read_at` nullable (null = unread) — simpler than a boolean + separate timestamp
- ✅ `data JSONB` on notifications stores only IDs, not copies of mutable business data
- ✅ `product_ids JSONB` on messages stores reference IDs, not product snapshots

---

## Chunk H — Schema Barrel Update

**`packages/database/src/schema/index.ts`** — UPDATE to export all 6 domain files:

```typescript
export * from "./auth.schema";
export * from "./users.schema";
export * from "./catalog.schema";
export * from "./commerce.schema";
export * from "./fulfillment.schema";
export * from "./notifications.schema";
```

Run `pnpm typecheck` in `packages/database` — must pass before proceeding to migrations.

### Conflict checks before exporting

| Potential duplicate export | Resolution |
|---|---|
| `userRoleEnum` / `userStatusEnum` | Defined only in `auth.schema.ts` |
| `sellerStatusEnum` | Defined only in `catalog.schema.ts` |
| `productStatusEnum` | Defined only in `catalog.schema.ts` |
| `orderStatusEnum` | Defined only in `commerce.schema.ts` |
| `paymentStatusEnum` | Defined only in `commerce.schema.ts` |
| `shipmentStatusEnum` | Defined only in `fulfillment.schema.ts` |
| `notificationTypeEnum` | Defined only in `notifications.schema.ts` |

Each enum is defined in exactly one file. No duplicate exports.

---

## Chunk I — Manual Migration: pgvector Extension

Create **`packages/database/migrations/0000_vector_extension.sql`** manually (before running drizzle-kit generate):

```sql
-- Enable pgvector extension
-- Must run before any table that uses the vector type.
-- Idempotent: safe to re-run.
CREATE EXTENSION IF NOT EXISTS vector;

-- Also enable useful extensions used elsewhere
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- used by LIKE/ILIKE index optimization in Phase 4 search
```

> Drizzle does not manage extension creation. This file must be the first migration applied.
> The `migrate.ts` runner applies files in lexicographic order — `0000_` runs before anything drizzle-kit generates (which starts at `0001_` or uses timestamp prefixes).

**`packages/database/src/migrate.ts`** must apply this file first, then drizzle-kit migrations:

```typescript
import { migrate } from "drizzle-orm/node-postgres/migrator";
// ...
await migrate(db, { migrationsFolder: "./migrations" });
```

Drizzle's migrator tracks applied migrations in the `__drizzle_migrations` table — `0000_vector_extension.sql` is applied once and never re-applied.

---

## Chunk J — drizzle-kit generate

Run:

```bash
pnpm --filter @marketplace/database db:generate
```

Expected output:
- Creates `packages/database/migrations/0001_<name>.sql` (or timestamp-prefixed)
- SQL contains all CREATE TABLE, CREATE TYPE, CREATE INDEX statements
- HNSW index SQL: `CREATE INDEX products_embedding_hnsw_idx ON products USING hnsw (embedding vector_cosine_ops)`

### Verify generated SQL contains

- [ ] All 18 tables
- [ ] All enum types
- [ ] All foreign key constraints
- [ ] HNSW index on `products.embedding`
- [ ] All unique constraints
- [ ] All named indexes
- [ ] `CHECK (quantity > 0)` constraints

---

## Chunk K — Migration Smoke Test

```bash
pnpm db:migrate
```

Expected:
- Connects to DATABASE_URL from `.env`
- Applies `0000_vector_extension.sql` first
- Applies drizzle-kit generated migration(s)
- Exits 0
- Re-running is a no-op (idempotent)

### Verify

```sql
-- Should return true
SELECT EXISTS (SELECT FROM pg_extension WHERE extname = 'vector');

-- Should return 18 tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Should return all our indexes
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;
```

---

## Chunk L — Seed Data

**`packages/database/src/seed.ts`** — CREATE:

### Seed structure

The seed script is idempotent using `ON CONFLICT DO NOTHING` (or `ON CONFLICT DO UPDATE` for ratings). It can be re-run safely.

### Users

| Email | Password | Role | Name |
|-------|----------|------|------|
| `customer@demo.com` | `Demo@1234` | CUSTOMER | Alice Chen |
| `customer2@demo.com` | `Demo@1234` | CUSTOMER | Bob Martinez |
| `seller@demo.com` | `Demo@1234` | SELLER | TechVault Store |
| `seller2@demo.com` | `Demo@1234` | SELLER | GreenLeaf Market |
| `admin@demo.com` | `Demo@1234` | ADMIN | Admin User |

All passwords hashed with bcrypt (12 rounds) using the existing `hashPassword()` utility from `core/auth/password.ts` (imported as a local function in seed, not via the app module). The seed must not depend on running app infrastructure.

### Sellers

| Store | Slug | Seller Email |
|-------|------|-------------|
| TechVault | `techvault` | seller@demo.com |
| GreenLeaf Market | `greenleaf` | seller2@demo.com |

### Categories (6 top-level)

| Name | Slug |
|------|------|
| Electronics | `electronics` |
| Gaming | `gaming` |
| Books | `books` |
| Home & Kitchen | `home-kitchen` |
| Fashion | `fashion` |
| Sports & Outdoors | `sports-outdoors` |

Sub-categories (children):

| Name | Slug | Parent |
|------|------|--------|
| Laptops | `laptops` | electronics |
| Smartphones | `smartphones` | electronics |
| Headphones | `headphones` | electronics |
| Gaming Laptops | `gaming-laptops` | gaming |
| Gaming Peripherals | `gaming-peripherals` | gaming |

### Products — minimum 30 total

#### Gaming / Gaming Laptops (AI demo priority)

1. **ASUS ROG Strix G16 Gaming Laptop** *(AI demo target)*
   - `slug: asus-rog-strix-g16`
   - brand: ASUS
   - specifications: `{ "GPU": "NVIDIA RTX 4060", "CPU": "Intel Core i7-13650HX", "RAM": "16GB DDR5", "Storage": "512GB NVMe SSD", "Display": "16\" 165Hz FHD IPS", "OS": "Windows 11" }`
   - Variants: (16GB/512GB Black ₹145,000), (32GB/1TB Black ₹185,000)
   - status: ACTIVE, rating: 4.6, review_count: 48
   - embedding text: `"ASUS ROG Strix G16 Gaming Laptop RTX 4060 Intel Core i7 16GB DDR5 RAM 512GB NVMe SSD 165Hz FHD gaming ASUS Electronics"`

2. **MSI Titan GT77 Gaming Laptop**
   - GPU: RTX 4080, CPU: Intel Core i9, 32GB RAM
   - Variants: (32GB/2TB ₹225,000)
   - status: ACTIVE, rating: 4.8

3. **Lenovo LOQ Gaming Laptop**
   - GPU: RTX 4050, CPU: Ryzen 5 7640HS, 16GB RAM
   - Variants: (16GB/512GB ₹89,000), (16GB/512GB Storm Grey ₹91,000)
   - status: ACTIVE, rating: 4.3

4. **Razer Blade 14 Gaming Laptop**
   - GPU: RTX 4070, CPU: Ryzen 9 7940HX
   - Variants: (16GB/1TB ₹195,000)
   - status: ACTIVE

5. **ASUS TUF Gaming A15**
   - GPU: RTX 4060, CPU: Ryzen 7 7745HX
   - Variants: (8GB/512GB ₹78,000), (16GB/512GB ₹89,000)
   - One variant: stock 0 (OUT_OF_STOCK demo)

#### Electronics / Laptops

6. **Apple MacBook Air M3** — 2 variants (8GB/256GB, 16GB/512GB)
7. **Dell XPS 15** — 2 variants
8. **HP Spectre x360** — 2 variants

#### Electronics / Smartphones

9. **Samsung Galaxy S25 Ultra** — 3 variants (128GB/256GB/512GB)
10. **Apple iPhone 16 Pro Max** — 3 variants
11. **Google Pixel 9 Pro** — 2 variants
12. **OnePlus 13** — 2 variants (budget tier)

#### Electronics / Headphones

13. **Sony WH-1000XM5** — 2 variants (Black, Silver)
14. **Apple AirPods Pro 3** — 1 variant
15. **Jabra Evolve2 85** — 2 variants

#### Gaming / Peripherals

16. **Logitech G Pro X Superlight 2 Mouse** — 2 variants
17. **Corsair K100 RGB Keyboard** — 1 variant
18. **HyperX Cloud Alpha Headset** — 2 variants

#### Books (5 products — seller2)

19. **Clean Code** (Robert C. Martin) — 1 variant (paperback)
20. **Designing Data-Intensive Applications** — 1 variant
21. **The Pragmatic Programmer** — 1 variant
22. **System Design Interview** — 2 variants (Vol 1, Vol 2)
23. **You Don't Know JS** — 1 variant

#### Home & Kitchen (4 products — seller2)

24. **Instant Pot Duo 7-in-1** — 2 variants (3qt, 6qt)
25. **Dyson V15 Detect Vacuum** — 1 variant
26. **Philips Air Fryer XXL** — 1 variant
27. **Nespresso Vertuo Next** — 2 variants (colors)

#### Fashion (3 products — mixed sellers)

28. **Nike Air Max 270** — 3 variants (UK 7/8/9)
29. **Levi's 511 Slim Fit Jeans** — 3 variants (30x32, 32x32, 34x32)
30. **Ray-Ban Classic Aviator Sunglasses** — 2 variants

#### Sports & Outdoors (3 products — seller2)

31. **Fitbit Charge 6** — 2 variants (colors)
32. **Coleman Sundome Tent** — 2 variants (2-person, 4-person)
33. **Garmin Forerunner 255** — 1 variant

### Addresses

- Alice Chen: one default address (home, Mumbai)
- Bob Martinez: one default address (home, Delhi)
- Both seller accounts: one business address each

### Orders — 4 pre-seeded orders for demo/testing

| # | User | Product | Status | Payment | Purpose |
|---|------|---------|--------|---------|---------|
| ORD-DEMO-001 | Alice | ASUS ROG G16 (32GB) | DELIVERED | PAID | Review-eligible, returnable |
| ORD-DEMO-002 | Alice | Galaxy S25 Ultra | SHIPPED | PAID | Tracking demo |
| ORD-DEMO-003 | Bob | MacBook Air M3 | PROCESSING | PAID | Order status demo |
| ORD-DEMO-004 | Alice | Sony WH-1000XM5 | DELIVERED | PAID | Review-eligible |

For ORD-DEMO-001: also create a `returns` record (status: REQUESTED) — demonstrates returnable delivered order.

For ORD-DEMO-001 and ORD-DEMO-004: create `reviews` records (PUBLISHED, ratings 5 and 4) — demonstrates published reviews.

### Embeddings

Embeddings for the demo seed are **not real OpenAI vectors** (no API call in seed). Instead, insert placeholder arrays of 1536 zeros for all products during seed. The real embedding generation job runs asynchronously in Phase 8. The HNSW index accepts zero vectors without error.

```typescript
// In seed: placeholder embedding
const zeroEmbedding = new Array(1536).fill(0);
```

**Exception**: For the ASUS ROG G16 specifically, insert a deterministic fake embedding (use a predictable fixed array pattern) to allow the Phase 8 AI search demo to be validated. Document this clearly in a comment.

### Tier 1 checklist for seed
- ✅ Idempotent (ON CONFLICT DO NOTHING / upsert on stable slug/email)
- ✅ All order items have `title_snapshot`, `sku_snapshot`, `unit_price_snapshot` populated
- ✅ All order totals are mathematically consistent (subtotal + shipping + tax - discount = total)
- ✅ `verified_purchase` flag on reviews matches actual order items
- ✅ Passwords hashed before insert, never stored plaintext
- ✅ No secrets or real API keys in seed
- ✅ Seed uses bcrypt from the same password utility as the app

---

## Chunk M — Catalog Module

**`apps/server/src/modules/catalog/`** — CREATE:

### Files

```
catalog/
  catalog.routes.ts
  catalog.controller.ts
  catalog.service.ts
  catalog.repository.ts
```

No `catalog.jobs.ts` or `catalog.schema.ts` needed yet (embedding jobs are Phase 8).

### Routes (public, no auth required)

```
GET /api/v1/categories                    — list all active top-level categories (with children)
GET /api/v1/categories/:slug              — single category by slug + sub-categories
GET /api/v1/products                      — paginated product list (cursor-based)
GET /api/v1/products/:productId           — product detail
GET /api/v1/products/:productId/variants  — variants for a product
GET /api/v1/sellers/:sellerId             — seller public profile
GET /api/v1/sellers/:sellerId/products    — seller's active products (paginated)
```

### Query parameters for `GET /api/v1/products`

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `cursor` | string | — | — | Cursor for next page (base64-encoded `{id, createdAt}`) |
| `limit` | number | 20 | 100 | Items per page |
| `categoryId` | uuid | — | — | Filter by category |
| `categorySlug` | string | — | — | Alternative to categoryId |
| `minPrice` | number | — | — | Minimum variant price |
| `maxPrice` | number | — | — | Maximum variant price |
| `brand` | string | — | — | Filter by brand (exact, case-insensitive) |
| `status` | string | ACTIVE | — | Product status filter (public: ACTIVE only) |
| `sellerId` | uuid | — | — | Filter by seller |
| `inStock` | boolean | — | — | Only products with stock > 0 |
| `q` | string | — | 200 chars | Simple text search on title/brand |

All query params validated with Zod in the route schema.

### Pagination strategy

Cursor-based pagination on `(created_at, id)`:

```sql
WHERE (created_at, id) < (:cursor_created_at, :cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT :limit + 1  -- fetch +1 to detect hasNextPage
```

Cursor is base64-encoded JSON `{ "createdAt": "...", "id": "..." }`.

This is deterministic even if two products have the same `created_at`.

### Repository layer — key queries

**`listProducts`**: Drizzle query with all filter conditions. Uses `products.status = 'ACTIVE'` baseline filter always (public endpoint). Returns product + min/max variant price via subquery (no N+1).

**`getProductById`**: Returns product + all active variants in one query. Returns `null` for non-ACTIVE status (not found to caller = 404).

**`getProductVariants`**: Simple FK lookup, returns all active variants for a product.

**`getCategories`**: `SELECT * FROM categories WHERE is_active = true AND parent_id IS NULL` + fetch all children in second query. Two queries, no N+1.

**`getSellerById`**: Public seller profile — filters `status = 'ACTIVE'`. Returns null for non-active seller.

**`getSellerProducts`**: Products for a seller, `status = 'ACTIVE'` only, paginated.

### Performance rules (Tier 1)
- ✅ No unbounded `SELECT *` — select only columns needed for response DTO
- ✅ List endpoints bounded (default 20, max 100)
- ✅ Cursor pagination (not offset — avoids skip penalty on large catalogs)
- ✅ No N+1: product list query joins/subqueries for min variant price instead of looping
- ✅ `q` text search input capped at 200 chars in Zod schema
- ✅ Price filters applied as SQL `WHERE` conditions, not in-memory

### Response DTOs

**Product list item** (lean):
```typescript
{
  id, slug, title, brand, categoryId,
  ratingAverage, reviewCount, status,
  minPrice, maxPrice,  // from variants subquery
  images: [first image only],
  sellerId, sellerName
}
```

**Product detail** (full):
```typescript
{
  id, slug, title, description, brand,
  specifications, images,
  ratingAverage, reviewCount, status,
  category: { id, name, slug },
  seller: { id, storeName, storeSlug, rating },
  variants: [ { id, sku, attributes, price, compareAtPrice, stock, imageUrl } ]
}
```

> `embedding` is never included in any response DTO.
> `passwordHash` (via user) is never included.

### Controller layer

Thin: parse query/params, call service, return response.

```typescript
// Response shape
return reply.status(200).send({ success: true, data: result });
```

Uses `paginatedResponseSchema` from `@marketplace/shared` if it exists, otherwise inline.

### Service layer

Validates that category filters resolve to real category IDs. Validates cursor before passing to repository. Calls repository. Applies any business transforms before returning.

---

## Chunk N — Wire Catalog Routes

**`apps/server/src/app/routes.ts`** — ADD:

```typescript
import { catalogRoutes } from "../modules/catalog/catalog.routes";

// Inside registerRoutes():
await app.register(catalogRoutes, { prefix: "/api/v1" });
```

Run smoke test after wiring:

```bash
curl http://localhost:3000/api/v1/categories
curl http://localhost:3000/api/v1/products?limit=5
```

---

## Chunk O — Tier 2 Phase Gate

### 1. Build checks

```bash
pnpm typecheck   # must pass with zero errors
pnpm lint        # must pass with zero warnings/errors
pnpm build       # must produce dist/
```

### 2. Migration check

```bash
# Drop and recreate test DB, apply migrations from scratch
pnpm db:migrate  # must exit 0
pnpm db:seed     # must exit 0, must be idempotent (run twice → same state)
```

### 3. EXPLAIN ANALYZE — key queries

Run against seeded DB and verify index usage:

```sql
-- Products list (most frequent query)
EXPLAIN ANALYZE
SELECT p.*, MIN(v.price) as min_price
FROM products p
JOIN product_variants v ON v.product_id = p.id
WHERE p.status = 'ACTIVE'
  AND p.category_id = '<gaming-laptops-uuid>'
ORDER BY p.created_at DESC, p.id DESC
LIMIT 21;
-- Expected: Index Scan on products_category_id_idx + products_status_idx

-- Product detail
EXPLAIN ANALYZE
SELECT * FROM products WHERE id = '<uuid>' AND status = 'ACTIVE';
-- Expected: Index Scan on products pkey

-- Outbox poll (critical for performance)
EXPLAIN ANALYZE
UPDATE outbox_events SET status = 'processing'
WHERE id IN (
  SELECT id FROM outbox_events
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 50 FOR UPDATE SKIP LOCKED
)
RETURNING id, type, aggregate_id, payload;
-- Expected: Index Scan on outbox_events_status_created_at_idx
```

### 4. Constraint verification

```sql
-- FK constraints
SELECT tc.table_name, tc.constraint_name, ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;

-- Unique constraints
SELECT tc.table_name, tc.constraint_name
FROM information_schema.table_constraints tc
WHERE tc.constraint_type = 'UNIQUE'
ORDER BY tc.table_name;
```

### 5. pgvector verification

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- Verify HNSW index exists
SELECT indexname, indexdef FROM pg_indexes
WHERE indexname = 'products_embedding_hnsw_idx';

-- Verify embedding column accepts a vector (should not error)
UPDATE products
SET embedding = array_fill(0.0::float, ARRAY[1536])::vector
WHERE slug = 'asus-rog-strix-g16';

-- Verify cosine distance operator works
SELECT id, slug, embedding <=> array_fill(0.0::float, ARRAY[1536])::vector AS distance
FROM products
WHERE embedding IS NOT NULL
ORDER BY distance ASC
LIMIT 5;
```

### 6. Catalog endpoint smoke tests

```bash
# All should return 200 with { success: true, data: ... }
curl -s http://localhost:3000/api/v1/categories | jq '.data | length'
# expect >= 6

curl -s http://localhost:3000/api/v1/products?limit=5 | jq '.data.items | length'
# expect 5

curl -s "http://localhost:3000/api/v1/products?categorySlug=gaming-laptops&limit=10" | jq '.data.items[].title'
# expect gaming laptop titles

curl -s "http://localhost:3000/api/v1/products?minPrice=100000&maxPrice=200000&inStock=true" | jq '.data.total'
# expect products in that price range

curl -s "http://localhost:3000/api/v1/products?q=RTX" | jq '.data.items | map(.title)'
# expect RTX products
```

### 7. Integration tests

Add to `tests/integration/`:

**`catalog.test.ts`** covering:
- `GET /api/v1/categories` — returns all active categories, children nested
- `GET /api/v1/categories/:slug` — found / not found (404)
- `GET /api/v1/products` — pagination works (cursor round-trip)
- `GET /api/v1/products` — category filter returns only matching products
- `GET /api/v1/products` — `status=DRAFT` product does not appear (public endpoint only sees ACTIVE)
- `GET /api/v1/products` — `inStock=true` excludes zero-stock variants
- `GET /api/v1/products` — price range filters correct
- `GET /api/v1/products` — q search input bounded (>200 chars → 400)
- `GET /api/v1/products/:id` — found (returns full detail with variants)
- `GET /api/v1/products/:id` — not found → 404 `{ success: false, error: { code: "NOT_FOUND" } }`
- `GET /api/v1/products/:id` — DRAFT product → 404 (not exposed publicly)
- `GET /api/v1/products/:id/variants` — returns variants for product
- `GET /api/v1/sellers/:sellerId` — active seller profile returned
- `GET /api/v1/sellers/:sellerId` — suspended seller → 404
- `GET /api/v1/sellers/:sellerId/products` — only ACTIVE products returned
- No `embedding` field in any response body
- No `passwordHash` field in any response body

Tests use `runId`-scoped fixtures per TESTING_CONTEXT.md §7-9.

---

## Phase 3 Pre-Wiring Summary (for executor awareness)

The following is scaffolded in Phase 2 and consumed in Phase 3, so the implementor does not need to add a new migration:

| What | Where | Status after Phase 2 |
|------|-------|---------------------|
| `oauth_accounts` table | `auth.schema.ts` | Created in migration |
| `addresses` table | `users.schema.ts` | Created in migration |
| `password_reset_tokens` table | `auth.schema.ts` | Already exists (Phase 1) |
| PKCE flow design | This document §Chunk B | Documented |
| Env vars needed | `packages/env/src/server.ts` | Added in Phase 3 |

---

## File Creation Summary

| File | Action |
|------|--------|
| `packages/database/drizzle.config.ts` | CREATE |
| `packages/database/src/migrate.ts` | CREATE |
| `packages/database/src/seed.ts` | CREATE |
| `packages/database/migrations/0000_vector_extension.sql` | CREATE (manual) |
| `packages/database/src/schema/auth.schema.ts` | APPEND (`oauth_accounts`) |
| `packages/database/src/schema/users.schema.ts` | CREATE |
| `packages/database/src/schema/catalog.schema.ts` | CREATE |
| `packages/database/src/schema/commerce.schema.ts` | CREATE |
| `packages/database/src/schema/fulfillment.schema.ts` | CREATE |
| `packages/database/src/schema/notifications.schema.ts` | CREATE |
| `packages/database/src/schema/index.ts` | UPDATE (uncomment all exports) |
| `packages/database/migrations/0001_<generated>.sql` | GENERATED (drizzle-kit) |
| `apps/server/src/modules/catalog/catalog.routes.ts` | CREATE |
| `apps/server/src/modules/catalog/catalog.controller.ts` | CREATE |
| `apps/server/src/modules/catalog/catalog.service.ts` | CREATE |
| `apps/server/src/modules/catalog/catalog.repository.ts` | CREATE |
| `apps/server/src/app/routes.ts` | UPDATE (register catalog routes) |

Total new files: 14 created + 3 updated + 1 generated migration.

---

## Phase Gate Exit Criteria

A phase is **COMPLETE** only when ALL of the following pass:

- [ ] `pnpm typecheck` — zero TypeScript errors
- [ ] `pnpm lint` — zero lint errors
- [ ] `pnpm build` — succeeds
- [ ] `pnpm db:migrate` — applies from empty DB without errors
- [ ] `pnpm db:migrate` — idempotent (re-run = no-op)
- [ ] `pnpm db:seed` — creates realistic data without errors
- [ ] `pnpm db:seed` — idempotent (re-run = no change)
- [ ] pgvector extension confirmed installed
- [ ] HNSW index confirmed on `products.embedding`
- [ ] All 18 tables confirmed created
- [ ] EXPLAIN ANALYZE on product list shows index usage (no Seq Scan on large tables)
- [ ] EXPLAIN ANALYZE on outbox poll shows index usage
- [ ] All FK constraints confirmed
- [ ] All unique constraints confirmed
- [ ] Catalog endpoints return `{ success: true, data: ... }` correctly
- [ ] DRAFT/suspended products not returned in public catalog
- [ ] No `embedding` field in any catalog API response
- [ ] No `passwordHash` in any response
- [ ] Catalog integration tests pass
- [ ] Existing health/ready/meta integration tests still pass (no regression)

---

## What This Phase Does NOT Do

These are explicitly out of scope — do not implement them here:

- Auth routes (Phase 3)
- Google OAuth PKCE implementation (Phase 3 — only schema scaffolded here)
- Cart and wishlist routes (Phase 4)
- Checkout (Phase 4)
- Seller management routes (Phase 5)
- Payment processing (Phase 6)
- Embedding generation via OpenAI API (Phase 8 — seed uses placeholder zeros)
- Admin endpoints (Phase 9)
- Review creation (Phase 7 — reviews table exists for seed only)
- Real-time WebSocket events (Phase 7)

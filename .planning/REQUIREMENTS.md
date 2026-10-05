# Amazon-Style Marketplace — Requirements

**Architecture:** Modular monolith (Fastify + TypeScript + Drizzle + PostgreSQL + Redis + PgBoss + WebSocket + pgvector + OpenAI)  
**Mandatory references:** `AGENTS.md`, `.planning/PRODUCTION_CHECKLIST.md`, `.planning/TESTING_CONTEXT.md`

---

## Cross-Phase Non-Negotiables

These apply to **every phase** without exception.

### Architecture rules
- Single modular monolith — no microservices, no Kafka, no RabbitMQ
- PostgreSQL is the durable source of truth
- PgBoss owns all durable asynchronous work
- Redis is cache + ephemeral realtime fanout only
- WebSocket is live browser delivery only
- AI/LLM is intent understanding + explanation only — never authoritative over product/price/stock/auth
- Backend enforces all validation, authorization, and business rules

### Code rules
- Inspect existing module before creating new files
- Reuse existing abstractions (one db client, one Redis client, one PgBoss abstraction)
- No business logic in routes or controllers
- No business logic in repositories
- No business logic directly in workers
- Transactions inside service/repository boundaries only
- No empty boilerplate files — create files only when they have real content

### API contract
- All env vars validated via Zod at `packages/env/src/server.ts`
- All request inputs validated via Zod
- Consistent `{ success, data }` / `{ success, error }` response shape
- Never trust client-supplied: `userId`, `sellerId`, `role`, `price`, `stock`, `total`, `status`, `ownership`
- Structured Pino logging — no secrets, passwords, tokens, or payment credentials in logs

### Tier 1 production-readiness (build-in always)
- Bounded queries + pagination on all list endpoints
- Foreign keys, indexes, and unique constraints on all new tables
- Transactions for all multi-table mutations
- Idempotent background jobs
- Outbox for guaranteed side effects
- Ownership enforced server-side on every mutation
- `{ success: false, error: { code, message } }` error shape with stable codes

---

## Phase 0 — Capture & Repository Baseline

### Purpose
Establish repository baseline and capture existing project/agent context before implementation begins.

### Requirements

**R0.1** Inspect and record the current repository structure.  
**R0.2** Read and acknowledge `AGENTS.md` as the architectural contract.  
**R0.3** Establish `.agent-logs/` directory and initial capture log.  
**R0.4** Verify (or scaffold) the baseline directory structure:
```
project/
├── apps/server/src/
├── packages/
├── infra/
├── tests/
├── docker-compose.yml
├── .env.example
├── AGENTS.md
└── .agent-logs/
```
**R0.5** Confirm no unnecessary abstractions have been introduced.  
**R0.6** Document the current project state, what exists, and what still needs to be built.

### Exit criteria
- Capture log exists in `.agent-logs/`
- Repository structure is understood and recorded
- No code changes made beyond baseline scaffolding
- `AGENTS.md` acknowledged

---

## Phase 1 — Foundation

### Purpose
Establish the backend platform: application structure, infrastructure wiring, operational endpoints, and startup/shutdown lifecycle.

### Requirements

**R1.1 Monorepo structure**
- `pnpm` monorepo with Turborepo
- `apps/server/` — API + worker processes
- `packages/database/` — Drizzle schema + migrations
- `packages/env/` — Zod-validated environment
- `packages/shared/` — shared types/utils

**R1.2 Environment configuration**
- All env vars validated via Zod in `packages/env/src/server.ts`
- Required: `DATABASE_URL`, `REDIS_URL`, `PG_BOSS_DATABASE_URL`, `APP_URL`, `CORS_ORIGINS`, `SESSION_SECRET`/`JWT_SECRET`, `COOKIE_SECRET`, `OPENAI_API_KEY`, `EMBEDDING_MODEL`, `PAYMENT_PROVIDER`, `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`, `LOG_LEVEL`
- No `process.env` usage in business modules — use `serverEnv.*`
- No unsafe defaults for required production secrets

**R1.3 Fastify application**
- `app/app.ts` — creates Fastify instance (no business logic)
- `app/plugins.ts` — registers: helmet, CORS, cookies, rate limiting, sensible, Swagger/OpenAPI, auth hooks
- `app/routes.ts` — registers all module routes
- `app/websocket.ts` — WebSocket setup (auth, client tracking, Redis sub, event forwarding)

**R1.4 Core infrastructure**
- Single Drizzle DB client at `core/db/db.ts` — only `getDb()`, never multiple `drizzle()` calls
- Single Redis client at `core/redis/redis.ts`
- Redis Pub/Sub abstraction at `core/redis/pubsub.ts`
- PgBoss at `core/queue/boss.ts` with `sendJob()` abstraction at `core/queue/jobs.ts`
- Outbox at `core/events/outbox.ts`
- Centralized errors at `core/errors/app-error.ts` and `core/errors/error-handler.ts`
- Pino logger at `core/logger/logger.ts` with secret redaction

**R1.5 Operational endpoints**
- `GET /health` — liveness (always 200 if process runs)
- `GET /ready` — readiness (checks DB + Redis)
- `GET /api/v1/meta` — API version/info
- `GET /docs` — Swagger/OpenAPI UI

**R1.6 Authentication primitives**
- User + session table stubs (full auth in Phase 3)
- Password hashing utility (bcrypt/argon2)
- Session/token infrastructure wired but not yet exposed as full auth routes
- `requireAuth` pre-handler hook available for use in later phases
- RBAC role enum: `CUSTOMER`, `SELLER`, `ADMIN`

**R1.7 Startup/shutdown lifecycle**
Startup order:
1. Validate environment
2. Initialize logger
3. Initialize database
4. Initialize Redis
5. Create Fastify app
6. Register plugins
7. Register routes
8. Register WebSocket handlers
9. Start HTTP server
10. Start PgBoss
11. Register workers
12. Start outbox publisher

Shutdown order:
1. Stop accepting new requests
2. Close/drain Fastify
3. Stop WebSocket acceptance
4. Stop PgBoss workers
5. Stop outbox publisher
6. Close Redis connections
7. Close DB connections
8. Exit

**R1.8 Worker process**
- Separate entry at `apps/server/src/workers/register-workers.ts`
- Same Docker image as API, different process
- Graceful PgBoss shutdown

**R1.9 Build tooling**
- `pnpm install` — clean install
- `pnpm typecheck` — no TypeScript errors
- `pnpm lint` — no lint errors
- `pnpm test` — tests pass
- `pnpm build` — production build succeeds

### Exit criteria
- API boots, DB connects, Redis connects, PgBoss starts/stops gracefully
- `/health` and `/ready` return correct responses
- Logs are structured, secrets are redacted
- TypeScript, lint, and build pass

---

## Phase 2 — Database, Core Domain & Seed Data

### Purpose
Create the authoritative PostgreSQL domain model and realistic marketplace seed data.

### Requirements

**R2.1 Schema domains**
Group tables into schema files by domain:
- `auth.schema.ts` — users, sessions, password_reset_tokens
- `users.schema.ts` — addresses
- `catalog.schema.ts` — categories, products, product_variants
- `commerce.schema.ts` — carts, cart_items, wishlists, wishlist_items, orders, order_items, payments, coupons, returns, return_items
- `fulfillment.schema.ts` — shipments, shipment_tracking
- `notifications.schema.ts` — notifications, conversations, messages, outbox_events

**R2.2 Schema rules**
- Foreign keys on all relationships
- Indexes on all FK columns and common filter/sort columns
- Unique constraints for business invariants (email, slug, SKU, idempotency keys)
- CHECK constraints where appropriate
- Money as `numeric(12,2)` — never `float`
- `created_at`/`updated_at` on all tables
- `deleted_at` for soft-delete where required
- JSONB only for genuinely flexible metadata (specifications, tracking events)
- pgvector `vector(1536)` column on products for embeddings
- Embedding model/version metadata retained on products

**R2.3 Key domain requirements**
- Products have seller ownership (`seller_id` FK)
- Order items preserve price snapshot at purchase time (`unit_price_snapshot`, `product_snapshot` JSONB)
- Orders have idempotency key (unique constraint)
- Outbox events: `id`, `type`, `aggregate_id`, `aggregate_type`, `payload` JSONB, `status` (pending/processing/completed/failed), `created_at`, `processed_at`
- Notifications: durable row per user, `read_at`, `type`, `payload`

**R2.4 Migrations**
- Use Drizzle Kit migrations
- `pnpm db:migrate` applies migrations to empty DB without errors
- `pnpm db:seed` creates realistic seed data
- Migrations must be re-runnable from scratch (idempotent)
- pgvector extension enabled in first migration: `CREATE EXTENSION IF NOT EXISTS vector`

**R2.5 Public catalog routes (read-only)**
```
GET /api/v1/categories
GET /api/v1/categories/:slug
GET /api/v1/products           (paginated, filterable by category/price/availability)
GET /api/v1/products/:productId
GET /api/v1/products/:productId/offers
GET /api/v1/products/:productId/variants
GET /api/v1/sellers/:sellerId
GET /api/v1/sellers/:sellerId/products
```

**R2.6 Seed data**
Minimum:
- 5+ categories with slugs
- 3–10 products per category, all with real descriptions
- 2+ sellers with distinct profiles
- Products with 2–3 variants/offers each
- Price ranges: budget / mid / premium
- Mixed stock states (in stock, low stock, out of stock)
- Products with ratings from reviews
- At least one gaming laptop with RTX (for AI demo)
- Demo customer account: `customer@demo.com`
- Demo seller account: `seller@demo.com`
- Demo admin account: `admin@demo.com`
- Delivered orders eligible for reviews
- Shipped/processing orders for tracking demos
- One delivered returnable order

### Exit criteria
- Migrations work from clean DB
- Constraints enforced (FK, unique, check)
- Indexes exist on filter/FK columns
- Seed data is realistic and complete
- pgvector extension works, embeddings can be stored
- Catalog endpoints return correct paginated data

---

## Phase 3 — Authentication & Users

### Purpose
Implement the complete customer identity boundary.

### Requirements

**R3.1 Registration & login**
```
POST /api/v1/auth/register     — email, password, name
POST /api/v1/auth/login        — email, password → session token
POST /api/v1/auth/logout       — revoke current session
POST /api/v1/auth/logout-all   — revoke all sessions for user
POST /api/v1/auth/refresh      — rotate refresh token
GET  /api/v1/auth/me           — returns authenticated user
```

**R3.2 Password management**
```
POST /api/v1/auth/password/forgot  — send reset email (via PgBoss job)
POST /api/v1/auth/password/reset   — apply new password, invalidate reset token
```

**R3.3 User profile**
```
GET  /api/v1/users/me         — full profile
PATCH /api/v1/users/me        — update name, avatar URL
```

**R3.4 Addresses**
```
GET    /api/v1/users/me/addresses
POST   /api/v1/users/me/addresses
PATCH  /api/v1/users/me/addresses/:id
DELETE /api/v1/users/me/addresses/:id
POST   /api/v1/users/me/addresses/:id/default
```

**R3.5 Session management**
```
GET    /api/v1/users/me/sessions        — list active sessions
DELETE /api/v1/users/me/sessions/:id    — revoke specific session
```

**R3.6 Security invariants**
- Password hashed with bcrypt/argon2 — never stored in plaintext
- Password hash never returned in API responses
- Session/token hashes never returned
- Identity derived from authenticated session — never from request body
- Never trust client-supplied `userId`, `role`, `sellerId`
- Session expiry enforced
- Session revocation effective immediately
- RBAC: `CUSTOMER`, `SELLER`, `ADMIN` roles
- `requireAuth` hook enforces session validity
- `requireRole(role)` hook enforces RBAC

**R3.7 Rate limiting**
- Auth routes have stricter rate limits than general API
- Failed login attempts tracked per IP/email

### Exit criteria
- Registration, login, logout, refresh all work
- Expired/revoked sessions rejected
- Password never appears in logs or responses
- Ownership isolation between users verified
- Role boundaries enforced
- Auth rate limiting active

---

## Phase 4 — Catalog, Shopping, Cart & Checkout

### Purpose
Implement the **golden customer purchase path** — the single most critical phase.

### Requirements

**R4.1 Cart**
```
GET    /api/v1/cart
POST   /api/v1/cart/items           — add item (productId, variantId, quantity)
PATCH  /api/v1/cart/items/:itemId   — update quantity
DELETE /api/v1/cart/items/:itemId   — remove item
DELETE /api/v1/cart                 — clear cart
```

**R4.2 Wishlist**
```
GET    /api/v1/wishlist
POST   /api/v1/wishlist/items
DELETE /api/v1/wishlist/items/:productId
```

**R4.3 Checkout quote**
```
POST /api/v1/checkout/quote   — returns authoritative totals (prices from DB, not client)
```
Server calculates: item prices, discounts, shipping, taxes, total. Client totals are display-only.

**R4.4 Order creation**
```
POST /api/v1/orders           — create order from cart (requires Idempotency-Key header)
GET  /api/v1/orders           — list customer orders (paginated, cursor)
GET  /api/v1/orders/:orderId  — order detail with items
```

**R4.5 Checkout invariants (all server-enforced)**
- Price read from PostgreSQL — client price ignored
- Discounts/coupons validated server-side
- Shipping calculated server-side
- Total calculated server-side
- Inventory validated immediately before order creation (with `SELECT ... FOR UPDATE`)
- Idempotency key prevents duplicate order creation
- Order + order items + inventory decrement + outbox event in single transaction
- Cart items cleared after successful order creation
- Order item price snapshot preserved at time of purchase

**R4.6 COD/test payment support**
- Payment provider hidden behind adapter interface
- COD (Cash on Delivery) always available
- Sandbox/test payment mode for demo
- Order transitions to `CONFIRMED` on COD; `PAYMENT_PENDING` for card

**R4.7 Business rules to enforce**
- Cart belongs to authenticated customer — no cross-customer access
- Only active, published, in-stock products can be added to cart
- Quantity must be positive integer ≤ max per order limit
- Duplicate cart items merge quantities
- Inactive/unavailable product in cart blocks checkout
- Insufficient inventory blocks checkout
- Failed checkout leaves no partial state (transaction rollback)

### Exit criteria
- **Golden purchase works end-to-end**: browse → cart → checkout → order created
- Price manipulation from client has no effect
- Concurrent checkout with last unit: only one succeeds
- Duplicate order creation with same idempotency key: only one order
- Failed checkout leaves zero partial state

---

## Phase 5 — Seller Marketplace

### Purpose
Turn the project from a seeded storefront into an actual marketplace where sellers operate their own catalog.

### Requirements

**R5.1 Seller application**
```
POST /api/v1/sellers/apply   — customer applies to become seller
```
Creates seller record with `PENDING_APPROVAL` status. Triggers PgBoss job for admin notification.

**R5.2 Seller profile**
```
GET   /api/v1/seller/me      — seller's own profile
PATCH /api/v1/seller/me      — update business name, description, logo
```

**R5.3 Seller products**
```
GET   /api/v1/seller/products         — list own products (paginated)
POST  /api/v1/seller/products         — create product (draft)
GET   /api/v1/seller/products/:id     — product detail
PATCH /api/v1/seller/products/:id     — update product

POST  /api/v1/seller/products/:id/publish    — publish product
POST  /api/v1/seller/products/:id/unpublish  — unpublish product
```

**R5.4 Variants & inventory**
```
POST  /api/v1/seller/products/:id/variants       — add variant
PATCH /api/v1/seller/variants/:variantId          — update price, stock, SKU
```

**R5.5 Seller orders**
```
GET  /api/v1/seller/orders          — orders containing seller's items (paginated)
GET  /api/v1/seller/orders/:id      — order detail (own items only)
POST /api/v1/seller/orders/:id/ship — mark items as shipped
```

**R5.6 Seller returns & reviews**
```
GET  /api/v1/seller/returns               — return requests for seller's products
POST /api/v1/seller/returns/:id/approve   — approve return
GET  /api/v1/seller/reviews               — reviews on seller's products
```

**R5.7 Ownership invariants (all enforced server-side)**
- Seller identity derived from authenticated session — never from request body
- Seller A cannot read/modify Seller B's products
- Seller A cannot modify Seller B's variants or inventory
- Seller A cannot publish/unpublish Seller B's products
- Seller A cannot access Seller B's orders, returns, or reviews
- Seller route preHandler: `requireAuth` + `requireRole('SELLER')` + ownership check

### Exit criteria
- Seller CRUD fully works with ownership isolation
- Seller A / Seller B cross-ownership negative tests pass
- Seller can publish product that appears in public catalog
- Seller can view only own orders

---

## Phase 6 — Payments, Fulfillment, Orders & Returns

### Purpose
Complete the financial and post-purchase lifecycle.

### Requirements

**R6.1 Payments**
```
POST /api/v1/payments/intents              — create payment intent
GET  /api/v1/payments/:paymentId           — payment status
POST /api/v1/payments/webhooks/:provider   — provider webhook (idempotent)
POST /api/v1/orders/:orderId/payments/retry — retry failed payment
```

**R6.2 Fulfillment**
```
GET /api/v1/orders/:orderId/shipments     — customer shipment list
GET /api/v1/shipments/:shipmentId         — shipment detail
GET /api/v1/shipments/:shipmentId/tracking — tracking events
```

**R6.3 Order actions**
```
POST /api/v1/orders/:orderId/cancel   — cancel eligible order
```

**R6.4 Returns**
```
POST /api/v1/orders/:orderId/returns   — create return request (eligible orders only)
GET  /api/v1/returns                   — customer return list
GET  /api/v1/returns/:returnId         — return detail
POST /api/v1/returns/:returnId/cancel  — cancel pending return
```

**R6.5 Payment invariants**
- Server derives authoritative order amount — client total ignored
- Webhook processing idempotent (duplicate webhooks have no effect)
- Payment state transitions: `PENDING → SUCCEEDED/FAILED`
- Failed payment: order stays in `PAYMENT_FAILED`, retry is possible
- No raw card data stored
- COD / test payment clearly separated from real provider
- Refund cannot exceed refundable amount

**R6.6 Order state machine enforcement**
Valid transitions only:
```
CART → CHECKOUT → PAYMENT_PENDING → PAYMENT_SUCCEEDED → CONFIRMED → PROCESSING → SHIPPED → DELIVERED → COMPLETED
PAYMENT_PENDING → PAYMENT_FAILED (→ retry → PAYMENT_PENDING)
CONFIRMED → CANCELLED
DELIVERED → RETURN_REQUESTED → RETURN_APPROVED → RETURN_IN_TRANSIT → RETURN_RECEIVED → REFUND_PENDING → REFUNDED
DELIVERED → RETURN_REQUESTED → RETURN_REJECTED
```
Every transition checked inside DB transaction.

**R6.7 Cancellation rules**
- Only `CONFIRMED` orders can be cancelled (not yet processing/shipped)
- Cancellation restores inventory in same transaction
- Creates outbox event → notification

**R6.8 Return lifecycle**
- Only `DELIVERED` orders eligible for return
- Return window enforced (e.g. 30 days from delivery)
- Item-level returns where practical
- Refund amount computed server-side

### Exit criteria
- Payment webhook idempotency verified (duplicate callbacks → single effect)
- Order state machine rejects invalid transitions
- Cancellation restores inventory atomically
- Return lifecycle flows correctly

---

## Phase 7 — Reviews, Notifications & Realtime

### Purpose
Implement trust layer, durable notifications, and realtime browser delivery.

### Requirements

**R7.1 Reviews**
```
GET    /api/v1/products/:productId/reviews   (public, paginated)
POST   /api/v1/products/:productId/reviews   (authenticated, verified purchase)
PATCH  /api/v1/reviews/:reviewId             (own review only)
DELETE /api/v1/reviews/:reviewId             (own review only)
POST   /api/v1/reviews/:reviewId/report      (flag for moderation)
```

**R7.2 Review business rules**
- Reviewer must have a `DELIVERED` or `COMPLETED` order containing the product
- One review per customer per product
- Rating: 1–5 integer
- Review can be edited within a window
- Deleted review triggers product rating recalculation (async job)

**R7.3 Notifications**
```
GET  /api/v1/notifications               — paginated notification list
GET  /api/v1/notifications/unread-count  — unread count
POST /api/v1/notifications/:id/read      — mark one as read
POST /api/v1/notifications/read-all      — mark all as read
```

**R7.4 Notification architecture (durable)**
```
Business transaction
       ↓
PostgreSQL + Outbox
       ↓
PgBoss (notifications.dispatch job)
       ↓
Worker
       ↓
Notification row in PostgreSQL
       ↓
Redis Pub/Sub → WebSocket → Browser
```
Redis is NOT the source of truth. If WebSocket delivery fails, notification persists in DB.

**R7.5 WebSocket**
```
GET /api/v1/ws   — authenticated WebSocket upgrade
```
- Every connection must be authenticated (session/token verification on upgrade)
- Connection registry: `Map<UserId, Set<WebSocket>>` per API instance
- User subscribes only to their own channel (`user:{userId}:events`)
- Subscriptions authorized server-side — client cannot specify other user IDs
- Redis Pub/Sub for cross-instance fanout
- Cross-user event leakage is a security defect

**R7.6 Realtime event envelope**
```ts
type RealtimeEvent<T = unknown> = {
  type: string;      // e.g. "ORDER_STATUS_UPDATED"
  version: number;
  id: string;        // UUID
  timestamp: string; // ISO-8601
  data: T;
};
```

**R7.7 Triggered notifications**
Events that must create durable notification + realtime push:
- Order confirmed / payment succeeded
- Order status change (processing, shipped, delivered)
- Return approved/rejected
- Refund processed
- Review received (seller)
- Seller approved/rejected (admin action)
- New message in conversation

### Exit criteria
- Review creation enforces verified purchase rule
- Notifications persist even when user is offline
- WebSocket delivers event to correct user only (no cross-user leakage)
- Reconnect: missed notifications retrieved from DB via HTTP

---

## Phase 8 — Search & AI Shopping Assistant

### Purpose
Provide natural-language product discovery strictly grounded in the real catalog.

### Requirements

**R8.1 Search routes**
```
GET  /api/v1/search/products?q=...       — keyword search (paginated)
GET  /api/v1/search/suggestions?q=...   — autocomplete suggestions
POST /api/v1/search/semantic             — vector similarity search
POST /api/v1/search/filters/parse        — parse natural language into structured filters

GET /api/v1/products/featured            — featured/promoted products
GET /api/v1/products/recommendations     — personalized recommendations
```

**R8.2 AI routes**
```
POST   /api/v1/ai/conversations                    — start conversation
GET    /api/v1/ai/conversations                    — list conversations
GET    /api/v1/ai/conversations/:id                — conversation with messages
POST   /api/v1/ai/conversations/:id/messages       — send message, get response
DELETE /api/v1/ai/conversations/:id                — delete conversation
POST   /api/v1/ai/search                           — one-shot AI product search
```

**R8.3 AI pipeline (invariants)**
```
User query
    ↓
AI: intent/constraint extraction
    ↓
Backend: validate extracted filters (Zod)
    ↓
SQL: hard filters enforced in PostgreSQL
    ↓
Optional: pgvector cosine similarity
    ↓
Business filters: visibility, availability, ownership
    ↓
Ranking: relevance + popularity
    ↓
AI: explanation using ONLY retrieved products
    ↓
Message persisted to DB
```

**The AI/LLM cannot decide:**
- Whether a product exists
- Whether stock exists
- What price is valid
- Whether a user is authorized
- Whether a seller is eligible
- What order state is

**R8.4 Embedding generation**
- Product embeddings generated asynchronously via PgBoss job (`catalog.generate-embedding`)
- Embedding text: `{title} {description} {specifications} {category} {brand}`
- Model + version metadata stored with embedding (for regeneration)
- Missing embedding falls back to keyword search (no hard failure)
- Embedding job is idempotent (safe to re-run)

**R8.5 Search filters enforced by backend**
- Price range: `WHERE price BETWEEN ? AND ?`
- Category: `WHERE category_id = ?`
- Availability: `WHERE stock > 0`
- Seller: `WHERE seller_id = ?`
- Published only: `WHERE status = 'PUBLISHED'`
- AI cannot bypass these constraints

**R8.6 Demo capability**
`"gaming laptops under 200k with RTX"` must return real catalog products with correct price/stock constraints, not hallucinated results.

**R8.7 AI safety**
- AI input length bounded (max tokens/chars)
- AI output bounded
- AI failure degrades gracefully (falls back to keyword search)
- Provider failure does not expose error internals to client
- Conversation ownership enforced — user can only read own conversations

### Exit criteria
- Keyword search returns paginated, filtered real products
- AI search returns real catalog products (not hallucinated)
- Hard SQL filters enforced even when LLM extracts filters
- Embedding generation is asynchronous and idempotent
- AI provider failure degrades gracefully

---

## Phase 9 — Admin, Moderation & Operations

### Purpose
Provide platform-level operational control for admins.

### Requirements

**R9.1 Admin routes**
```
GET   /api/v1/admin/dashboard

GET   /api/v1/admin/users
GET   /api/v1/admin/users/:id
PATCH /api/v1/admin/users/:id/status   — activate/suspend/ban

GET  /api/v1/admin/sellers
POST /api/v1/admin/sellers/:id/approve
POST /api/v1/admin/sellers/:id/reject

GET  /api/v1/admin/products
POST /api/v1/admin/products/:id/approve
POST /api/v1/admin/products/:id/reject

GET /api/v1/admin/orders
GET /api/v1/admin/returns

GET  /api/v1/admin/reviews
POST /api/v1/admin/reviews/:id/hide
```

**R9.2 Admin invariants**
- All admin routes protected by `requireAuth` + `requireRole('ADMIN')`
- Admin mutations call domain services — do NOT directly mutate DB tables
- All admin state transitions use explicit action endpoints (not generic PATCH)
- Admin actions are auditable (logged with admin user ID)
- Dashboard metrics from DB aggregates (not Redis)
- Seller approval triggers: seller status update + notification + PgBoss job

**R9.3 Admin does NOT do**
- Complex analytics dashboards
- Report generation
- Bulk operations (out of scope for initial build)

### Exit criteria
- Admin routes protected (customer/seller access → 403)
- Seller approval/rejection flow triggers notifications
- Product moderation changes visibility in catalog
- All admin actions logged with actor ID

---

## Phase 10 — Production Hardening, Testing, Observability & Security

### Purpose
Full-system verification and hardening. NOT the first time security is considered — Tier 1 was applied in every prior phase. This phase performs Tier 3 (pre-production) verification.

### Requirements

**R10.1 Test coverage completeness**
Unit tests (`tests/unit/`):
- Price/discount/tax calculations
- Order state machine predicates
- Pagination utilities
- Search query parsing
- AI intent parsing
- Ranking logic
- Embedding text construction

Integration tests (`tests/integration/`):
- Complete auth lifecycle (register, login, refresh, logout, revoke)
- Customer ownership isolation (cart, orders, addresses, notifications)
- Seller ownership isolation (products, variants, inventory, orders)
- Golden purchase path (browse → cart → checkout → order)
- Concurrent checkout with last inventory unit
- Duplicate order idempotency
- Payment webhook idempotency
- Order state machine (valid + invalid transitions)
- Outbox event creation with business transaction
- PgBoss job retry behavior
- Notification persistence + WebSocket delivery
- Redis failure fallback (non-critical operations)
- Admin RBAC boundaries
- AI search returning only real products
- Rate limiting on auth routes
- Sensitive data not in responses or logs

**R10.2 Security audit**
- No IDOR vulnerabilities
- No cross-user data leakage
- No cross-seller data leakage
- No price manipulation from client
- No inventory manipulation from client
- No privilege escalation
- Stack traces not exposed in error responses
- Secrets not in logs
- Payment credentials not stored raw

**R10.3 Performance review**
- `EXPLAIN ANALYZE` on hot query paths
- No accidental N+1 queries
- All list endpoints paginated and bounded
- Indexes verified on filter/FK columns
- Connection pool sizing reviewed

**R10.4 Observability**
- Request IDs on all requests (Fastify `requestId`)
- Structured logs include: `requestId`, `userId` (when authenticated), relevant resource IDs
- Error logs include stack traces (server-side only, not in API response)
- Background job failures observable in logs
- Health/readiness endpoints verified

**R10.5 Configuration review**
- CORS origins locked down for production
- Rate limits finalized
- Cookie security flags: `httpOnly`, `secure`, `sameSite`
- All secrets in env vars (none hardcoded)
- `.env` not committed (verify `.gitignore`)

### Exit criteria
- Full test suite passes (unit + integration)
- TypeScript, lint, build all pass
- No critical security issues
- No N+1 or unbounded queries in hot paths
- EXPLAIN ANALYZE shows index usage on hot queries
- Health/readiness endpoints work

---

## Phase 11 — Deployment & Launch

### Purpose
Deploy to production and perform final smoke testing against the public URL.

### Requirements

**R11.1 Production deployment**
Minimum infrastructure:
```
1 × Fastify API process
1 × PgBoss Worker process
1 × Neon PostgreSQL database
1 × Redis instance
```
Optional:
- Load balancer for multiple API instances
- Separate Docker containers for API and worker

**R11.2 Production configuration**
- `DATABASE_URL` → Neon production DB
- `REDIS_URL` → production Redis
- `PG_BOSS_DATABASE_URL` → same or separate Neon DB
- `CORS_ORIGINS` → exact production domain (no `*`)
- `SESSION_SECRET` / `JWT_SECRET` → strong random production secrets
- `OPENAI_API_KEY` → valid key (or mock if not available)
- `LOG_LEVEL` → `info` or `warn` in production

**R11.3 Launch checklist**
```
[ ] pnpm db:migrate applied against production DB
[ ] pnpm db:seed applied — demo catalog and accounts exist
[ ] Demo accounts: customer@demo.com / seller@demo.com / admin@demo.com
[ ] API process running and accessible via public URL
[ ] Worker process running and processing PgBoss jobs
[ ] GET /health returns 200
[ ] GET /ready returns 200
[ ] WebSocket connects and delivers events
[ ] Checkout with COD works end-to-end
[ ] AI search returns real products (not hallucinations)
[ ] AI gracefully degrades if OpenAI key unavailable
[ ] CORS configured correctly for production domain
[ ] Rate limits active
[ ] No secrets in git history
[ ] .agent-logs/ committed and up to date
[ ] Repository is public
```

**R11.4 Production smoke test**
Performed from a browser in incognito mode (not logged in as developer):

1. Open public URL — marketplace loads
2. Browse categories — products visible
3. Search "gaming laptop" — relevant results appear
4. Click product — detail page loads with variants/offers
5. Register new account — confirmation works
6. Add to cart — cart updates correctly
7. Checkout (COD) — order created, confirmation shown
8. View order — status correct
9. WebSocket notification arrives — realtime works
10. Login as seller demo — seller dashboard accessible
11. Login as admin demo — admin dashboard accessible

**R11.5 What NOT to do at launch**
- Do not introduce new dependencies at deployment
- Do not run migration + seed in a way that destroys existing data
- Do not expose internal error details in production error responses

### Exit criteria
- Public URL opens in incognito browser
- Stranger can complete full purchase journey
- Seller can log in and manage products
- Admin can log in and perform moderation
- All smoke test steps pass
- `.agent-logs/` committed with final session log

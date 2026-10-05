# Amazon-Style Marketplace — Roadmap

**Architecture:** Modular monolith  
**Stack:** Fastify · TypeScript · Drizzle · PostgreSQL/Neon · Redis · PgBoss · WebSocket · pgvector · OpenAI · Pino  
**Mandatory reads before any phase:** `AGENTS.md` · `.planning/PRODUCTION_CHECKLIST.md` · `.planning/TESTING_CONTEXT.md`

---

## Phase Sequence

```
Phase 0  — Capture & Repository Baseline
Phase 1  — Foundation
Phase 2  — Database, Core Domain & Seed Data
Phase 3  — Authentication & Users
Phase 4  — Catalog, Shopping, Cart & Checkout        ← golden path
Phase 5  — Seller Marketplace
Phase 6  — Payments, Fulfillment, Orders & Returns
Phase 7  — Reviews, Notifications & Realtime
Phase 8  — Search & AI Shopping Assistant
Phase 9  — Admin, Moderation & Operations
Phase 10 — Production Hardening, Testing & Security
Phase 11 — Deployment & Launch
```

**Priority rule:** If time slips, protect **Phase 4 (golden purchase path) → Phase 5 (seller ops) → Phase 11 (public deployment)** before anything else.

---

## Production Readiness Model

Every phase carries its own readiness obligations. Do not defer correctness to Phase 10.

| Tier | When | What |
|------|------|------|
| **Tier 1 — Build-in** | During every implementation chunk | Validation, auth, ownership, transactions, idempotency, pagination, safe logging |
| **Tier 2 — Phase Gate** | After each phase completes | Route inventory, EXPLAIN ANALYZE, concurrency tests, auth/ownership negative tests |
| **Tier 3 — Pre-production** | Once before launch (Phase 10–11) | Load testing, security review, multi-instance verification |

A phase is **COMPLETE** only when: implementation done + Tier 1 satisfied + Tier 2 gate passed + tests pass + build passes + migrations pass + no critical blockers.

---

## Phase 0 — Capture & Repository Baseline

**Status:** `pending`  
**Depends on:** nothing  
**Blocks:** Phase 1

### Goal
Establish repository baseline and agent context before implementation begins. No feature code in this phase.

### Deliverables
- `.agent-logs/` directory with initial capture entry
- Documented current repository state
- Confirmed `AGENTS.md` read and acknowledged
- Baseline directory scaffold if missing:
  ```
  apps/server/src/
  packages/
  infra/
  tests/unit/
  tests/integration/
  docker-compose.yml
  .env.example
  ```

### Exit criteria
- `.agent-logs/` exists with session log
- Repository structure documented
- No unnecessary abstractions introduced
- `AGENTS.md` acknowledged

---

## Phase 1 — Foundation

**Status:** `pending`  
**Depends on:** Phase 0  
**Blocks:** Phase 2

### Goal
Backend platform: monorepo structure, infrastructure wiring, operational endpoints, startup/shutdown lifecycle.

### Deliverables

**Monorepo**
- `pnpm` workspace + Turborepo
- `apps/server/` with `src/main.ts` (API) and `src/workers/register-workers.ts` (Worker)
- `packages/database/` — Drizzle schema + migrations
- `packages/env/` — Zod-validated env (`serverEnv`)
- `packages/shared/` — shared types/constants

**App layer**
- `app/app.ts` — Fastify factory (no business logic)
- `app/plugins.ts` — helmet, CORS, cookies, rate-limit, sensible, Swagger, auth hooks
- `app/routes.ts` — module route registration
- `app/websocket.ts` — WS auth, client registry, Redis sub, event forwarding

**Core layer**
- `core/db/db.ts` — single `getDb()` Drizzle client
- `core/redis/redis.ts` — single Redis client
- `core/redis/pubsub.ts` — Pub/Sub abstraction
- `core/queue/boss.ts` — PgBoss instance
- `core/queue/jobs.ts` — `sendJob()` abstraction
- `core/events/outbox.ts` — outbox publisher
- `core/errors/app-error.ts` + `error-handler.ts`
- `core/logger/logger.ts` — Pino with secret redaction
- `config/env.ts` (re-exports `serverEnv`)

**Operational routes**
- `GET /health`
- `GET /ready`
- `GET /api/v1/meta`
- `GET /docs`

**Auth primitives**
- User + session table stubs
- Password hashing utility
- `requireAuth` pre-handler hook
- `requireRole(role)` pre-handler hook
- RBAC enum: `CUSTOMER | SELLER | ADMIN`

**Startup / shutdown** per spec order (validate env → logger → db → redis → fastify → plugins → routes → ws → http → pgboss → workers → outbox)

### Exit criteria
- API and worker both boot without errors
- `/health` → 200, `/ready` → 200 (checks DB + Redis)
- PgBoss starts and stops gracefully
- Logs structured, secrets redacted
- `pnpm typecheck` passes
- `pnpm lint` passes
- `pnpm build` succeeds

---

## Phase 2 — Database, Core Domain & Seed Data

**Status:** `pending`  
**Depends on:** Phase 1  
**Blocks:** Phase 3

### Goal
Authoritative PostgreSQL domain model, migrations, pgvector, and realistic seed data.

### Deliverables

**Schema files** (`packages/database/src/schema/`)
- `auth.schema.ts` — users, sessions, password_reset_tokens
- `users.schema.ts` — addresses
- `catalog.schema.ts` — categories, products, product_variants (incl. `embedding vector(1536)`)
- `commerce.schema.ts` — carts, cart_items, wishlists, wishlist_items, orders, order_items, payments, coupons, returns, return_items
- `fulfillment.schema.ts` — shipments, shipment_tracking
- `notifications.schema.ts` — notifications, conversations, messages, outbox_events

**Schema rules**
- Money: `numeric(12,2)` — never float
- All FK columns indexed
- Unique constraints for: email, slug, SKU, idempotency keys, one-review-per-product
- Order item price snapshot: `unit_price_snapshot numeric(12,2)`, `product_snapshot jsonb`
- Outbox events: id, type, aggregate_id, aggregate_type, payload JSONB, status, created_at, processed_at
- pgvector extension enabled in first migration

**Migrations**
- `pnpm db:migrate` — applies to clean DB without errors
- `pnpm db:seed` — creates full realistic seed dataset

**Seed data**
- 5+ categories (Electronics, Gaming, Books, Home, Fashion, Sports)
- 3–10 products per category with real descriptions
- 2+ sellers (distinct profiles, each with multiple products)
- Products: 2–3 variants/offers per product, mixed price ranges
- Mixed stock states
- At least one gaming laptop with RTX (AI demo requirement)
- Demo accounts: `customer@demo.com`, `seller@demo.com`, `admin@demo.com`
- Pre-existing orders in various states for demo/testing

**Public catalog module** (`modules/catalog/`)
- `catalog.routes.ts`, `catalog.controller.ts`, `catalog.service.ts`, `catalog.repository.ts`
```
GET /api/v1/categories
GET /api/v1/categories/:slug
GET /api/v1/products             (paginated, filter: category/price/availability/search)
GET /api/v1/products/:productId
GET /api/v1/products/:productId/offers
GET /api/v1/products/:productId/variants
GET /api/v1/sellers/:sellerId
GET /api/v1/sellers/:sellerId/products
```

### Exit criteria
- `pnpm db:migrate` works from empty DB
- `pnpm db:seed` creates realistic data
- pgvector extension installed; product embedding column accepts vectors
- Catalog endpoints return paginated, correctly shaped data
- `EXPLAIN ANALYZE` shows index usage on product list query

---

## Phase 3 — Authentication & Users

**Status:** `pending`  
**Depends on:** Phase 2  
**Blocks:** Phase 4

### Goal
Complete customer identity boundary: registration, login, sessions, addresses, RBAC.

### Deliverables

**Auth module** (`modules/auth/`)
```
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/logout-all
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
POST /api/v1/auth/password/forgot
POST /api/v1/auth/password/reset
```

**Users module** (`modules/users/`)
```
GET   /api/v1/users/me
PATCH /api/v1/users/me
GET   /api/v1/users/me/addresses
POST  /api/v1/users/me/addresses
PATCH /api/v1/users/me/addresses/:id
DELETE /api/v1/users/me/addresses/:id
POST  /api/v1/users/me/addresses/:id/default
GET   /api/v1/users/me/sessions
DELETE /api/v1/users/me/sessions/:id
```

**Security invariants**
- Password hashed (bcrypt/argon2) — never plaintext, never returned
- Session/token hashes never returned
- Identity from session only — never from request body
- Session expiry + revocation enforced immediately
- Auth routes: stricter rate limits
- `requireAuth` wired to all protected routes

### Tier 2 gate tests
- Unauthenticated → 401
- Expired session → 401
- Revoked session → 401
- Customer A cannot read Customer B's addresses/sessions
- Password not in any response or log

### Exit criteria
- Full auth lifecycle works (register → login → refresh → logout)
- Ownership isolation verified between users
- Role boundaries enforced
- Rate limiting on auth routes active

---

## Phase 4 — Catalog, Shopping, Cart & Checkout

**Status:** `pending`  
**Depends on:** Phase 3  
**Blocks:** Phase 5  
**Priority:** HIGHEST — project judged by this path working

### Goal
The golden customer purchase path. End-to-end: browse → cart → checkout → order placed.

### Deliverables

**Cart module** (`modules/cart/`)
```
GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/:itemId
DELETE /api/v1/cart/items/:itemId
DELETE /api/v1/cart
```

**Wishlist module** (`modules/wishlist/`)
```
GET    /api/v1/wishlist
POST   /api/v1/wishlist/items
DELETE /api/v1/wishlist/items/:productId
```

**Checkout + Orders module** (`modules/orders/`)
```
POST /api/v1/checkout/quote     — authoritative price calculation
POST /api/v1/orders             — create order (Idempotency-Key required)
GET  /api/v1/orders             — customer order list (cursor paginated)
GET  /api/v1/orders/:orderId    — order detail
```

**Checkout transaction**
```
SELECT variants FOR UPDATE     — lock inventory
recalculate all prices         — from DB, not client
validate inventory             — throw if insufficient
BEGIN
  INSERT orders
  INSERT order_items           — with price snapshots
  UPDATE inventory             — decrement stock
  INSERT outbox_events         — ORDER_CREATED
COMMIT
clear cart items
```

**COD/test payment flow**
- COD: order → `CONFIRMED` immediately
- Test card: order → `PAYMENT_PENDING` → payment intent → `CONFIRMED`
- Payment provider behind adapter interface

### Critical concurrency tests
- Two customers buy last unit simultaneously → only one succeeds, stock = 0
- Same idempotency key twice → only one order created
- Failed transaction → zero partial state

### Exit criteria
- **Golden purchase works end-to-end**
- Price manipulation from client has no effect (server recalculates)
- Concurrent last-unit checkout: exactly one succeeds
- Duplicate idempotency key: exactly one order
- Transaction rollback: no partial state on failure

---

## Phase 5 — Seller Marketplace

**Status:** `pending`  
**Depends on:** Phase 4  
**Blocks:** Phase 6

### Goal
Real marketplace: sellers create and manage their own products, view their orders, fulfill shipments.

### Deliverables

**Sellers module** (`modules/sellers/`)
```
POST  /api/v1/sellers/apply

GET   /api/v1/seller/me
PATCH /api/v1/seller/me

GET   /api/v1/seller/products
POST  /api/v1/seller/products
GET   /api/v1/seller/products/:id
PATCH /api/v1/seller/products/:id
POST  /api/v1/seller/products/:id/publish
POST  /api/v1/seller/products/:id/unpublish

POST  /api/v1/seller/products/:id/variants
PATCH /api/v1/seller/variants/:variantId

GET   /api/v1/seller/orders
GET   /api/v1/seller/orders/:id
POST  /api/v1/seller/orders/:id/ship

GET   /api/v1/seller/returns
POST  /api/v1/seller/returns/:id/approve

GET   /api/v1/seller/reviews
```

**Ownership enforcement (all server-side)**
- `requireAuth` + `requireRole('SELLER')` on all seller routes
- Seller ID derived from session — never trusted from body
- Every product/variant mutation checks `WHERE seller_id = authenticatedSellerId`
- Seller order access scoped to orders containing their items only

### Tier 2 gate tests
- Seller A cannot read/modify Seller B's products
- Seller A cannot access Seller B's orders
- Customer cannot access seller routes

### Exit criteria
- Seller CRUD works with full ownership isolation
- Seller publishes product → appears in public catalog
- Seller views only own orders
- Cross-seller negative tests pass

---

## Phase 6 — Payments, Fulfillment, Orders & Returns

**Status:** `pending`  
**Depends on:** Phase 5  
**Blocks:** Phase 7

### Goal
Complete financial and post-purchase lifecycle: payments, shipments, cancellations, returns, refunds.

### Deliverables

**Payments module** (`modules/payments/`)
```
POST /api/v1/payments/intents
GET  /api/v1/payments/:paymentId
POST /api/v1/payments/webhooks/:provider    — idempotent
POST /api/v1/orders/:orderId/payments/retry
```

**Fulfillment module** (`modules/fulfillment/`)
```
GET /api/v1/orders/:orderId/shipments
GET /api/v1/shipments/:shipmentId
GET /api/v1/shipments/:shipmentId/tracking
```

**Order actions** (extended orders module)
```
POST /api/v1/orders/:orderId/cancel
POST /api/v1/orders/:orderId/returns
GET  /api/v1/returns
GET  /api/v1/returns/:returnId
POST /api/v1/returns/:returnId/cancel
```

**Order state machine** (enforced in service, checked inside transaction)
```
Valid forward: CART→CHECKOUT→PAYMENT_PENDING→PAYMENT_SUCCEEDED→CONFIRMED→PROCESSING→SHIPPED→DELIVERED→COMPLETED
Payment fail: PAYMENT_PENDING→PAYMENT_FAILED
Cancellation: CONFIRMED→CANCELLED
Return path: DELIVERED→RETURN_REQUESTED→RETURN_APPROVED→RETURN_IN_TRANSIT→RETURN_RECEIVED→REFUND_PENDING→REFUNDED
             DELIVERED→RETURN_REQUESTED→RETURN_REJECTED
```

**Payment invariants**
- Server derives authoritative amount — client total ignored
- Webhook idempotent: same webhook payload twice → single effect
- No raw card data stored
- COD / test payment clearly separated from real provider

**Cancellation invariants**
- Only `CONFIRMED` orders cancellable
- Inventory restored in same cancellation transaction
- Outbox event created → notification triggered

### Tier 2 gate tests
- Duplicate webhook → single payment effect
- Invalid state transition → 409/422
- Cancellation restores inventory atomically
- Return only on DELIVERED orders within window

### Exit criteria
- Payment webhook idempotency verified
- Order state machine rejects all invalid transitions
- Cancellation atomically restores inventory
- Return lifecycle flows: request → approve → refund

---

## Phase 7 — Reviews, Notifications & Realtime

**Status:** `pending`  
**Depends on:** Phase 6  
**Blocks:** Phase 8

### Goal
Trust layer (reviews), durable notifications, and realtime WebSocket delivery.

### Deliverables

**Reviews module** (`modules/reviews/`)
```
GET    /api/v1/products/:productId/reviews
POST   /api/v1/products/:productId/reviews   — verified purchase required
PATCH  /api/v1/reviews/:reviewId
DELETE /api/v1/reviews/:reviewId
POST   /api/v1/reviews/:reviewId/report
```

**Notifications module** (`modules/notifications/`)
```
GET  /api/v1/notifications
GET  /api/v1/notifications/unread-count
POST /api/v1/notifications/:id/read
POST /api/v1/notifications/read-all
```

**WebSocket** (`app/websocket.ts`)
```
GET /api/v1/ws    — authenticated upgrade
```
- Auth on upgrade (session check)
- In-memory registry: `Map<UserId, Set<WebSocket>>`
- Subscribe to `user:{userId}:events`
- Redis Pub/Sub for cross-instance fanout
- Realtime event envelope: `{ type, version, id, timestamp, data }`

**Notification durable pipeline**
```
Business transaction → PostgreSQL + Outbox → PgBoss → Worker → notification row → Redis Pub/Sub → WebSocket → Browser
```
Redis is NOT durable. Missed notifications retrieved via HTTP on reconnect.

**Triggered notifications** (business events → durable row + WS push)
- Order confirmed, status changed, shipped, delivered
- Return approved/rejected
- Refund processed
- Seller approved/rejected
- New conversation message

### Tier 2 gate tests
- Review requires verified purchase (customer who never bought → 403)
- Notification User A cannot read User B's notifications
- WebSocket: User A's event does NOT reach User B
- Offline user: notification persists in DB, available via HTTP on reconnect

### Exit criteria
- Verified purchase rule enforced on reviews
- Notifications persist even when user is offline
- No cross-user WebSocket event leakage
- Reconnect: GET /notifications returns missed items from DB

---

## Phase 8 — Search & AI Shopping Assistant

**Status:** `pending`  
**Depends on:** Phase 7  
**Blocks:** Phase 9

### Goal
Natural-language product discovery, strictly grounded in the real catalog. AI explains — backend filters.

### Deliverables

**Search module** (`modules/search/`)
```
GET  /api/v1/search/products?q=...
GET  /api/v1/search/suggestions?q=...
POST /api/v1/search/semantic
POST /api/v1/search/filters/parse
GET  /api/v1/products/featured
GET  /api/v1/products/recommendations
```

**AI module** (`modules/ai/`)
```
POST   /api/v1/ai/conversations
GET    /api/v1/ai/conversations
GET    /api/v1/ai/conversations/:id
POST   /api/v1/ai/conversations/:id/messages
DELETE /api/v1/ai/conversations/:id
POST   /api/v1/ai/search
```

**AI pipeline (invariants)**
```
User query → AI intent extraction → Backend Zod validation
→ SQL hard filters (price, category, stock, visibility)
→ Optional pgvector cosine similarity
→ Business filters → Ranking
→ AI explanation (references ONLY retrieved products)
→ Message persisted to DB
```

**Embedding job** (`catalog.generate-embedding`)
- Async via PgBoss — never blocks HTTP
- Text: `{title} {description} {specifications} {category} {brand}`
- Model + version metadata stored
- Idempotent — safe to re-run
- Missing embedding → fallback to keyword search (no hard failure)

**AI safety invariants**
- AI cannot decide: product existence, stock, price, auth, seller eligibility
- All filters validated by backend before DB query
- Input bounded (max chars/tokens)
- Provider failure → graceful degradation to keyword search
- Conversation ownership enforced

**Demo target:** `"gaming laptops under 200k with RTX"` → real catalog products with correct constraints

### Tier 2 gate tests
- AI search returns only real DB products (not hallucinated)
- Price/category/stock filters enforced even when AI extracts them
- Provider failure → fallback search works
- Conversation ownership (User A cannot read User B's conversations)
- Embedding job is idempotent

### Exit criteria
- Keyword search works with pagination + filters
- AI search returns real products, hard constraints enforced
- Embedding generation async + idempotent
- AI provider failure degrades gracefully
- Demo query returns correct results

---

## Phase 9 — Admin, Moderation & Operations

**Status:** `pending`  
**Depends on:** Phase 8  
**Blocks:** Phase 10

### Goal
Platform-level control: user management, seller approval, product moderation, order oversight, review moderation.

### Deliverables

**Admin module** (`modules/admin/`)
```
GET   /api/v1/admin/dashboard

GET   /api/v1/admin/users
GET   /api/v1/admin/users/:id
PATCH /api/v1/admin/users/:id/status

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

**Admin invariants**
- All routes: `requireAuth` + `requireRole('ADMIN')`
- Admin mutations call domain services — no direct DB mutations
- Explicit action endpoints for state transitions (not generic PATCH)
- All admin actions logged with `adminUserId`
- Seller approval → triggers PgBoss job → notification to seller

### Tier 2 gate tests
- Customer/seller → admin routes → 403
- Seller approval triggers notification
- Product approval/rejection changes catalog visibility

### Exit criteria
- All admin routes protected (customer/seller → 403)
- Seller approve/reject flow complete with notifications
- Product moderation changes public catalog visibility
- All admin actions logged

---

## Phase 10 — Production Hardening, Testing, Observability & Security

**Status:** `pending`  
**Depends on:** Phase 9  
**Blocks:** Phase 11

### Goal
Full-system Tier 3 verification. NOT the first time security is considered. Complete test coverage, security audit, performance review.

### Deliverables

**Test suite completeness**

Unit tests (`tests/unit/`):
- Price/discount/tax calculations
- Order state machine predicates
- Pagination utilities
- Search query parsing + AI intent parsing
- Ranking logic + embedding text construction

Integration tests (`tests/integration/`):
- Complete auth lifecycle
- Customer ownership isolation (cart, orders, addresses, notifications)
- Seller ownership isolation (products, variants, inventory, orders)
- Golden purchase path (full end-to-end)
- Concurrent last-unit checkout
- Duplicate order idempotency
- Payment webhook idempotency
- Order state machine (valid + invalid transitions)
- Outbox creation with business transaction
- PgBoss job retry behavior
- Notification persistence + WebSocket delivery
- Redis failure fallback
- Admin RBAC boundaries
- AI search grounding (real products only)
- Rate limiting on auth routes
- Sensitive data not in responses or logs

**Security audit**
- No IDOR
- No cross-user / cross-seller leakage
- No price/inventory manipulation from client
- No privilege escalation
- No stack traces in API error responses
- No secrets in logs
- No payment credentials stored raw

**Performance review**
- `EXPLAIN ANALYZE` on: product list, search, cart, order creation, notification list
- No N+1 queries in hot paths
- All list endpoints bounded and paginated
- Indexes verified

**Observability**
- Request IDs on all requests
- Structured logs include `requestId`, `userId`, resource IDs
- Background job failures logged and observable
- `/health` and `/ready` verified

**Configuration review**
- CORS locked for production domain
- Rate limits finalized
- Cookie flags: `httpOnly`, `secure`, `sameSite`
- No secrets hardcoded
- `.env` in `.gitignore`

### Exit criteria
- Full test suite passes
- TypeScript, lint, build pass
- No critical security issues
- No unbounded queries in hot paths
- EXPLAIN ANALYZE shows index usage
- Health/readiness endpoints work

---

## Phase 11 — Deployment & Launch

**Status:** `pending`  
**Depends on:** Phase 10  
**Blocks:** nothing (final phase)

### Goal
Production deployment and public launch. Project is done only when a stranger can complete the purchase journey on a public URL.

### Deliverables

**Infrastructure**
- 1× Fastify API process (public URL)
- 1× PgBoss Worker process
- 1× Neon PostgreSQL database (production)
- 1× Redis instance

**Pre-launch**
```
[ ] pnpm db:migrate applied to production DB
[ ] pnpm db:seed applied — demo catalog and accounts exist
[ ] Demo accounts verified: customer@demo.com / seller@demo.com / admin@demo.com
[ ] API process running, accessible via public HTTPS URL
[ ] Worker process running, PgBoss jobs processing
[ ] GET /health → 200
[ ] GET /ready → 200
[ ] WebSocket connects and delivers events
[ ] Checkout (COD) works end-to-end
[ ] AI search returns real products
[ ] AI degrades gracefully if provider unavailable
[ ] CORS configured for production domain
[ ] Rate limits active
[ ] No secrets in git history
[ ] .agent-logs/ committed and up to date
[ ] Repository is public
```

**Production smoke test** (incognito browser, not as developer)
1. Open public URL → marketplace loads
2. Browse categories → products visible
3. Search "gaming laptop" → relevant results
4. Click product → detail with variants/offers
5. Register account → works
6. Add to cart → updates correctly
7. Checkout (COD) → order created, confirmation shown
8. View order → status correct
9. Receive WebSocket notification → realtime works
10. Login as seller demo → seller dashboard accessible
11. Login as admin demo → admin dashboard accessible

### Exit criteria
- Public URL opens in incognito browser
- Stranger completes full purchase journey
- Seller logs in and manages products
- Admin logs in and performs moderation
- All smoke test steps pass
- `.agent-logs/` committed with final entry
- Repository public

---

## Dependency Graph

```
Phase 0 (Baseline)
    ↓
Phase 1 (Foundation)
    ↓
Phase 2 (DB + Seed)
    ↓
Phase 3 (Auth)
    ↓
Phase 4 (Cart + Checkout) ← CRITICAL PATH
    ↓
Phase 5 (Seller)
    ↓
Phase 6 (Payments + Fulfillment)
    ↓
Phase 7 (Reviews + Notifications + Realtime)
    ↓
Phase 8 (Search + AI)
    ↓
Phase 9 (Admin)
    ↓
Phase 10 (Hardening)
    ↓
Phase 11 (Launch)
```

---

## Per-Phase Agent Checklist

Before starting any phase:
1. Read `AGENTS.md`
2. Read `.planning/PRODUCTION_CHECKLIST.md`
3. Read `.planning/TESTING_CONTEXT.md`
4. Inspect the current repository state
5. Identify existing patterns to reuse

During every implementation chunk:
1. Apply all Tier 1 production-readiness rules
2. Run `pnpm typecheck` + `pnpm lint` + relevant tests
3. Fix all failures before continuing

After completing the phase:
1. Run full Tier 2 phase gate
2. Fix all blocking issues
3. Run full relevant test suite
4. Commit phase changes
5. Update `.planning/STATE.md`
6. Add entry to `.agent-logs/`

---

## What NOT to Add at Any Phase

```
Kafka          RabbitMQ       NATS
Temporal       Elasticsearch  OpenSearch
Separate vector DB             Separate WS service
Microservices  API gateway     Kubernetes / service mesh
```

Stack is intentionally:
```
Fastify + PostgreSQL/Neon + Drizzle + PgBoss + Redis + WebSocket (+ pgvector + OpenAI)
```

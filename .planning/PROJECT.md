# Amazon-Style Marketplace — Project Context

## Project Identity

**Name:** Amazon-Style Multi-Seller Marketplace  
**Type:** Modular Monolith Backend API  
**Stack:** Fastify + TypeScript + Zod + Drizzle + PostgreSQL/Neon + Redis/ioredis + PgBoss + WebSocket + pgvector + OpenAI + Pino  
**Package Manager:** pnpm (monorepo with Turborepo)  
**Testing:** Vitest  

## Project Objective

Build and deploy a **live, credible, end-to-end Amazon-style multi-seller marketplace** that a stranger can open through a public URL, browse and search, inspect products and offers, add products to a cart, authenticate, complete a test/COD checkout, view the resulting order, and inspect its post-purchase state.

The marketplace must demonstrate:
- Operational seller workflows
- Admin/moderation workflows
- Coherent order and fulfillment lifecycle
- Durable asynchronous processing
- Notifications and WebSocket realtime delivery
- Grounded AI shopping (strictly catalog-grounded)
- Realistic seeded marketplace data
- Production-like deployment and verification

**Priority rule:** If time slips, protect the **golden customer purchase path, coherent order state, seller listing/operation, and public deployment** before advanced analytics, social login, sophisticated recommendations, or nonessential admin UI.

---

## Architecture

### Core Principle

**Modular monolith.** One backend application organized into strongly separated business modules. No microservices, no Kafka, no RabbitMQ.

### Infrastructure Responsibilities

```
PostgreSQL   = business truth (durable state)
PgBoss       = durable asynchronous work
Redis        = cache + ephemeral realtime fanout
WebSocket    = live browser delivery
pgvector     = semantic product retrieval
AI/LLM       = intent understanding + explanation (NOT source of truth)
Backend      = validation + authorization + business rules
```

### Application Processes

**API process** (`apps/server/src/main.ts`):
- Creates Fastify application
- Registers plugins, routes, WebSocket handlers
- Starts HTTP server
- Graceful shutdown

**Worker process** (`apps/server/src/workers/register-workers.ts`):
- Starts PgBoss
- Registers all background workers
- Processes asynchronous jobs
- Graceful shutdown

### Module Layering

```
Routes → Controllers → Services → Repositories → PostgreSQL
Services → Core infrastructure (db, redis, queue, events)
```

Rules:
- Controllers do not call repositories directly
- Repositories own persistence only (no business rules)
- Services own business logic
- Workers call module services (no business policy in workers)
- Infrastructure never imports business modules
- Modules never import other module's repositories

---

## Project Structure

```
project-root/
├── apps/
│   └── server/
│       ├── package.json
│       ├── Dockerfile
│       └── src/
│           ├── main.ts
│           ├── app/
│           │   ├── app.ts
│           │   ├── plugins.ts
│           │   ├── routes.ts
│           │   └── websocket.ts
│           ├── config/
│           │   └── env.ts
│           ├── core/
│           │   ├── db/db.ts
│           │   ├── redis/
│           │   │   ├── redis.ts
│           │   │   └── pubsub.ts
│           │   ├── queue/
│           │   │   ├── boss.ts
│           │   │   ├── jobs.ts
│           │   │   └── worker.ts
│           │   ├── events/
│           │   │   ├── event-bus.ts
│           │   │   └── outbox.ts
│           │   ├── errors/
│           │   │   ├── app-error.ts
│           │   │   └── error-handler.ts
│           │   ├── logger/
│           │   │   └── logger.ts
│           │   └── utils/
│           ├── modules/
│           │   ├── auth/
│           │   ├── users/
│           │   ├── catalog/
│           │   ├── sellers/
│           │   ├── cart/
│           │   ├── wishlist/
│           │   ├── orders/
│           │   ├── payments/
│           │   ├── fulfillment/
│           │   ├── reviews/
│           │   ├── notifications/
│           │   ├── search/
│           │   ├── ai/
│           │   └── admin/
│           └── workers/
│               └── register-workers.ts
├── packages/
│   ├── database/
│   │   └── src/
│   │       ├── client.ts
│   │       ├── index.ts
│   │       └── schema/
│   │           ├── index.ts
│   │           ├── auth.schema.ts
│   │           ├── users.schema.ts
│   │           ├── catalog.schema.ts
│   │           ├── commerce.schema.ts
│   │           ├── fulfillment.schema.ts
│   │           └── notifications.schema.ts
│   ├── shared/
│   │   └── src/
│   │       ├── types/
│   │       ├── constants/
│   │       ├── schemas/
│   │       └── utils/
│   └── env/
│       └── src/
│           └── server.ts
├── infra/
│   └── docker/
│       ├── postgres/
│       └── redis/
├── tests/
│   ├── unit/
│   └── integration/
├── docker-compose.yml
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── AGENTS.md
```

---

## Technology Stack

| Layer         | Technology          | Responsibility                       |
|---------------|---------------------|--------------------------------------|
| HTTP          | Fastify             | API server                           |
| Validation    | Zod                 | Request/env validation               |
| ORM           | Drizzle ORM         | PostgreSQL access                    |
| Database      | PostgreSQL / Neon   | Durable application state            |
| Vector search | pgvector            | Semantic/vector search               |
| Jobs          | PgBoss              | Durable background processing        |
| Cache/Realtime| Redis / ioredis     | Cache, rate limiting, Pub/Sub        |
| Realtime      | WebSocket           | Browser/server live communication    |
| Logging       | Pino                | Structured application logging       |
| Testing       | Vitest              | Unit/integration tests               |
| Package mgr   | pnpm                | Dependency management (monorepo)     |
| AI            | OpenAI              | Intent extraction + explanation      |

---

## Environment Variables Required

```
DATABASE_URL
REDIS_URL
PG_BOSS_DATABASE_URL
APP_URL
CORS_ORIGINS
SESSION_SECRET / JWT_SECRET
COOKIE_SECRET
OPENAI_API_KEY
EMBEDDING_MODEL
PAYMENT_PROVIDER
PAYMENT_SECRET_KEY
PAYMENT_WEBHOOK_SECRET
OBJECT_STORAGE_*
LOG_LEVEL
```

All environment variables validated through Zod at `packages/env/src/server.ts`.  
Business modules use `serverEnv.DATABASE_URL` — never `process.env` directly.

---

## API Contract

- Base: `/api/v1`
- UUIDs for all IDs
- ISO-8601 UTC dates
- Cursor pagination for large collections
- JSON request/response
- Zod validation on all inputs

**Success response:**
```json
{ "success": true, "data": {} }
```

**Error response:**
```json
{
  "success": false,
  "error": { "code": "...", "message": "...", "details": {} }
}
```

`Idempotency-Key` header required for order/payment-changing requests.

**Never trust from client:** `userId`, `sellerId`, `role`, `price`, `stock`, `total`, `ownership`, `permission`, `status`

---

## Domain Entities

```
User, Session, Address
Seller
Category, Product, ProductVariant
Cart, CartItem
Wishlist, WishlistItem
Order, OrderItem
Payment
Shipment
Review
Coupon
Return, ReturnItem
Notification
Conversation, Message
OutboxEvent
```

Key schema notes:
- Money: numeric/decimal (never floating point)
- Product embeddings for pgvector
- Order/item price snapshots (historical purchase price preserved)
- Seller ownership on products/variants
- Order idempotency keys
- Outbox event state (pending/processing/completed/failed)

---

## Background Jobs

```
notifications.dispatch
emails.order-confirmation
emails.shipment-update
payments.reconcile
orders.expire-payment
catalog.generate-embedding
search.reindex-product
images.process
analytics.record
```

## Domain Event Types

```
ORDER_CREATED, ORDER_CONFIRMED, ORDER_CANCELLED
PAYMENT_SUCCEEDED, PAYMENT_FAILED
SHIPMENT_CREATED, ORDER_SHIPPED, ORDER_DELIVERED
RETURN_CREATED, REFUND_COMPLETED
REVIEW_CREATED
NOTIFICATION_CREATED, MESSAGE_CREATED
PRODUCT_PUBLISHED, PRODUCT_UPDATED
SELLER_APPROVED
```

---

## Order Lifecycle

```
CART → CHECKOUT → PAYMENT_PENDING
     → PAYMENT_SUCCEEDED → CONFIRMED → PROCESSING → SHIPPED → DELIVERED → COMPLETED

PAYMENT_PENDING → PAYMENT_FAILED
CONFIRMED → CANCELLED
DELIVERED → RETURN_REQUESTED → RETURN_APPROVED/REJECTED
         → RETURN_IN_TRANSIT → RETURN_RECEIVED → REFUND_PENDING → REFUNDED
```

---

## WebSocket Architecture

Redis channels:
```
user:{userId}:events
conversation:{conversationId}:events
system:events
```

Event type is inside the payload — not in the channel name.  
Subscriptions are authorized server-side.  
In-memory connection registry: `Map<UserId, Set<WebSocket>>`

---

## Testing Architecture

**Unit tests** (`tests/unit/`): Pure deterministic logic — pricing, calculations, state machines, parsers, ranking.

**Integration tests** (`tests/integration/`): Real Fastify + real PostgreSQL + real Redis + real PgBoss. Uses `buildApp()` → `app.ready()` → `app.inject()`. Never bypass auth/validation/serialization.

**Database isolation:** Randomized `runId` per test run. Scoped queries — never unscoped `COUNT(*)`.

---

## Production Readiness Tiers

- **Tier 1 (Build-in):** Applied during every feature — validation, auth, ownership, pagination, transactions, idempotency, secure logging.
- **Tier 2 (Phase Gate):** After each phase — route review, query plans, EXPLAIN ANALYZE, authorization tests, concurrency tests.
- **Tier 3 (Pre-production):** Once before launch — load testing, full security review, multi-instance testing.

See `.planning/PRODUCTION_CHECKLIST.md` for full details.

---

## Definition of Done (Launch)

### Customer journey works
Guest browse → search → product detail → register/login → cart → wishlist → checkout (COD/test) → order confirmation → order tracking → cancellation → return → review → notifications → WebSocket realtime

### Seller journey works
Apply → profile → create product → variants/offers → publish → inventory → price → view orders → fulfill → ship

### Admin journey works
Users → sellers (approve/reject) → products (approve/reject) → orders → returns → reviews (moderate)

### AI journey works
Natural language query → intent extraction → SQL hard filters → pgvector → real catalog products → persisted conversation

### Infrastructure
Migrations from clean DB → PgBoss retries → outbox protects side effects → graceful shutdown → structured safe logs → health/readiness endpoints

### Production
Public URL in incognito → realistic demo data → customer/seller/admin demo accounts → checkout works → worker running → realtime works → AI degrades gracefully

---

## Key References

- `AGENTS.md` — Architectural contract (read before any code change)
- `.planning/PRODUCTION_CHECKLIST.md` — Three-tier production readiness checklist
- `.planning/TESTING_CONTEXT.md` — Mandatory API integration testing standard
- `.planning/ROADMAP.md` — Phase structure and sequencing
- `.planning/REQUIREMENTS.md` — Scoped requirements per phase
- `.planning/STATE.md` — Current progress and project memory
- `.agent-logs/` — Agent session logs (committed incrementally)

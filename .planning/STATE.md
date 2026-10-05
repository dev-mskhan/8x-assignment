# Amazon-Style Marketplace — Project State

> This file is the living memory of the project. Update it at the end of every phase and every significant session.  
> Keep it accurate — it is the first file an agent reads when resuming work.

---

## Current Status

| Field             | Value                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| **Current phase** | Phase 1 — Foundation                                                                                           |
| **Phase status**  | pending                                                                                                        |
| **Last updated**  | 2026-10-05                                                                                                     |
| **Next action**   | Execute Phase 1: install dependencies, implement real Fastify app, wire DB/Redis/PgBoss, operational endpoints |
| **Blocker**       | none                                                                                                           |

---

## Phase Progress

| Phase | Name                                     | Status      | Notes                                                                        |
| ----- | ---------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| 0     | Capture & Repository Baseline            | `completed` | Full monorepo scaffold per AGENTS.md §3. Agent log workflow verified intact. |
| 1     | Foundation                               | `pending`   |                                                                              |
| 2     | Database, Core Domain & Seed Data        | `pending`   |                                                                              |
| 3     | Authentication & Users                   | `pending`   |                                                                              |
| 4     | Catalog, Shopping, Cart & Checkout       | `pending`   | **CRITICAL PATH**                                                            |
| 5     | Seller Marketplace                       | `pending`   |                                                                              |
| 6     | Payments, Fulfillment, Orders & Returns  | `pending`   |                                                                              |
| 7     | Reviews, Notifications & Realtime        | `pending`   |                                                                              |
| 8     | Search & AI Shopping Assistant           | `pending`   |                                                                              |
| 9     | Admin, Moderation & Operations           | `pending`   |                                                                              |
| 10    | Production Hardening, Testing & Security | `pending`   |                                                                              |
| 11    | Deployment & Launch                      | `pending`   |                                                                              |

---

## What Has Been Done

### Session: 2026-10-05 (Project Initialization)

**Planning artifacts created:**

- `.planning/PROJECT.md` — full project context, architecture, stack, entity model, API contract, order lifecycle, testing architecture, production tiers, definition of done
- `.planning/REQUIREMENTS.md` — scoped requirements for all 12 phases (Phase 0–11), each with explicit invariants, route lists, business rules, and exit criteria
- `.planning/ROADMAP.md` — Phase 0–11 structure with deliverables, exit criteria, Tier 2 gate tests, dependency graph, and per-phase agent checklist
- `.planning/STATE.md` — this file (project memory and progress tracking)
- `.planning/config.json` — workflow preferences
- `.planning/PRODUCTION_CHECKLIST.md` — three-tier production readiness checklist (pre-existing)
- `.planning/TESTING_CONTEXT.md` — mandatory API integration testing standard (pre-existing)

**Repository state at initialization:**

- `AGENTS.md` exists — architectural contract for modular monolith
- `.env.example` exists (empty)
- `.env` exists
- `.agent-logs/` exists with canary/session logs
- `.kiro/` exists with hooks and scripts
- `.github/` exists (empty)
- No `apps/`, `packages/`, `infra/`, `tests/` directories yet — to be created in Phase 0/1

---

## What Phase 0 Created

Full monorepo skeleton per AGENTS.md §3:

```
apps/server/
├── package.json, Dockerfile, tsconfig.json
└── src/
    ├── main.ts                          ← API entry (stub)
    ├── app/ (app|plugins|routes|websocket).ts
    ├── config/env.ts
    ├── core/
    │   ├── db/db.ts                     ← getDb() stub
    │   ├── redis/(redis|pubsub).ts
    │   ├── queue/(boss|jobs|worker).ts
    │   ├── events/(event-bus|outbox).ts
    │   ├── errors/(app-error|error-handler).ts
    │   └── logger/logger.ts
    ├── modules/.gitkeep                 ← added per phase
    └── workers/register-workers.ts      ← worker entry (stub)

packages/
├── typescript-config/base.json          ← strict TS config
├── eslint-config/index.js
├── env/src/server.ts                    ← full Zod schema (stub export)
├── database/src/(client|index|schema/)  ← Drizzle stubs
└── shared/src/(types|constants|schemas|utils)/

infra/docker/
├── postgres/init.sql                    ← vector + pg_trgm + uuid-ossp
└── redis/redis.conf

tests/
├── vitest.config.ts
├── unit/.gitkeep
└── integration/.gitkeep

Root: package.json, pnpm-workspace.yaml, turbo.json, .env.example, docker-compose.yml
```

## What Still Needs to Be Built (added per phase)

Real implementations of all stubs — `pnpm install`, Fastify wiring, DB/Redis/PgBoss connections, migrations, auth, modules, etc. — happen from Phase 1 onward.

## Original: What Does NOT Yet Exist

---

## Architecture Decisions Locked

These decisions are final. Do not revisit without explicit justification.

| Decision                | Value                                            |
| ----------------------- | ------------------------------------------------ |
| Architecture            | Modular monolith — no microservices              |
| HTTP framework          | Fastify                                          |
| Language                | TypeScript                                       |
| Validation              | Zod                                              |
| ORM                     | Drizzle ORM                                      |
| Database                | PostgreSQL / Neon                                |
| Vector search           | pgvector (in PostgreSQL — no separate vector DB) |
| Background jobs         | PgBoss (PostgreSQL-backed)                       |
| Cache / Realtime fanout | Redis / ioredis                                  |
| Browser delivery        | WebSocket (native — no Socket.io)                |
| Logging                 | Pino (structured, secrets redacted)              |
| Testing                 | Vitest                                           |
| Package manager         | pnpm (monorepo)                                  |
| Monorepo build          | Turborepo                                        |
| AI provider             | OpenAI                                           |
| Payment mode            | COD + sandbox/test adapter                       |
| Money representation    | `numeric(12,2)` — never float                    |
| Auth strategy           | Session tokens (httpOnly cookies or Bearer)      |
| ID format               | UUID                                             |
| Date format             | ISO-8601 UTC                                     |
| Pagination              | Cursor-based for large collections               |

---

## Infrastructure Responsibility Map

| System     | Responsibility                     | Must NOT be used for      |
| ---------- | ---------------------------------- | ------------------------- |
| PostgreSQL | Business truth, durable state      | Ephemeral/cache data      |
| PgBoss     | Durable async work                 | Synchronous CRUD          |
| Redis      | Cache + ephemeral realtime fanout  | Durable business state    |
| WebSocket  | Live browser delivery              | Durable event storage     |
| pgvector   | Semantic retrieval                 | Authorization, pricing    |
| AI/LLM     | Intent extraction + explanation    | Product/price/stock truth |
| Backend    | Validation + auth + business rules | Delegating to AI          |

---

## Known Constraints & Risks

| Risk                              | Mitigation                                                       |
| --------------------------------- | ---------------------------------------------------------------- |
| 24-hour build window              | Protect golden path (Phase 4) first; defer advanced admin UI     |
| OpenAI API availability           | AI search must degrade gracefully to keyword search              |
| pgvector complexity               | Missing embedding → fallback to keyword search, not hard failure |
| Concurrent checkout               | `SELECT ... FOR UPDATE` on inventory within transaction          |
| Payment webhooks                  | Idempotency key + status check before applying state change      |
| Cross-seller data leakage         | Ownership check in every seller mutation (service layer)         |
| Test isolation in accumulating DB | `runId` scoping on all test fixtures and assertions              |

---

## Environment Variables Required

```
DATABASE_URL               — PostgreSQL connection string
REDIS_URL                  — Redis connection string
PG_BOSS_DATABASE_URL       — PgBoss uses same or separate DB
APP_URL                    — public API base URL
CORS_ORIGINS               — allowed origins (comma-separated)
JWT_SECRET / SESSION_SECRET — session signing key
COOKIE_SECRET              — cookie signing key
OPENAI_API_KEY             — OpenAI API key
EMBEDDING_MODEL            — e.g. text-embedding-3-small
PAYMENT_PROVIDER           — cod | stripe | paystack
PAYMENT_SECRET_KEY         — provider secret key
PAYMENT_WEBHOOK_SECRET     — webhook signature verification
OBJECT_STORAGE_*           — file storage config
LOG_LEVEL                  — debug | info | warn | error
```

---

## Demo Accounts (to be created in Phase 2 seed)

| Role     | Email             | Password      |
| -------- | ----------------- | ------------- |
| Customer | customer@demo.com | (set in seed) |
| Seller   | seller@demo.com   | (set in seed) |
| Admin    | admin@demo.com    | (set in seed) |

---

## Key Invariants (Never Violate)

1. **Price integrity:** Server recalculates price at checkout. Client price ignored.
2. **Inventory concurrency:** `SELECT ... FOR UPDATE` within checkout transaction.
3. **Idempotency keys:** Order creation + payment mutations require `Idempotency-Key` header.
4. **Outbox atomicity:** Outbox event committed in same transaction as business change.
5. **Ownership isolation:** Seller ID always from authenticated session, never from request body.
6. **Auth source:** User ID always from authenticated session, never from request body.
7. **AI grounding:** LLM output treated as untrusted intent. Backend filters enforce real constraints.
8. **Notification durability:** Redis Pub/Sub is ephemeral. PostgreSQL notification row is truth.
9. **Historical snapshots:** Order item price snapshot preserved at purchase time. Later price changes do not affect existing orders.
10. **Transaction rollback:** Multi-table writes in single transaction. Failed write → full rollback → no partial state.

---

## Module Inventory

| Module        | Directory                | Status      |
| ------------- | ------------------------ | ----------- |
| auth          | `modules/auth/`          | not created |
| users         | `modules/users/`         | not created |
| catalog       | `modules/catalog/`       | not created |
| sellers       | `modules/sellers/`       | not created |
| cart          | `modules/cart/`          | not created |
| wishlist      | `modules/wishlist/`      | not created |
| orders        | `modules/orders/`        | not created |
| payments      | `modules/payments/`      | not created |
| fulfillment   | `modules/fulfillment/`   | not created |
| reviews       | `modules/reviews/`       | not created |
| notifications | `modules/notifications/` | not created |
| search        | `modules/search/`        | not created |
| ai            | `modules/ai/`            | not created |
| admin         | `modules/admin/`         | not created |

---

## Test Coverage Status

| Area                 | Unit | Integration |
| -------------------- | ---- | ----------- |
| Auth lifecycle       | —    | —           |
| Customer ownership   | —    | —           |
| Seller ownership     | —    | —           |
| Golden purchase path | —    | —           |
| Concurrent checkout  | —    | —           |
| Order state machine  | —    | —           |
| Payment idempotency  | —    | —           |
| Outbox + PgBoss      | —    | —           |
| Notifications + WS   | —    | —           |
| AI search grounding  | —    | —           |
| Admin RBAC           | —    | —           |

---

## Agent Instructions for Resuming Work

When resuming, always:

1. Read this file first — understand current phase and status
2. Read `AGENTS.md` — architectural contract
3. Read `.planning/PRODUCTION_CHECKLIST.md` — apply Tier 1 rules during every chunk
4. Read `.planning/TESTING_CONTEXT.md` — apply testing standards throughout
5. Check `ROADMAP.md` for the current phase deliverables and exit criteria
6. Check `REQUIREMENTS.md` for detailed requirements of the current phase
7. Inspect actual repository state before creating any files
8. Reuse existing patterns and abstractions
9. Do NOT create empty boilerplate files

After completing any significant work:

1. Update **Current Status** table above
2. Update the **Phase Progress** table
3. Update **Module Inventory** if new modules created
4. Update **Test Coverage Status** if tests added
5. Add a session entry to **What Has Been Done**
6. Add a new entry to `.agent-logs/`

---

## Changelog

| Date       | Phase | Event                                                                                                                                                                                     |
| ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | —     | Project initialized. Planning artifacts created. Repository baseline inspection complete. No application code exists yet.                                                                 |
| 2026-10-05 | 0     | Phase 0 complete. Full monorepo scaffold per AGENTS.md §3 created. Agent log workflow verified intact (.agent-logs/ tracked, .kiro/ hooks tracked, gitignore correct). Ready for Phase 1. |

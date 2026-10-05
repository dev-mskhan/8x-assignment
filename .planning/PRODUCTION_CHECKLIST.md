# Amazon Clone — Production Readiness Checklist

## When to Apply Each Item

> **Purpose:**
> This document answers one question for every production-readiness rule:
>
> **Should the agent enforce this during implementation, at the end of the phase, or once before production launch?**
>
> This is the authoritative production-hardening checklist for the Amazon Clone. The agent must apply it **in sync with every implementation phase** without over-engineering the project.
>
> The checklist applies to all current and future phases:
>
> - Phase 0 — Capture & Repository Baseline
> - Phase 1 — Foundation
> - Phase 2 — Database & Seed Data
> - Phase 3 — Authentication & Users
> - Phase 4 — Catalog, Search, Cart & Checkout
> - Phase 5 — Seller Marketplace
> - Phase 6 — Payments & Fulfillment
> - Phase 7 — Reviews, Notifications & Realtime
> - Phase 8 — AI Shopping
> - Phase 9 — Admin & Product Polish
> - Phase 10 — Production Hardening & Launch
> - Future phases — additional marketplace capabilities

---

# 1. Three-Tier Model

Every checklist item belongs to exactly one of these tiers.

| Tier                             | When                                | Rule                                                                                             |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Tier 1 — Build-in**            | During every implementation chunk   | Design and enforce it while writing the feature. Do not rely on a later cleanup pass.            |
| **Tier 2 — Phase Gate**          | After the phase is complete         | Validate the complete module surface before starting the next phase.                             |
| **Tier 3 — Pre-Production Gate** | Once before first production launch | Requires the full system, realistic data, production-like infrastructure, and complete workload. |

### Tier 1 — Build-in

These are architecture and implementation decisions.

If the agent notices a Tier 1 issue while implementing a feature, **fix it before moving on**.

Do not create technical debt intentionally with the plan to "harden it later."

### Tier 2 — End-of-Phase Gate

These checks require the feature/module to be substantially complete.

Run them once after all chunks of the phase are implemented.

The phase is not complete until the gate passes.

### Tier 3 — Pre-Production Gate

These checks require the complete application.

Do not waste time performing full production-scale load testing during early development phases.

Run these once against the complete staging/production-like system before launch.

---

# 2. Core Architecture Rules

The checklist assumes the current architecture:

- Fastify
- TypeScript
- Zod
- Drizzle ORM
- PostgreSQL / Neon
- Redis / ioredis
- PgBoss
- WebSockets
- pgvector
- OpenAI
- Modular monolith

## Source of Truth

| System         | Responsibility                            |
| -------------- | ----------------------------------------- |
| **PostgreSQL** | Business truth and durable state          |
| **PgBoss**     | Durable asynchronous work                 |
| **Redis**      | Cache and ephemeral realtime fanout       |
| **WebSocket**  | Browser realtime delivery                 |
| **pgvector**   | Semantic product retrieval                |
| **AI/LLM**     | Intent understanding and explanation      |
| **Backend**    | Validation, authorization, business rules |

### Never reverse these responsibilities.

Redis must not become the source of truth.

The LLM must not decide whether a product exists, whether stock exists, what price is valid, or whether a user is authorized.

---

# 3. Section 1 — Server Performance

## Tier 1 — Build-in

- [ ] New services use the minimum DB queries necessary.
- [ ] N+1 queries are prevented when implementing list/detail endpoints.
- [ ] Repository queries use explicit column selection where appropriate.
- [ ] List endpoints are always bounded.
- [ ] Default list limit is defined.
- [ ] Maximum list limit is enforced.
- [ ] Cursor pagination is used for potentially large collections.
- [ ] Pagination has deterministic ordering.
- [ ] Common filtering fields are indexed.
- [ ] Sorting fields are controlled and indexed where required.
- [ ] Search inputs have reasonable length limits.
- [ ] Request body size is bounded.
- [ ] Expensive work is not performed synchronously inside HTTP requests.
- [ ] Image processing, embedding generation, email, notification fanout and similar work use PgBoss when appropriate.
- [ ] Product/search queries do not fetch unnecessary large text/blob fields.
- [ ] Cart and checkout queries remain bounded.
- [ ] Seller order/product lists are paginated.
- [ ] Admin lists are paginated.
- [ ] No unbounded `SELECT *` on large tables.

## Tier 2 — End-of-Phase Gate

- [ ] Review the most frequently used endpoints introduced by the phase.
- [ ] Review the most expensive queries introduced by the phase.
- [ ] Run `EXPLAIN ANALYZE` on important new queries.
- [ ] Verify required indexes exist.
- [ ] Verify pagination works correctly.
- [ ] Verify Fastify response schemas exist for important new endpoints.
- [ ] Review serialization cost.
- [ ] Review middleware overhead.
- [ ] Review cache hit/miss behavior where caching was introduced.
- [ ] Confirm Redis failures fall back safely where applicable.
- [ ] Confirm no accidental N+1 behavior exists.

## Tier 3 — Pre-Production Gate

- [ ] Run API load testing.
- [ ] Measure p50/p95/p99 latency.
- [ ] Define and record acceptable latency targets.
- [ ] Test PostgreSQL pool behavior under concurrent load.
- [ ] Test Redis latency under load.
- [ ] Test with realistic product/catalog/order data.
- [ ] Check Node.js CPU and memory behavior.
- [ ] Check event-loop behavior.
- [ ] Run a sustained test for resource leaks.
- [ ] Identify and fix unacceptable performance bottlenecks.

---

# 4. Section 2 — Concurrency & Data Integrity

## Tier 1 — Build-in

- [ ] Multi-table mutations use PostgreSQL transactions.
- [ ] Inventory-changing operations are transactional.
- [ ] Cart checkout is transactional where atomicity is required.
- [ ] Order creation and order items are created atomically.
- [ ] Payment/order state transitions are protected against races.
- [ ] Inventory decrement is protected against overselling.
- [ ] Read-modify-write operations use appropriate PostgreSQL locking.
- [ ] `FOR UPDATE` is used where required for correctness.
- [ ] Unique constraints enforce business invariants.
- [ ] Duplicate orders/payments/jobs are prevented or made harmless.
- [ ] State transitions check the current DB state inside the transaction.
- [ ] Client-provided status is never trusted.
- [ ] Client-provided price is never trusted.
- [ ] Client-provided stock is never trusted.
- [ ] Client-provided totals are never trusted.
- [ ] Client-provided seller ownership is never trusted.
- [ ] Retryable mutations are idempotent where required.
- [ ] Order/payment/inventory mutations cannot be double-applied.
- [ ] Transaction rollback behavior is preserved on errors.

## Tier 2 — End-of-Phase Gate

- [ ] Test concurrent checkout/inventory operations.
- [ ] Test duplicate POST requests.
- [ ] Test duplicate payment callbacks where applicable.
- [ ] Test duplicate background job execution.
- [ ] Review every new state transition for race conditions.
- [ ] Review lock acquisition order.
- [ ] Review transaction duration.
- [ ] Verify no HTTP/email/Redis external operation occurs inside critical DB transactions.
- [ ] Verify retry behavior.
- [ ] Verify concurrent seller/customer operations do not corrupt state.

## Tier 3 — Pre-Production Gate

- [ ] Run concurrent checkout tests.
- [ ] Run concurrent inventory mutation tests.
- [ ] Run concurrent payment/order state tests.
- [ ] Run multiple worker instances simultaneously.
- [ ] Verify duplicate jobs cannot corrupt data.
- [ ] Inject DB failures during transactions.
- [ ] Inject worker failures during processing.
- [ ] Verify API requests and background jobs cannot overwrite each other incorrectly.
- [ ] Verify final inventory/order/payment totals remain correct after stress testing.

---

# 5. Section 3 — API Hardening

## Tier 1 — Build-in

- [ ] Every API route uses the project response convention.
- [ ] Every request body is validated with Zod.
- [ ] Every query string is validated with Zod.
- [ ] Every route parameter is validated with Zod.
- [ ] No unsafe `req.body as any`.
- [ ] Response DTOs expose only intended fields.
- [ ] Password hashes are never returned.
- [ ] Session/token hashes are never returned.
- [ ] Internal DB errors are mapped to domain errors.
- [ ] Stable machine-readable error codes are used.
- [ ] Correct HTTP status codes are used.
- [ ] User-controlled sorting is whitelisted.
- [ ] User-controlled filtering is whitelisted.
- [ ] Search strings have maximum lengths.
- [ ] Pagination limits have maximum values.
- [ ] Retryable operations have a defined idempotency strategy.
- [ ] Action routes explicitly validate current state.
- [ ] Sensitive seller/admin information is not exposed to customers.
- [ ] Internal IDs are not unnecessarily exposed.

## Tier 2 — End-of-Phase Gate

- [ ] API route inventory is complete.
- [ ] Every new route is registered.
- [ ] Every new route has validation.
- [ ] Important routes have Fastify schemas.
- [ ] API documentation matches implementation where documentation is used.
- [ ] Maximum page sizes are enforced.
- [ ] Search inputs are bounded.
- [ ] Malformed-input tests exist for important new endpoints.
- [ ] Deprecated/test routes are removed.
- [ ] Error responses are consistent.
- [ ] Idempotency behavior is verified.

## Tier 3 — Pre-Production Gate

- [ ] Full API contract suite passes.
- [ ] High-load API edge cases are tested.
- [ ] Large pagination requests are tested.
- [ ] Concurrent creates are tested.
- [ ] Duplicate requests are tested.
- [ ] Full OpenAPI/API documentation is consistent with implementation.

---

# 6. Section 4 — User, Seller & Ownership Isolation

Amazon Clone does not use SiteFlow-style organization tenancy.

The important isolation boundaries are:

- Customer → own account/data
- Seller → own products/orders/business data
- Admin → platform-level authority
- Customer → cannot access another customer's private data
- Seller → cannot modify another seller's resources
- Backend → always determines ownership from authenticated identity

## Tier 1 — Build-in

- [ ] Authenticated user ID comes from the authenticated session/token.
- [ ] User ID is never trusted from request body for ownership.
- [ ] Seller ID is never trusted from request body for ownership.
- [ ] Seller ownership is verified server-side.
- [ ] Seller product mutations verify product ownership.
- [ ] Seller inventory mutations verify variant ownership.
- [ ] Seller order access is restricted to orders containing that seller's items.
- [ ] Customer order access is restricted to the authenticated customer.
- [ ] Customer addresses belong to the authenticated customer.
- [ ] Cart belongs to the authenticated customer.
- [ ] Wishlist belongs to the authenticated customer.
- [ ] Reviews are associated with the authenticated customer.
- [ ] Admin-only operations have explicit authorization.
- [ ] Wrong-owner resources do not leak sensitive existence information.
- [ ] Background jobs carry the required user/seller context.
- [ ] Redis keys containing private user/seller data include the appropriate scope.

## Tier 2 — End-of-Phase Gate

- [ ] Customer A cannot read Customer B's private resources.
- [ ] Customer A cannot modify Customer B's cart.
- [ ] Customer A cannot read Customer B's orders.
- [ ] Seller A cannot modify Seller B's products.
- [ ] Seller A cannot read Seller B's private seller data.
- [ ] Seller A cannot manipulate Seller B's inventory.
- [ ] Seller A cannot access unrelated seller orders.
- [ ] Admin authorization is verified for new administrative capabilities.
- [ ] Ownership checks are reviewed in all new repositories/services.
- [ ] Redis ownership/scoping is tested where applicable.

## Tier 3 — Pre-Production Gate

- [ ] Cross-user isolation is tested under concurrent load.
- [ ] Cross-seller isolation is tested under concurrent load.
- [ ] No private customer/seller data leaks through API responses.
- [ ] No private data leaks through logs.
- [ ] No private data leaks through caches.
- [ ] Authorization boundaries are reviewed end-to-end.

---

# 7. Section 5 — Authentication & Authorization Security

## Tier 1 — Build-in

- [ ] Protected routes require authentication.
- [ ] Public routes are intentionally public.
- [ ] Seller routes require seller authorization.
- [ ] Admin routes require admin authorization.
- [ ] Every mutation has its own authorization check.
- [ ] Action routes such as `/cancel`, `/ship`, `/refund`, `/approve` are protected.
- [ ] Permissions are enforced server-side.
- [ ] Frontend visibility is never treated as authorization.
- [ ] Password handling uses secure hashing.
- [ ] Session/token handling follows the project authentication design.
- [ ] Sensitive operations are auditable where appropriate.
- [ ] Authorization failures do not expose sensitive policy information.

## Tier 2 — End-of-Phase Gate

- [ ] Review all new protected routes.
- [ ] Test customer access to seller/admin operations.
- [ ] Test seller access to admin operations.
- [ ] Test seller ownership boundaries.
- [ ] Test privilege escalation attempts.
- [ ] Verify auth rate limiting remains appropriate.
- [ ] Verify session handling for new authentication flows.
- [ ] Verify logout/revocation behavior if affected.

## Tier 3 — Pre-Production Gate

- [ ] Complete login/logout flow tested.
- [ ] Session/token expiry tested.
- [ ] Session revocation tested.
- [ ] Password security reviewed.
- [ ] OAuth flow tested if enabled.
- [ ] Authentication abuse/rate-limit behavior tested.
- [ ] Privilege escalation suite passes.

---

# 8. Section 6 — Input & Application Security

## Tier 1 — Build-in

- [ ] All external input is validated.
- [ ] Zod schemas reject invalid input.
- [ ] Unexpected fields do not silently modify protected data.
- [ ] SQL queries remain parameterized.
- [ ] Raw SQL is reviewed carefully.
- [ ] User input is never string-concatenated into SQL.
- [ ] Search/filter inputs are bounded.
- [ ] Array inputs have maximum lengths.
- [ ] Product creation fields have sensible limits.
- [ ] Review text has sensible limits.
- [ ] Chat/AI input has sensible limits.
- [ ] Uploaded file metadata is validated if uploads are introduced.
- [ ] External URLs are validated if external fetching is introduced.
- [ ] Secrets are never logged.
- [ ] Production errors do not expose stack traces or DB internals.

## Tier 2 — End-of-Phase Gate

- [ ] Review new URL/file handling for path traversal.
- [ ] Review external requests for SSRF risk.
- [ ] Review variable-length arrays for resource exhaustion.
- [ ] Test maximum payload sizes.
- [ ] Test oversized search queries.
- [ ] Test expensive filter combinations.
- [ ] Review PII exposure.
- [ ] Review financial information exposure.
- [ ] Review AI prompts for excessive input sizes.
- [ ] Review uploaded product/image content if applicable.

## Tier 3 — Pre-Production Gate

- [ ] Third-party API integrations are security-reviewed.
- [ ] External API timeouts are configured.
- [ ] Rate limiting is finalized.
- [ ] Abuse controls are tested.
- [ ] File/upload security is tested if uploads exist.
- [ ] Production secrets/configuration are reviewed.

---

# 9. Section 7 — Redis & Caching

## Tier 1 — Build-in

- [ ] PostgreSQL remains the source of truth.
- [ ] Redis is never used as the authoritative store for orders.
- [ ] Redis is never used as the authoritative store for payments.
- [ ] Redis is never used as the authoritative store for inventory.
- [ ] Redis locks are not used for correctness-critical business operations.
- [ ] Cache keys contain the required ownership/scope dimensions.
- [ ] Cache invalidation is defined when caching is introduced.
- [ ] Cache TTL is explicitly defined.
- [ ] Redis failures do not unnecessarily take down the API.
- [ ] Redis Pub/Sub is treated as ephemeral.
- [ ] Durable events remain in PostgreSQL/outbox/PgBoss.
- [ ] Production code does not use Redis `KEYS`.
- [ ] Redis Pub/Sub channels are separate from cache key naming.
- [ ] Sensitive data is not unnecessarily cached.

## Tier 2 — End-of-Phase Gate

- [ ] Cold-cache behavior works.
- [ ] Cache expiration works.
- [ ] Cache invalidation works after writes.
- [ ] Redis outage fallback works where required.
- [ ] New Redis usage has a demonstrated purpose.
- [ ] Speculative caching is removed.
- [ ] Large cache payload serialization is reviewed.
- [ ] Sensitive cached data is reviewed.
- [ ] Hot keys are identified.

## Tier 3 — Pre-Production Gate

- [ ] Redis memory policy is configured.
- [ ] Redis connection behavior is tested under load.
- [ ] Redis latency is measured.
- [ ] Cache hit/miss behavior is observable.
- [ ] Redis degradation is tested.
- [ ] Pub/Sub behavior is tested with multiple application instances.

---

# 10. Section 8 — Database & Resource Management

## Tier 1 — Build-in

- [ ] Every new table has appropriate foreign keys.
- [ ] Foreign-key columns are indexed where query patterns require it.
- [ ] Common lookup/filter columns are indexed.
- [ ] Unique business invariants have DB constraints.
- [ ] Transactions are used where atomicity is required.
- [ ] No external HTTP calls happen inside DB transactions.
- [ ] No email calls happen inside DB transactions.
- [ ] No slow Redis operations happen inside critical transactions.
- [ ] Outbox is used for reliable post-transaction side effects.
- [ ] Database timeouts are respected.
- [ ] Queries are bounded.
- [ ] Large datasets are paginated.
- [ ] Money values use appropriate numeric representation.
- [ ] Order records preserve required historical snapshots.
- [ ] Product price changes do not rewrite historical order prices.

## Tier 2 — End-of-Phase Gate

- [ ] Important new queries are inspected with `EXPLAIN ANALYZE`.
- [ ] Slow queries are investigated.
- [ ] Sequential scans on important large tables are investigated.
- [ ] Connection pool sizing is reviewed when workload grows.
- [ ] Lock contention is reviewed.
- [ ] Transaction duration is reviewed.
- [ ] Migrations run successfully from a clean database.
- [ ] Existing migrations remain intact.
- [ ] Seed data still works.

## Tier 3 — Pre-Production Gate

- [ ] Connection exhaustion is tested.
- [ ] PostgreSQL pool pressure is measured.
- [ ] Database behavior under high concurrency is tested.
- [ ] Long-running query behavior is tested.
- [ ] Backup/recovery strategy is verified according to deployment environment.
- [ ] Production database migration procedure is tested.

---

# 11. Section 9 — Background Jobs & Async Processing

## Tier 1 — Build-in

- [ ] Long-running operations are not unnecessarily performed in HTTP requests.
- [ ] PgBoss is used for durable asynchronous work.
- [ ] Domain state is committed before dependent background work executes.
- [ ] Reliable domain side effects use the outbox pattern where required.
- [ ] New job handlers are idempotent.
- [ ] Duplicate job execution is safe.
- [ ] Job payloads contain the context required to perform the operation.
- [ ] Workers verify entity state before applying changes.
- [ ] Jobs do not trust stale client state.
- [ ] Job failures leave domain data recoverable.
- [ ] Retries do not duplicate emails, notifications, payments, embeddings, etc.
- [ ] Job handlers remain small and delegate business logic to services.

## Tier 2 — End-of-Phase Gate

- [ ] Failed jobs can retry safely.
- [ ] Job concurrency is appropriate.
- [ ] Queue backpressure is understood.
- [ ] Pending/failed jobs can be inspected.
- [ ] Outbox delivery works.
- [ ] Duplicate job execution is tested.
- [ ] Job timeout behavior is tested.
- [ ] Worker registration remains centralized.
- [ ] New jobs have clear ownership and naming.

## Tier 3 — Pre-Production Gate

- [ ] Multiple worker instances are tested.
- [ ] Duplicate processing is tested.
- [ ] Failure injection is performed.
- [ ] DB-unavailable behavior is tested.
- [ ] Redis-unavailable behavior is tested.
- [ ] Job handler failure/retry behavior is tested.
- [ ] Large job backlog is tested.
- [ ] Queue recovery after worker restart is tested.

---

# 12. Section 10 — Observability

## Tier 1 — Build-in

- [ ] Every request has a request/correlation ID.
- [ ] Structured logging is used.
- [ ] No `console.log` in production code.
- [ ] Module loggers are used consistently.
- [ ] Important lifecycle events are logged.
- [ ] Errors are logged with useful context.
- [ ] Secrets are redacted.
- [ ] Passwords/tokens are never logged.
- [ ] Sensitive customer data is not unnecessarily logged.
- [ ] Important financial/order state changes are auditable.
- [ ] Background job failures are observable.

## Tier 2 — End-of-Phase Gate

- [ ] New error paths are observable.
- [ ] Database failures are observable.
- [ ] Worker failures are observable.
- [ ] Queue state can be inspected.
- [ ] Important WebSocket/realtime failures are observable.
- [ ] AI/search failures are observable.
- [ ] Payment failures are observable.
- [ ] No noisy debug logging remains in production paths.
- [ ] Logs contain enough context to diagnose a failed request.

## Tier 3 — Pre-Production Gate

- [ ] Production metrics backend is configured if required.
- [ ] p50/p95/p99 latency is measurable.
- [ ] Error rate is measurable.
- [ ] Database latency is measurable.
- [ ] Redis latency/hit rate is measurable.
- [ ] Queue health is measurable.
- [ ] CPU/memory behavior is observable.
- [ ] Event-loop health can be investigated.
- [ ] Production alerts exist for critical failures.

---

# 13. Section 11 — Realtime & WebSockets

## Tier 1 — Build-in

- [ ] WebSocket authentication is enforced.
- [ ] A user can only subscribe to their own private channel.
- [ ] Seller events are scoped to the correct seller/user.
- [ ] Realtime events do not become the source of truth.
- [ ] Event payloads contain stable event types.
- [ ] Events use the project realtime envelope.
- [ ] Redis Pub/Sub is used for cross-instance fanout where needed.
- [ ] DB/outbox/PgBoss remain responsible for durability.
- [ ] WebSocket disconnects do not corrupt business state.
- [ ] Client reconnect behavior is considered.
- [ ] Notifications remain persisted even if the user is offline.

## Tier 2 — End-of-Phase Gate

- [ ] Test reconnect behavior.
- [ ] Test duplicate realtime delivery.
- [ ] Test offline user notification behavior.
- [ ] Test order status updates.
- [ ] Test seller/customer event isolation.
- [ ] Test multiple browser sessions for the same user.
- [ ] Verify Redis Pub/Sub failures do not corrupt DB state.

## Tier 3 — Pre-Production Gate

- [ ] Multiple API instances can deliver realtime events correctly.
- [ ] Concurrent WebSocket connections are load-tested.
- [ ] Reconnect storms are considered.
- [ ] Redis Pub/Sub degradation is tested.
- [ ] No cross-user event leakage occurs under load.

---

# 14. Section 12 — Search & AI Safety

## Tier 1 — Build-in

- [ ] Backend remains authoritative over product existence.
- [ ] Backend remains authoritative over price.
- [ ] Backend remains authoritative over stock.
- [ ] Backend remains authoritative over availability.
- [ ] Backend remains authoritative over authorization.
- [ ] LLM output is treated as untrusted intent/input.
- [ ] Structured AI filters are validated before database use.
- [ ] Search filters are enforced by PostgreSQL/backend logic.
- [ ] AI cannot invent products as real search results.
- [ ] Product results come from the database.
- [ ] AI explanations reference actual retrieved products.
- [ ] AI input length is bounded.
- [ ] AI output is bounded.
- [ ] AI failures have a non-AI fallback where practical.
- [ ] pgvector is optional enhancement, not the correctness layer.
- [ ] Semantic search is combined with hard SQL filters where necessary.
- [ ] Embedding generation is asynchronous when appropriate.

## Tier 2 — End-of-Phase Gate

- [ ] Natural-language search returns real products.
- [ ] Filters are actually enforced.
- [ ] Out-of-stock products are handled correctly.
- [ ] Price filters are correct.
- [ ] Category filters are correct.
- [ ] AI cannot bypass authorization.
- [ ] AI cannot expose private seller/customer data.
- [ ] Embedding jobs retry safely.
- [ ] Search ranking is reviewed against realistic queries.
- [ ] AI fallback behavior works.
- [ ] Prompt/input limits are tested.

## Tier 3 — Pre-Production Gate

- [ ] AI failure/degradation behavior is tested.
- [ ] Search performance is load-tested.
- [ ] Vector search performance is measured if enabled.
- [ ] AI cost/usage is measured.
- [ ] AI abuse/rate limits are finalized.
- [ ] Prompt-injection risks are reviewed.
- [ ] AI responses are verified not to fabricate marketplace facts.
- [ ] Search quality is manually reviewed using representative customer queries.

---

# 15. Section 13 — Payments, Orders & Financial Integrity

## Tier 1 — Build-in

- [ ] Client cannot determine the final order total.
- [ ] Product price is read from PostgreSQL.
- [ ] Discounts/coupons are validated server-side.
- [ ] Shipping costs are calculated server-side.
- [ ] Order totals are calculated server-side.
- [ ] Historical order item prices are snapshotted.
- [ ] Payment state transitions are transactional.
- [ ] Payment callbacks/webhooks are idempotent.
- [ ] Duplicate payment notifications are harmless.
- [ ] Raw card details are never stored.
- [ ] Test/COD payment flows remain clearly separated from real payment providers.
- [ ] Refunds cannot exceed valid refundable amounts.
- [ ] Cancellation/refund rules are enforced server-side.

## Tier 2 — End-of-Phase Gate

- [ ] Checkout happy path passes.
- [ ] Failed payment path passes.
- [ ] Duplicate payment callback passes.
- [ ] Cancellation path passes.
- [ ] Refund path passes where implemented.
- [ ] Order totals are verified against line items.
- [ ] Inventory changes are verified against orders.
- [ ] Payment/order status consistency is reviewed.

## Tier 3 — Pre-Production Gate

- [ ] Payment provider production configuration is verified if applicable.
- [ ] Webhook security is verified.
- [ ] Payment retry behavior is tested.
- [ ] Refund behavior is tested.
- [ ] Financial audit trail is verified.
- [ ] No financial operation can be double-applied.

---

# 16. Section 14 — Seller Marketplace Integrity

## Tier 1 — Build-in

- [ ] Sellers can only modify their own products.
- [ ] Sellers can only modify their own variants.
- [ ] Sellers can only modify their own inventory.
- [ ] Seller prices are validated server-side.
- [ ] Seller stock is validated server-side.
- [ ] Seller order visibility is scoped correctly.
- [ ] Seller cannot manipulate another seller's order items.
- [ ] Seller cannot modify historical order prices.
- [ ] Product publication state is server-controlled.
- [ ] Seller ownership is checked inside mutation transactions where necessary.

## Tier 2 — End-of-Phase Gate

- [ ] Seller product CRUD tested.
- [ ] Seller inventory tested.
- [ ] Seller order management tested.
- [ ] Seller shipping flow tested.
- [ ] Seller ownership negative tests pass.
- [ ] Seller/customer visibility is reviewed.
- [ ] Seller-specific notifications are verified.

## Tier 3 — Pre-Production Gate

- [ ] Multi-seller concurrent workloads are tested.
- [ ] Seller isolation is tested under load.
- [ ] Seller inventory/order consistency is verified.
- [ ] No seller can access another seller's private data.

---

# 17. Section 15 — Notifications

## Tier 1 — Build-in

- [ ] Important notifications are persisted in PostgreSQL.
- [ ] WebSocket delivery is treated as realtime enhancement.
- [ ] Offline users still have persisted notifications.
- [ ] Notification creation is idempotent where required.
- [ ] Notification jobs are retry-safe.
- [ ] User ownership is enforced.
- [ ] Notification payloads do not expose unrelated private data.

## Tier 2 — End-of-Phase Gate

- [ ] Notification creation works.
- [ ] Read/unread behavior works.
- [ ] Realtime delivery works.
- [ ] Offline/reconnect behavior works.
- [ ] Duplicate notification behavior is reviewed.
- [ ] Notification jobs retry correctly.

## Tier 3 — Pre-Production Gate

- [ ] Notification backlog is load-tested.
- [ ] WebSocket notification delivery is load-tested.
- [ ] Multiple application instances are tested.
- [ ] Notification failures do not corrupt business state.

---

# 18. Section 16 — Load, Stress & Failure Testing

> **This section is Tier 3 only.**
>
> Do not spend the 24-hour implementation window performing full production-scale stress testing after every phase.

Before production:

- [ ] Normal-load API test completed.
- [ ] High-concurrency API test completed.
- [ ] Peak/spike test completed.
- [ ] Concurrent checkout tested.
- [ ] Concurrent inventory updates tested.
- [ ] Duplicate request test completed.
- [ ] Duplicate payment callback test completed.
- [ ] Cold-cache test completed.
- [ ] Warm-cache test completed.
- [ ] Redis degradation tested.
- [ ] PostgreSQL pressure tested.
- [ ] Worker pressure tested.
- [ ] Large queue backlog tested.
- [ ] Multiple API instances tested.
- [ ] Multiple worker instances tested.
- [ ] WebSocket concurrency tested.
- [ ] AI/search workload tested.
- [ ] No unacceptable data corruption observed.
- [ ] No cross-user or cross-seller data leakage observed.
- [ ] Major performance bottlenecks identified and addressed.

---

# 19. Section 17 — Final Quality Gate

## Tier 1 — Build-in

After every implementation chunk:

- [ ] TypeScript passes.
- [ ] Lint passes.
- [ ] Relevant unit tests pass.
- [ ] Relevant integration tests pass where available.
- [ ] No blocking TODOs remain.
- [ ] No debug code remains.
- [ ] No secrets are committed.
- [ ] PostgreSQL remains authoritative.
- [ ] Redis remains an acceleration/realtime layer.
- [ ] PgBoss remains the durable job mechanism.
- [ ] Existing outbox architecture is not bypassed.
- [ ] Existing functionality still works.
- [ ] Phase scope remains controlled.

## Tier 2 — End-of-Phase Gate

Before starting the next phase:

- [ ] Full relevant integration tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] Database migrations work.
- [ ] Seed data works.
- [ ] New API routes are registered.
- [ ] New API routes are validated.
- [ ] Authorization is verified.
- [ ] Ownership isolation is verified.
- [ ] New concurrency cases are tested.
- [ ] Important queries are reviewed.
- [ ] New jobs are tested.
- [ ] Realtime behavior is tested if introduced.
- [ ] AI behavior is tested if introduced.
- [ ] No critical/high security issue remains.
- [ ] No critical data-integrity issue remains.
- [ ] No unrelated architectural refactor was introduced.
- [ ] Existing phase behavior has not regressed.
- [ ] `.agent-logs/` is updated where required.
- [ ] Phase commit is created before moving to the next phase.

## Tier 3 — Pre-Production Gate

- [ ] Full test suite passes.
- [ ] Security tests pass.
- [ ] Ownership/isolation tests pass.
- [ ] Concurrency tests pass.
- [ ] Load tests pass.
- [ ] Performance baseline is documented.
- [ ] Database behavior is verified under load.
- [ ] Redis behavior is verified under load.
- [ ] PgBoss behavior is verified under load.
- [ ] WebSocket behavior is verified under load.
- [ ] AI/search behavior is verified.
- [ ] Payment flow is verified.
- [ ] Production environment variables are verified.
- [ ] No secrets are exposed.
- [ ] Health endpoint works.
- [ ] Readiness endpoint works.
- [ ] Graceful shutdown works.
- [ ] Public deployment works.
- [ ] Unauthenticated stranger can open the production URL.
- [ ] Core customer journey works from a clean browser.
- [ ] Seller journey works.
- [ ] AI shopping journey works.
- [ ] Realtime order/notification journey works.
- [ ] Public repository is available.
- [ ] `.agent-logs/` is committed.
- [ ] Final walkthrough is ready.
- [ ] Production-readiness review is complete.

---

# 20. Quick Reference — Every Chunk

## Tier 1 — Build-in

| Category       | Must Do                                                           |
| -------------- | ----------------------------------------------------------------- |
| Performance    | No N+1, bounded queries, pagination, indexed filters              |
| Concurrency    | Transactions, locks where needed, unique constraints, idempotency |
| API            | Zod validation, consistent responses, stable errors, safe DTOs    |
| Ownership      | Authenticated user/seller ownership enforced server-side          |
| Auth           | Every protected route has correct authorization                   |
| Input Security | Validate all external input, parameterized SQL                    |
| Database       | FKs, indexes, constraints, bounded queries                        |
| Redis          | PostgreSQL remains truth, safe cache/realtime usage               |
| Jobs           | PgBoss, idempotent handlers, durable event pattern                |
| Observability  | Structured logs, request IDs, no secrets                          |
| Realtime       | Authenticated channels, persisted notifications                   |
| AI             | Backend validates/enforces all product/business facts             |
| Payments       | Server-side totals, idempotent payment state                      |
| Seller         | Ownership enforced on every seller mutation                       |
| Quality        | Typecheck/lint/tests clean                                        |

---

# 21. Quick Reference — End of Every Phase

## Tier 2 — Phase Gate

| Category    | Must Do                                                    |
| ----------- | ---------------------------------------------------------- |
| Performance | Review hot paths, indexes, query plans, cache behavior     |
| Concurrency | Concurrent mutation tests, race review, lock review        |
| API         | Route inventory, schemas, malformed-input tests            |
| Ownership   | Cross-user and cross-seller negative tests                 |
| Auth        | RBAC/authorization review and escalation tests             |
| Security    | Resource exhaustion, payload and sensitive-data review     |
| Redis       | Cache invalidation/miss/failure behavior                   |
| Database    | EXPLAIN ANALYZE, slow queries, migrations                  |
| Jobs        | Retry behavior, concurrency, backpressure                  |
| Realtime    | Reconnect and event isolation tests                        |
| AI          | Real product results, validated filters, fallback behavior |
| Payments    | Checkout/payment/order consistency                         |
| Seller      | Seller ownership and order boundaries                      |
| Quality     | Full relevant integration suite, build, no regressions     |

---

# 22. Quick Reference — Before Production

## Tier 3 — Pre-Production Gate

| Category      | Must Do                                                   |
| ------------- | --------------------------------------------------------- |
| Performance   | Load testing, p50/p95/p99, realistic data                 |
| Concurrency   | Concurrent checkout, inventory, payment and workers       |
| API           | Contract tests and high-load edge cases                   |
| Ownership     | Cross-user/seller isolation under load                    |
| Auth          | Full auth/session/security review                         |
| Redis         | Memory, latency, connection and degradation testing       |
| Database      | Pool pressure, connection exhaustion, recovery            |
| Jobs          | Multi-worker, retries, failure injection                  |
| Realtime      | Multi-instance WebSocket testing                          |
| AI            | Quality, safety, rate/cost and degradation testing        |
| Payments      | Production payment/webhook/retry verification             |
| Seller        | Multi-seller workload and isolation                       |
| Observability | Metrics, logs, errors and latency visible                 |
| Deployment    | Health, readiness, shutdown, environment verification     |
| Launch        | Public URL, public repo, `.agent-logs`, final walkthrough |

---

# 23. Agent Execution Rule

The coding agent must follow this sequence for **every phase**:

```text
READ PHASE
    ↓
READ THIS CHECKLIST
    ↓
INSPECT CURRENT REPOSITORY
    ↓
IDENTIFY EXISTING PATTERNS
    ↓
IMPLEMENT PHASE CHUNK
    ↓
APPLY ALL RELEVANT TIER-1 RULES
    ↓
RUN TYPECHECK / LINT / RELEVANT TESTS
    ↓
FIX FAILURES
    ↓
CONTINUE NEXT CHUNK
    ↓
PHASE COMPLETE
    ↓
RUN TIER-2 PHASE GATE
    ↓
FIX ALL BLOCKING ISSUES
    ↓
RUN FULL RELEVANT TESTS
    ↓
COMMIT PHASE
    ↓
START NEXT PHASE
```

### Important

The agent must **not** interpret this checklist as a reason to over-engineer.

If a checklist item is not relevant to the feature being implemented:

- do not invent infrastructure for it;
- do not add unnecessary abstractions;
- do not add a new service;
- do not add a new dependency;
- do not create speculative caching;
- do not create speculative queues;
- do not introduce microservices;
- do not build infrastructure solely to satisfy a checklist checkbox.

Instead, mark the item **N/A for this phase/chunk** when appropriate.

---

# 24. What the Agent Must Never Do

Do not introduce these merely for production-readiness:

- Kafka
- RabbitMQ
- Temporal
- NATS
- Elasticsearch/OpenSearch
- Microservices
- Separate notification service
- Separate WebSocket service
- API gateway
- Dedicated event platform
- Generic workflow engine
- Generic repository framework
- Generic permission framework
- Distributed locks for ordinary business correctness
- Redis as a database
- AI as a source of product truth
- Premature sharding
- Premature read replicas
- Premature caching
- Complex observability infrastructure without a real requirement

The current architecture is intentionally:

```text
PostgreSQL
    ↓
Source of truth

PgBoss
    ↓
Durable background work

Redis
    ↓
Cache + ephemeral realtime fanout

WebSocket
    ↓
Live browser delivery

pgvector
    ↓
Semantic product retrieval

AI
    ↓
Intent understanding + explanation

Backend
    ↓
Validation + authorization + business truth
```

---

# 25. Phase Completion Rule

A phase is **COMPLETE** only when:

```text
Implementation complete
        +
Tier 1 satisfied
        +
Tier 2 gate passed
        +
Tests pass
        +
Build passes
        +
Migrations pass
        +
No critical/high blocker
        +
Existing functionality still works
        +
Phase committed
```

Tier 3 does **not** block individual phases.

Tier 3 blocks **production launch**.

---

# 26. Final Mental Model

When the agent is implementing any feature, remember:

> **Build correctness into the feature.**

When the agent finishes a phase, remember:

> **Prove the complete phase works before moving forward.**

Before production, remember:

> **Test the complete system under realistic conditions.**

The three tiers therefore mean:

```text
TIER 1
BUILD IT RIGHT
    ↓
TIER 2
PROVE THE PHASE
    ↓
TIER 3
PROVE THE SYSTEM
    ↓
PRODUCTION
```

**PostgreSQL = truth.**

**PgBoss = durable work.**

**Redis = acceleration + ephemeral realtime.**

**WebSocket = live delivery.**

**Backend = business authority.**

**AI = assistant, never source of truth.**

**Tier 1 = always.**

**Tier 2 = every phase.**

**Tier 3 = once before production.**

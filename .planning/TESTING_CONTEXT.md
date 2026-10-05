# Amazon Clone — API Integration Testing Standard

**Status:** Mandatory
**Audience:** AI coding agents and developers writing, reviewing, or modifying backend tests
**Scope:** Backend API routes, services, persistence, asynchronous behavior, security boundaries, and cross-module integration
**Primary integration test location:** `tests/integration/`
**Primary unit test location:** `tests/unit/`

---

# 1. Purpose

This document is the mandatory testing contract for the Amazon Clone backend.

An AI coding agent MUST read and follow this document before creating, modifying, or reviewing backend tests.

The objective is **behavioral correctness**, not merely endpoint coverage or line coverage.

A route or backend operation is adequately tested only when all **applicable** behavior has been considered.

Depending on the operation, this includes:

- happy paths
- validation failures
- authentication failures
- authorization failures
- customer ownership
- seller ownership
- product ownership
- cart ownership
- order ownership
- resource isolation
- business rules
- inventory rules
- price integrity
- state transitions
- database invariants
- transaction/rollback behavior
- idempotency
- duplicate requests
- concurrency
- transactional outbox behavior
- PgBoss/background jobs
- Redis/cache behavior
- WebSocket/realtime behavior
- external dependency failures
- payment failures
- security boundaries
- error contracts
- information leakage
- observability behavior

Do **not** mechanically create every category for every trivial route.

The agent MUST determine which categories apply to the operation and explicitly cover every applicable category.

---

# 2. Core Testing Philosophy

The goal is not:

```text
"Does this endpoint return 200?"
```

The goal is:

```text
"Can this marketplace operation be trusted when

valid input is supplied,
invalid input is supplied,
the user is unauthenticated,
the user is unauthorized,
the user does not own the resource,
the seller does not own the product,
inventory changes,
the price changes,
the request is repeated,
two requests happen simultaneously,
the database operation fails,
Redis fails,
a background job fails,
an event is duplicated,
a payment callback is repeated,
or an external dependency fails?"
```

A production-quality test proves the **business invariant**, not merely the HTTP response.

---

# 3. Amazon Clone Testing Architecture

## 3.1 Application stack

The backend uses:

```text
Node.js
TypeScript
Fastify
Zod
Drizzle ORM
PostgreSQL / Neon
Redis / ioredis
PgBoss
Transactional Outbox
WebSocket
pgvector
OpenAI
Pino structured logging
```

The exact project structure MUST be inspected before adding tests.

The expected backend architecture is:

```text
Fastify
   │
   ├── PostgreSQL
   ├── Redis
   ├── PgBoss
   ├── WebSocket
   ├── Transactional Outbox
   └── External services
```

---

# 4. Integration Tests Are the Default for API Routes

Route integration tests MUST exercise the real Fastify application.

Preferred pattern:

```text
createTestApp()
      ↓
buildApp()
      ↓
app.ready()
      ↓
app.inject()
```

Tests MUST NOT bypass the application lifecycle merely to make tests easier.

Do NOT:

- instantiate route handlers directly
- construct fake Fastify requests
- construct fake Fastify replies
- bypass authentication hooks
- bypass authorization hooks
- bypass validation
- bypass serialization
- bypass Fastify error handling
- replace the complete middleware chain with mocks
- test only service functions when the behavior being tested belongs to the HTTP/API layer

The purpose of route integration tests is to exercise the same application path used in production.

This catches:

- incorrect route registration
- incorrect HTTP paths
- middleware ordering errors
- authentication failures
- authorization failures
- Zod validation failures
- serialization problems
- Fastify error-handler behavior
- plugin registration issues
- security middleware problems
- rate limiting
- body limits
- application configuration problems

---

# 5. Unit Tests vs Integration Tests

## 5.1 Unit tests

Unit tests belong in:

```text
tests/unit/
```

Use unit tests for deterministic isolated logic such as:

- password hashing/verification
- pure validation utilities
- price calculations
- subtotal calculations
- discount calculations
- tax calculations
- pagination utilities
- status transition predicates
- search query parsing
- AI intent parsing
- ranking utilities
- pure transformations
- embedding text construction
- other deterministic functions without Fastify/database lifecycle dependencies

If logic can be extracted into a pure function, it MAY be tested independently.

Do NOT create mocked Fastify request/reply tests merely to increase coverage.

---

## 5.2 Integration tests

Integration tests belong in:

```text
tests/integration/
```

Use integration tests for:

- API routes
- authentication
- authorization
- customer ownership
- seller ownership
- product ownership
- cart behavior
- checkout
- orders
- inventory
- payments
- fulfillment
- reviews
- notifications
- database persistence
- transactions
- state transitions
- Redis behavior where externally observable
- PgBoss integration
- outbox behavior
- WebSocket/realtime behavior
- cross-module behavior
- concurrency
- security boundaries
- error handling
- complete request/response behavior

---

# 6. Real Infrastructure Policy

Integration tests SHOULD use real infrastructure whenever the project test environment provides it.

Expected architecture:

```text
Fastify
   │
   ├── PostgreSQL
   ├── Redis
   └── PgBoss
```

The integration suite MUST NOT silently replace production-like infrastructure with:

- SQLite
- an in-memory database
- mocked Drizzle
- mocked PostgreSQL
- mocked transactions
- mocked Redis
- fake database constraints

unless the test is specifically an isolated unit test.

Real PostgreSQL matters because production behavior depends on:

- foreign keys
- unique constraints
- indexes
- CHECK constraints
- transactions
- row locking
- `FOR UPDATE`
- concurrent writes
- numeric/decimal behavior
- PostgreSQL query semantics
- PgBoss persistence
- outbox persistence

---

# 7. Database Isolation

The test database isolation strategy defined by the project MUST be respected.

If the project uses randomized identifiers/run IDs, continue using them.

Preferred:

```ts
const runId = crypto.randomUUID();
```

Use the run ID in test-owned unique values such as:

```text
email
slug
product SKU
seller identifier
coupon code
order reference
external payment reference
idempotency key
conversation identifier
```

Do NOT introduce global database truncation/reset behavior merely to make tests easier.

Do NOT replace the existing isolation strategy without explicit architectural approval.

---

# 8. The Unscoped Query Hazard

Randomized identifiers isolate rows.

They do NOT isolate aggregate queries.

This is dangerous:

```sql
SELECT COUNT(*) FROM orders;
```

because the database may contain data from previous tests or test runs.

Avoid unscoped:

```text
COUNT(*)
SELECT *
ORDER BY ...
LIMIT ...
"latest row"
"no rows exist"
```

when the assertion concerns data created by the current test.

Prefer:

```text
WHERE runId = ...
WHERE userId = ...
WHERE sellerId = ...
WHERE orderId = ...
WHERE productId = ...
```

depending on the behavior being tested.

A test MUST NOT pass merely because old test data happens to satisfy an assertion.

---

# 9. Mandatory Fixture Scope

Every new fixture helper MUST accept an appropriate scope.

Possible scopes include:

```text
runId
userId
sellerId
productId
variantId
cartId
orderId
conversationId
resourceId
```

Example:

```ts
await findOrder({
  userId,
  orderId,
});
```

is preferable to:

```ts
await findLatestOrder();
```

Likewise:

```ts
await findNotifications({
  userId,
  runId,
});
```

is preferable to:

```ts
await findAllNotifications();
```

Fixtures MUST make ownership and relationships explicit.

---

# 10. Mandatory Pre-Test Audit

Before adding a fixture or database assertion, inspect existing helpers for:

- unscoped `COUNT(*)`
- unscoped `SELECT`
- unscoped `ORDER BY ... LIMIT`
- "latest record" helpers
- global "no rows exist" helpers
- queries that do not filter by user/seller/resource/run ID
- hidden global state

If an unrelated unsafe helper is discovered:

1. identify it
2. avoid relying on it
3. report it
4. fix it only if the current task explicitly includes testing-infrastructure hardening

Do not silently rewrite unrelated infrastructure.

---

# 11. Route Testing Matrix

For every route, determine applicability across these dimensions:

```text
                         ROUTE
                           │
          ┌────────────────┼────────────────┐
          ↓                ↓                ↓
        INPUT           IDENTITY          STATE
          │                │                │
          ↓                ↓                ↓
     Validation       AuthN/AuthZ      Transitions
     Boundaries       Ownership        Idempotency
          │                │                │
          └────────────────┼────────────────┘
                           ↓
                     BUSINESS RULES
                           ↓
                       DATABASE
                           ↓
             ┌─────────────┼─────────────┐
             ↓             ↓             ↓
        Transaction      Events        Cache
             ↓             ↓             ↓
           Rollback      Outbox        Redis
             ↓             ↓             ↓
          Jobs/PgBoss  WebSocket     Notifications
             └─────────────┼─────────────┘
                           ↓
                     CONCURRENCY
                           ↓
                 EXTERNAL FAILURES
                           ↓
                      SECURITY
                           ↓
                   OBSERVABILITY
```

The agent MUST NOT stop after proving that the happy path returns `200` or `201`.

---

# 12. Functional Correctness

Every route MUST have a valid-path test when a valid path exists.

The happy-path test MUST verify more than HTTP status.

Where applicable verify:

- HTTP status
- response shape
- returned identifiers
- returned fields
- persisted database state
- relationships
- calculated values
- status
- timestamps where meaningful
- inventory changes
- price/subtotal/total
- side effects
- outbox events
- jobs
- notifications
- realtime events
- cache invalidation

Example:

```text
POST /orders

       ↓

201

       ↓

order returned

       ↓

order persisted

       ↓

order items persisted

       ↓

price snapshot correct

       ↓

inventory updated

       ↓

payment state correct

       ↓

outbox event created

       ↓

notification/job behavior correct
```

---

# 13. Input Validation

For every request field, consider:

## Required fields

Test:

- missing
- `null`
- empty string
- whitespace-only where relevant
- wrong type
- malformed value

## Strings

Test:

- minimum valid length
- maximum valid length
- below minimum
- above maximum
- unexpected whitespace
- invalid format
- Unicode where relevant

## Numbers / money

Test:

- zero
- negative
- minimum
- maximum
- just below minimum
- just above maximum
- decimal values
- excessive precision
- extremely large values

For monetary values, verify the application's intended decimal representation.

Do not introduce floating-point assumptions into tests if the production model uses numeric/decimal values.

## Arrays

Test:

- missing
- empty
- one item
- maximum size
- above maximum
- duplicates
- malformed elements

## Objects

Test:

- missing
- empty
- malformed nested object
- unexpected fields
- privileged fields

---

# 14. Client-Controlled Privileged Fields

Clients MUST NOT be able to modify server-controlled fields simply by adding them to the request body.

Test payloads containing fields such as:

```json
{
  "userId": "other-user",
  "sellerId": "other-seller",
  "role": "ADMIN",
  "status": "DELIVERED",
  "price": 1,
  "total": 1,
  "stock": 999999,
  "createdAt": "...",
  "approvedBy": "attacker"
}
```

The API MUST either:

- reject them, or
- ignore them

according to the contract.

The client MUST NOT gain privileges or bypass business rules.

---

# 15. Authentication Testing

Protected routes MUST test authentication.

## No credentials

```text
No Authorization header
No authentication cookie
        ↓
401
```

## Invalid credentials

Consider:

- malformed JWT
- invalid signature
- expired token
- tampered token
- invalid bearer format
- invalid session
- revoked session

## User lifecycle

Where applicable test:

- deleted user
- disabled user
- revoked session
- expired session

---

# 16. Authentication Source Ambiguity

If the application supports multiple authentication mechanisms, inspect the implementation.

For example:

```text
Authorization: Bearer <token>
```

and/or authentication cookies.

If both credentials are supplied, test the defined precedence/security behavior.

Do NOT assume which credential wins.

---

# 17. Authorization / RBAC

Every protected route MUST consider authorization.

At minimum:

```text
correct permission → allowed

insufficient permission → 403
```

But sensitive operations require deeper testing.

Consider:

- exact permission
- neighboring insufficient permission
- role boundary
- seller/customer boundary
- admin boundary
- permission changes
- stale authorization cache
- privileged seller actions
- customer-only actions

Do not assume a role name automatically proves authorization correctness.

---

# 18. Customer Ownership

Customer-owned resources MUST be tested for horizontal authorization.

Example:

```text
Customer A owns Cart A
Customer B owns Cart B
```

Test:

```text
Customer A → Cart A     ✅
Customer A → Cart B     ❌
Customer B → Cart A     ❌
```

Apply this to:

- carts
- wishlists
- addresses
- orders
- payments
- shipments
- returns
- reviews
- notifications
- conversations
- messages
- saved data
- customer-specific resources

---

# 19. Seller Ownership

Seller resources require a separate ownership boundary.

Example:

```text
Seller A owns Product A
Seller B owns Product B
```

Test:

```text
Seller A → Product A     ✅
Seller A → Product B     ❌
Seller B → Product A     ❌
```

Apply this to:

- product CRUD
- variants
- prices
- inventory
- seller orders
- shipment actions
- seller analytics
- seller-specific data

A seller MUST NOT modify another seller's product, price, inventory, or order data.

---

# 20. Customer/Seller Boundary

A customer account MUST NOT automatically gain seller privileges.

A seller account MUST NOT automatically gain access to another customer's private information.

Test:

```text
Customer → customer resource     ✅
Customer → seller-only action     ❌

Seller → owned seller resource    ✅
Seller → unrelated customer data  ❌
```

Admin access MUST be tested separately where applicable.

---

# 21. IDOR / Resource Enumeration

For resource routes:

```text
GET /resource/:id
PATCH /resource/:id
DELETE /resource/:id
POST /resource/:id/...
```

test:

- own resource ID
- another user's resource ID
- another seller's resource ID
- nonexistent ID
- malformed ID

Do not assume UUIDs prevent IDOR.

Authorization MUST be enforced regardless of identifier format.

---

# 22. Product Ownership and Catalog Integrity

Seller product routes MUST verify that:

```text
sellerId
```

comes from authenticated seller context rather than blindly trusting the request.

Test attempts to:

- create a product for another seller
- update another seller's product
- delete another seller's product
- modify another seller's inventory
- modify another seller's price
- publish another seller's product

The server MUST derive authoritative ownership from authenticated context.

---

# 23. Cart Isolation

Cart operations are customer-specific.

Test:

```text
Customer A → Cart A
Customer B → Cart B
```

Customer A MUST NOT be able to:

- view Cart B
- modify Cart B
- remove Cart B items
- checkout Cart B
- manipulate Cart B quantities

Test cart behavior for:

- nonexistent product
- nonexistent variant
- inactive product
- unavailable product
- insufficient stock
- zero quantity
- negative quantity
- excessive quantity
- duplicate item
- quantity update
- removal

---

# 24. Price Integrity

Client-submitted prices MUST NOT become authoritative.

Test malicious payloads such as:

```json
{
  "price": 1,
  "unitPrice": 1,
  "subtotal": 1,
  "total": 1
}
```

The backend MUST calculate authoritative monetary values from server-side product/variant data.

Test:

```text
catalog price
      ↓
cart
      ↓
checkout
      ↓
order
```

Verify the client cannot alter the final order price.

---

# 25. Order Price Snapshot

Once an order is created, the order MUST preserve the intended purchase-time pricing.

Where the implementation uses price snapshots, test:

```text
Product price = 100

Create order

Product price = 150

Read existing order
        ↓
order still reflects original purchase price
```

Do not allow later catalog changes to silently rewrite historical order totals.

---

# 26. Inventory Integrity

Inventory is a critical business invariant.

Test:

- zero stock
- positive stock
- insufficient stock
- invalid negative stock
- excessive quantity
- duplicate inventory updates
- concurrent purchases
- cancellation/restock behavior where implemented
- seller ownership
- product/variant ownership

The client MUST NOT be able to set arbitrary stock through customer-facing APIs.

---

# 27. Inventory Concurrency

If two customers attempt to purchase the final available unit concurrently:

```text
Stock = 1

Customer A → checkout
Customer B → checkout
```

the final state MUST NOT produce:

```text
stock = -1
```

or two successful purchases of one unit unless the product explicitly supports such behavior.

Use real concurrent requests where practical:

```ts
await Promise.all([app.inject(requestA), app.inject(requestB)]);
```

Then inspect the final database state.

Sequential tests do NOT prove concurrency correctness.

---

# 28. Checkout Testing

Checkout is one of the highest-priority integration flows.

Test:

```text
valid cart
    ↓
address
    ↓
inventory validation
    ↓
price calculation
    ↓
payment selection
    ↓
order creation
    ↓
inventory update
    ↓
outbox/events
```

Test failure scenarios such as:

- empty cart
- invalid address
- unauthorized address
- unavailable product
- insufficient inventory
- changed price
- invalid coupon
- payment failure
- duplicate checkout
- concurrent checkout
- transaction failure

Verify that failed checkout does not leave invalid partial state.

---

# 29. Checkout Transaction Atomicity

If checkout performs multiple related writes inside one transaction, test atomicity.

For example:

```text
create order
    ↓
create order items
    ↓
reserve/decrement inventory
    ↓
create payment
    ↓
create outbox event
```

If a later operation fails:

```text
transaction failure
        ↓
ROLLBACK
        ↓
no invalid partial order
no partial inventory mutation
no orphan payment
no committed outbox event
```

Where deterministic failure injection is practical, explicitly test it.

If it is impractical, document the limitation rather than falsely claiming rollback coverage.

---

# 30. Order State Machines

Any order lifecycle MUST be tested as a state machine.

Expected implementation may include states such as:

```text
PENDING_PAYMENT
      ↓
CONFIRMED
      ↓
PROCESSING
      ↓
SHIPPED
      ↓
DELIVERED
```

with applicable paths such as:

```text
CANCELLED
RETURN_REQUESTED
RETURNED
REFUNDED
```

The agent MUST inspect the actual implementation before writing exact transition tests.

For every important state test:

### Allowed transition

```text
current → valid next state
```

### Forbidden transition

```text
current → invalid next state
```

### Terminal state

Verify prohibited modifications cannot occur after terminal states.

### Authorization

Verify only the correct actor can perform the transition.

### Side effects

Verify applicable:

- database changes
- inventory changes
- payment changes
- outbox events
- notifications
- jobs
- realtime events

---

# 31. Seller Order Operations

Seller order operations require ownership and state testing.

Test:

```text
Seller A sees Seller A's order items
Seller A cannot manipulate Seller B's order items
```

Test seller actions such as:

- view order
- confirm
- process
- ship
- update fulfillment
- reject/cancel where supported

A seller MUST NOT alter customer-owned payment information or unrelated seller data.

---

# 32. Payment Testing

Payment operations require stronger-than-normal idempotency testing.

Consider:

- successful payment
- failed payment
- declined payment
- invalid payment reference
- duplicate payment request
- duplicate callback/webhook
- repeated webhook
- payment for wrong order
- payment for another user's order
- payment for already-paid order
- payment for cancelled order
- payment amount mismatch

The server MUST derive the authoritative order amount.

The client MUST NOT be able to pay:

```text
order total = 1000
client submits = 1
```

and cause the order to become successfully paid.

---

# 33. Payment Idempotency

Where payment operations are retryable, test:

```text
same request
same idempotency key
same payment reference
same webhook
```

Repeated processing MUST NOT create duplicate financial effects.

Example:

```text
Webhook #1 → payment succeeds

Webhook #2 → same event

Final result:
one payment
one effective state transition
no duplicate order fulfillment
```

---

# 34. No Raw Payment Data

Tests MUST verify that sensitive payment data is not unnecessarily persisted or returned.

Never expose:

- raw card numbers
- CVV
- payment secrets
- authentication credentials
- provider secrets

Use test payment values only at the appropriate provider boundary.

---

# 35. Fulfillment Testing

Shipment/fulfillment operations MUST be tested for:

- correct order ownership
- seller ownership
- valid state transition
- invalid transition
- duplicate shipment action
- shipment creation
- tracking data where applicable
- customer visibility
- notification behavior
- realtime behavior

Example:

```text
PROCESSING → SHIPPED
```

may be valid.

An implementation-defined transition such as:

```text
DELIVERED → PROCESSING
```

should normally be rejected.

Always inspect the actual state machine before asserting exact transitions.

---

# 36. Returns and Refunds

If returns are implemented, test:

- valid return request
- unauthorized return
- wrong customer
- wrong order
- already returned order
- invalid order state
- duplicate return request
- return ownership
- refund creation
- inventory restoration where applicable
- notification
- outbox event
- invalid transition

Advanced return behavior may be lower priority for the 24-hour challenge, but implemented functionality MUST be tested.

---

# 37. Reviews

Review creation MUST consider:

- authenticated user
- order ownership
- product ownership through purchased order
- verified purchase requirement
- rating boundaries
- duplicate review rules
- review modification rules
- review deletion rules
- product existence
- product visibility
- seller/customer boundaries

Test:

```text
Customer purchased Product A → review allowed

Customer never purchased Product A → rejected
```

where verified purchase is part of the implementation.

---

# 38. Notifications

Notifications are durable user-owned resources.

Test:

```text
User A → Notification A
User B → Notification B
```

User A MUST NOT access User B's notifications.

Test:

- notification creation
- list
- unread count
- mark read
- ownership
- duplicate notifications where applicable
- persistence
- realtime delivery
- retry behavior

Do not rely only on WebSocket delivery as proof that the notification exists.

The database is the durable source of truth.

---

# 39. Transactional Outbox

The application uses a transactional outbox for guaranteed asynchronous side effects.

Where a domain mutation creates an outbox event, test:

## Success

```text
business write succeeds
        ↓
outbox event exists
```

Verify:

- event type
- aggregate/resource ID
- user/seller ID where applicable
- payload
- event uniqueness/idempotency information

## Transaction failure

```text
business write fails
        ↓
outbox event not committed
```

The outbox MUST NOT be committed independently of the business transaction.

---

# 40. Outbox Assertion Rules

Never write:

```ts
expect(await countOutboxEvents()).toBe(1);
```

if the helper queries the entire table.

Prefer:

```text
find event for this order
find event for this product
find event for this user
find event for this runId
```

Then assert against that specific event.

For negative tests:

```text
assert no event exists for this resource/action
```

Never:

```text
assert global outbox count === 0
```

---

# 41. PgBoss / Background Jobs

Routes that enqueue asynchronous work MUST be tested for expected job behavior.

Where applicable verify:

```text
route
  ↓
transaction
  ↓
outbox
  ↓
dispatch
  ↓
PgBoss job
```

Test:

- correct job name
- correct payload
- correct resource ID
- correct user/seller ID
- correct idempotency information
- duplicate prevention
- retry behavior
- failure behavior
- worker idempotency

Do not force every route test to execute the entire worker stack.

Route tests can verify enqueue/outbox behavior while dedicated worker integration tests verify execution.

---

# 42. Retry Behavior

Where background work is retryable, test that retrying does not create duplicate business effects.

Example:

```text
attempt 1
    ↓
business effect succeeds
    ↓
acknowledgement fails

attempt 2
    ↓
same job executes
```

Final business state MUST remain correct.

This is especially important for:

- notifications
- email jobs
- payment reconciliation
- embedding generation
- search indexing
- outbox dispatch
- shipment notifications

---

# 43. Redis / Cache Testing

Redis is used for cache/realtime infrastructure where applicable.

For cache-backed behavior consider:

### Cache hit

Expected result remains correct.

### Cache miss

Expected result remains correct.

### Cache invalidation

```text
cached value
    ↓
mutation
    ↓
cache invalidation
    ↓
next read reflects DB
```

### Redis unavailable

For features designed to fail open:

```text
Redis unavailable
    ↓
business operation still works
```

Do not assume every Redis failure must be fatal. Inspect the implementation contract.

---

# 44. Cache Must Never Become an Authorization Boundary

Cached data MUST NOT allow unauthorized access.

Test that cache keys properly isolate:

```text
User A ≠ User B
Seller A ≠ Seller B
Resource A ≠ Resource B
```

If user-specific or seller-specific data is cached, verify the cache key includes the required ownership scope.

A stale cache MUST NOT grant access that the database authorization model would deny.

---

# 45. Realtime / WebSocket Testing

The application uses WebSocket for live browser delivery.

Realtime tests SHOULD verify applicable flows such as:

```text
domain mutation
      ↓
outbox/event
      ↓
Redis Pub/Sub
      ↓
WebSocket
      ↓
correct connected user
```

Expected event envelope:

```ts
type RealtimeEvent<T = unknown> = {
  type: string;
  version: number;
  id: string;
  timestamp: string;
  data: T;
};
```

Test:

- correct event type
- correct recipient
- correct resource ID
- correct payload
- no cross-user delivery
- duplicate event handling where applicable
- reconnect behavior where implemented
- database persistence independent of realtime delivery

Realtime delivery MUST NOT be treated as the durable source of truth.

---

# 46. Realtime Authorization

A connected customer MUST receive only events intended for that customer.

Test:

```text
User A connected
User B connected

Order A changes

User A receives ORDER_* event
User B does not
```

Similarly:

```text
Seller A connected
Seller B connected

Seller A's order changes

Seller A receives event
Seller B does not
```

Cross-user realtime leakage is a security defect.

---

# 47. Search Testing

Search routes MUST test more than "returns products."

Consider:

- empty query
- normal query
- malformed query
- filters
- category filters
- seller filters
- price range
- availability
- pagination
- sorting
- no results
- product visibility
- inactive products
- unpublished products
- invalid filter combinations

Search results MUST respect hard backend constraints.

The search layer MUST NOT expose products the caller should not see.

---

# 48. AI Search Testing

AI-assisted search MUST be tested as an application workflow, not as proof that the LLM generated good prose.

The expected flow is:

```text
user query
    ↓
AI intent extraction
    ↓
structured filters
    ↓
backend validation
    ↓
database search
    ↓
optional pgvector ranking
    ↓
AI explanation
```

Tests MUST verify that the LLM cannot invent:

- nonexistent products
- fake prices
- fake inventory
- unauthorized products
- invalid filters
- fake order state
- fake seller data

The backend remains authoritative for:

```text
product existence
price
stock
availability
ownership
authorization
order state
```

---

# 49. AI Failure Testing

Where AI functionality is implemented, consider:

- malformed model response
- missing structured fields
- invalid filters
- model timeout
- model failure
- empty search result
- irrelevant search result
- provider failure
- conversation persistence failure

The API MUST fail safely.

A model failure MUST NOT cause fabricated product information to be presented as authoritative data.

---

# 50. pgvector Testing

If pgvector search is implemented, test:

- embedding generation
- missing embedding
- product update invalidation/regeneration
- semantic search
- hard SQL filters
- inactive product exclusion
- seller/category constraints
- ranking behavior where deterministic enough to assert
- embedding job failure

Do not make tests depend on exact floating-point vector rankings unless the behavior is explicitly deterministic and contractually important.

Prefer asserting that valid candidates are returned and invalid candidates are excluded.

---

# 51. List and Search Endpoint Isolation

List endpoints can accidentally leak data.

For user-specific resources:

```text
User A → Resource A
User B → Resource B
```

User A's list MUST NOT contain Resource B.

For seller-specific resources:

```text
Seller A → Product A
Seller B → Product B
```

Seller A's management list MUST NOT contain Product B.

Do NOT prove this only with:

```ts
expect(data.length).toBe(1);
```

Prefer resource-specific assertions:

```ts
expect(response.body.data).not.toContainEqual(
  expect.objectContaining({
    id: sellerBProduct.id,
  }),
);
```

---

# 52. Bulk Operations

Bulk operations require additional scrutiny.

For:

```text
bulk update
bulk delete
bulk inventory update
bulk status transition
```

test:

- all IDs belong to allowed owner
- mixed-owner IDs
- nonexistent IDs
- duplicate IDs
- empty input
- maximum input size
- partial failure behavior
- transaction behavior
- authorization

A missing ownership filter in a bulk operation can affect many records at once.

---

# 53. Error Contract

Every meaningful failure path MUST verify:

- HTTP status
- error shape
- stable error code where defined
- message where contractually relevant
- absence of sensitive information

Never expose:

- stack traces
- SQL errors
- database connection information
- filesystem paths
- secrets
- authorization tokens
- cookies
- password hashes
- raw payment credentials
- internal implementation details

---

# 54. Resource Existence Leakage

For protected resources, determine the intended behavior when a resource exists but belongs to another user/seller.

Where the security contract requires indistinguishable responses, test:

```text
nonexistent resource
```

versus:

```text
existing resource belonging to another user
```

and verify that the externally observable response does not unnecessarily reveal resource existence.

Do not expose:

```text
"This order exists but belongs to another customer."
```

unless explicitly intended by the API contract.

---

# 55. Database Invariants

After successful mutations, verify the database state.

Test:

```text
record exists
correct userId
correct sellerId
correct productId
correct variantId
correct orderId
correct status
correct foreign keys
correct price
correct totals
correct inventory
correct timestamps where relevant
```

Also test applicable:

- unique constraints
- CHECK constraints
- foreign keys
- non-null constraints
- partial unique indexes
- database-level invariants

Do not rely only on application validation.

The database is part of production behavior.

---

# 56. Transaction Testing

Whenever an operation performs multiple related writes inside a transaction, test atomicity.

Example:

```text
checkout

create order
    ↓
create order items
    ↓
create payment
    ↓
update inventory
    ↓
create outbox event
```

If a later operation fails:

```text
ROLLBACK
```

must leave no invalid partial state.

Verify:

- order absent or unchanged
- order items absent
- payment absent
- inventory unchanged
- outbox event absent

according to the intended transaction boundary.

---

# 57. Transaction Failure Injection

Where practical, deliberately cause a downstream operation to fail.

Then verify:

```text
primary record absent
dependent records absent
inventory unchanged
payment unchanged
outbox absent
no partial mutation
```

Use deterministic failure mechanisms where available.

Do not create fragile mocks merely to claim rollback coverage.

If deterministic failure injection is impractical, document the limitation.

---

# 58. Idempotency

Any operation that may be retried MUST be evaluated for idempotency.

Consider:

```text
same request
same resource
same idempotency key
same payment event
same webhook
same state transition
same background job
same outbox event
```

Expected behavior MUST follow the API contract.

Important Amazon Clone examples:

- payment
- checkout
- webhook processing
- order transition
- shipment creation
- notification dispatch
- refund
- inventory adjustment
- outbox dispatch
- PgBoss worker execution

Do not automatically assume every POST must be idempotent.

---

# 59. Duplicate Operations

Explicitly test duplicate requests where duplication could cause corruption.

Examples:

```text
checkout twice
pay twice
process same webhook twice
ship order twice
deliver order twice
create duplicate shipment
submit duplicate review
apply same inventory adjustment twice
dispatch same notification twice
process same job twice
```

Verify that database constraints and application logic prevent invalid duplication.

---

# 60. Concurrency

Concurrency testing is mandatory where simultaneous requests can violate a business invariant.

Use actual concurrent requests where possible:

```ts
await Promise.all([app.inject(requestA), app.inject(requestB)]);
```

Then inspect the final database state.

Important hotspots:

- final-unit inventory
- checkout
- payment
- order transitions
- seller inventory updates
- duplicate resource creation
- coupon usage where implemented
- stock reservation where implemented
- concurrent review creation
- idempotency records

Sequential tests do NOT prove concurrency correctness.

---

# 61. Locking

Where the implementation uses PostgreSQL locking, test the business outcome the lock is intended to protect.

Do not merely test that a lock statement exists.

Test:

```text
concurrent operation
       ↓
database lock
       ↓
invariant remains valid
```

For example:

```text
stock = 1

request A
request B

final successful quantity ≤ available inventory
```

---

# 62. Inventory and Financial Data

For inventory and financial operations, test:

- zero values
- positive values
- prohibited negative values
- decimal precision
- large values
- duplicate operations
- reversal behavior
- refund behavior
- concurrent modifications
- derived totals
- ownership
- order association

Never assume a successful HTTP response proves financial correctness.

Verify persisted records and final aggregates.

---

# 63. Coupon Testing

If coupons are implemented, test:

- valid coupon
- invalid coupon
- expired coupon
- inactive coupon
- minimum purchase threshold
- maximum discount
- percentage discount
- fixed discount
- duplicate application
- unauthorized seller/product restrictions where applicable
- usage limits
- concurrent usage
- price manipulation
- checkout recalculation

Do not trust client-submitted discount values.

---

# 64. Rate Limiting

Where rate limiting is implemented, test applicable boundaries:

```text
below limit → succeeds
at limit → expected behavior
above limit → 429
```

For authentication routes, test the stricter authentication-specific limit if one exists.

Do not make the full suite depend on thousands of unnecessary requests if a deterministic limiter test mechanism exists.

---

# 65. Noisy Neighbor Testing

If rate limits or caches are user/seller scoped, verify one actor does not incorrectly consume another actor's allowance or cache.

Example:

```text
User A → exceeds limit

User B → still allowed
```

Likewise:

```text
Seller A cache
≠
Seller B cache
```

---

# 66. Request Body Limits

Where significant request bodies are accepted, test:

```text
small valid payload → success
payload near limit → expected
payload above limit → rejection
```

Do not generate unnecessarily huge payloads if a smaller deterministic boundary test can trigger the configured limit.

---

# 67. Request Timeout

Where timeout behavior is relevant, test that a deliberately slow operation does not hang indefinitely.

Verify:

- expected timeout response
- no corrupted partial state
- transaction cleanup
- no duplicate background operation

Do not use long real sleeps as the primary mechanism.

---

# 68. Security Middleware

Integration tests MUST preserve the real application stack.

Where applicable verify:

- security headers
- CORS behavior
- authentication hooks
- rate limiting
- body limits
- request IDs
- error handling
- cookie security

Do not replace the production application with a minimal route-only server merely to make a test pass.

---

# 69. Cookie Security

Where authentication uses cookies, test:

- valid cookie
- invalid cookie
- tampered signature
- expired session
- revoked session

Never expose cookie values in:

- logs
- snapshots
- assertion output
- test failure messages where avoidable

---

# 70. Sensitive Data Leakage

Integration tests MUST consider accidental leakage of:

```text
password hash
session hash
refresh token
verification token
password reset token
authorization header
cookie
payment credentials
API keys
OpenAI/API secrets
internal database errors
```

Responses MUST contain only data allowed by the API contract.

Sensitive values MUST NOT appear in logs or test output unnecessarily.

---

# 71. Authentication-Specific Tests

For authentication routes, consider:

## Registration

```text
valid registration
duplicate email
invalid email
invalid password
missing fields
password hashing
session creation
verification behavior
outbox behavior
transaction rollback
```

## Login

```text
valid credentials
wrong password
unknown email
rate limiting
session creation
last-login behavior
notification/outbox behavior where applicable
```

## Refresh

```text
valid refresh
expired refresh
invalid refresh
revoked session
rotation
old refresh reuse
concurrent refresh attempts
```

## Email verification

```text
valid token
invalid token
expired token
already verified
token reuse
resend behavior
```

## Password reset

```text
unknown account
valid reset
invalid token
expired token
token reuse
weak password
password change
session invalidation where specified
```

External OAuth providers MUST NOT be called live as part of normal integration tests.

Use deterministic test doubles at the external provider boundary when necessary.

---

# 72. Address Testing

Customer addresses are user-owned resources.

Test:

- create own address
- update own address
- delete own address
- select address for checkout
- another user's address ID
- nonexistent address
- malformed address ID
- required fields
- invalid postal data where validated
- default-address behavior
- duplicate/default conflicts

A customer MUST NOT use another customer's address during checkout.

---

# 73. Order Ownership

Every customer order route MUST test:

```text
Customer A → Order A       ✅
Customer A → Order B       ❌
Customer B → Order A       ❌
```

Seller-specific order access MUST separately verify:

```text
Seller A → relevant order items    ✅
Seller A → Seller B items          ❌
```

Admin behavior MUST be tested separately where applicable.

---

# 74. Search Visibility

Catalog/search tests MUST verify that customers cannot purchase or discover products that are not intended to be public.

Consider:

- unpublished product
- inactive product
- deleted product
- unavailable variant
- zero stock
- seller-disabled product

Search visibility and checkout eligibility may differ. Test both.

---

# 75. Derived Data

Whenever data is derived from another source, verify the relationship.

Examples:

```text
cart subtotal
order subtotal
discount
tax
order total
inventory balance
unread notification count
search index
embedding
seller order totals
```

Test:

```text
source mutation
      ↓
derived data update
```

Do not rely solely on returned HTTP values.

---

# 76. External Services

Never assume external services always succeed.

For external dependencies consider:

```text
success
4xx
5xx
timeout
connection failure
malformed response
duplicate callback
delayed callback
```

The application MUST behave according to its failure contract.

For external services that cannot safely be called during tests:

- use deterministic test doubles at the integration boundary
- keep Fastify/application behavior real
- keep PostgreSQL behavior real
- do not mock the route itself

---

# 77. Email Testing

Email delivery should generally be decoupled from transactional API tests.

A route test should usually verify:

```text
business transaction
+
outbox event/job
```

rather than requiring a real external email delivery.

Dedicated worker tests should verify:

```text
outbox/job
    ↓
email worker
    ↓
email provider boundary
```

Test worker retry behavior where email failure matters.

---

# 78. Observability

Observability is part of production behavior.

The application may use:

- Pino
- request IDs
- structured logging
- OpenTelemetry
- tracing
- sensitive-header redaction

Do not make every integration test assert implementation-specific tracing internals.

Maintain representative observability coverage for:

```text
request
  ↓
request ID
  ↓
important operation
  ↓
error recording
  ↓
structured log
```

Security-sensitive logging MUST NOT expose:

```text
Authorization
Cookie
password
tokens
payment secrets
API keys
```

---

# 79. Regression Testing

When fixing a bug:

1. reproduce the bug with a test
2. verify the test would fail against the broken behavior
3. implement the fix
4. verify the test passes
5. run the relevant regression suite

Do not fix a production bug without adding regression coverage unless technically impossible.

---

# 80. Test Naming

Test names MUST describe behavior.

Prefer:

```text
denies a customer from reading another customer's order
```

over:

```text
returns 403
```

Prefer:

```text
prevents a seller from updating another seller's product
```

over:

```text
seller authorization test
```

Prefer:

```text
rejects concurrent checkout when inventory is exhausted
```

over:

```text
inventory concurrency test
```

Prefer:

```text
does not create a second payment when the same webhook is delivered twice
```

over:

```text
duplicate webhook
```

A test name should tell an engineer which business guarantee is protected.

---

# 81. Test Structure

Prefer behavior-based organization:

```ts
describe("PATCH /api/v1/products/:id", () => {
  describe("authentication", () => {
    // ...
  });

  describe("authorization", () => {
    // ...
  });

  describe("ownership", () => {
    // ...
  });

  describe("validation", () => {
    // ...
  });

  describe("business rules", () => {
    // ...
  });

  describe("persistence", () => {
    // ...
  });

  describe("events", () => {
    // ...
  });
});
```

Organize tests around behavior, not implementation files.

---

# 82. Fixture Rules

Fixtures MUST:

- create only data needed by the test
- use randomized identifiers
- make ownership explicit
- make seller/customer relationships explicit
- avoid hidden global state
- avoid relying on previous tests
- avoid unscoped queries
- avoid unnecessary fixture complexity

Prefer:

```ts
const customerA = await createCustomer({ runId });
const customerB = await createCustomer({ runId });

const sellerA = await createSeller({ runId });
const sellerB = await createSeller({ runId });

const productA = await createProduct({
  sellerId: sellerA.id,
  runId,
});

const productB = await createProduct({
  sellerId: sellerB.id,
  runId,
});
```

This makes security boundaries visible.

---

# 83. Never Depend on Test Ordering

Tests MUST be independently executable.

Both must work:

```text
run complete suite
```

and:

```text
run only test X
```

Never assume:

```text
test A created the user
test B created the seller
test C changed the inventory
```

Every test MUST establish the state it requires.

---

# 84. Never Use Time Accidentally

Tests involving:

- sessions
- token expiry
- notification timestamps
- coupon expiry
- payment expiry
- order deadlines
- shipment dates
- job retry timing
- TTLs

must control time where practical.

Avoid fragile assertions such as:

```ts
expect(timestamp).toBe(Date.now());
```

Prefer bounded or deterministic assertions.

Do not make tests dependent on arbitrary wall-clock timing.

---

# 85. Avoid Flaky Async Assertions

Do NOT use:

```ts
await new Promise((resolve) => setTimeout(resolve, 5000));
```

as the normal way to wait for asynchronous work.

Prefer:

- deterministic polling
- bounded polling timeout
- explicit job completion checks
- database state checks
- test hooks
- deterministic worker execution

A test that passes only because a machine waited long enough is not reliable.

---

# 86. Negative Paths Are Mandatory

For every route, actively ask:

```text
What happens if this field is missing?

What happens if it is malformed?

What happens without authentication?

What happens with invalid authentication?

What happens with insufficient permission?

What happens if this belongs to another customer?

What happens if this belongs to another seller?

What happens if the product is unavailable?

What happens if inventory changes?

What happens if the order is in the wrong state?

What happens if the request is repeated?

What happens if two requests happen simultaneously?

What happens if the database fails?

What happens if Redis fails?

What happens if PgBoss fails?

What happens if an external provider fails?

What happens if an event is duplicated?

What happens if the client sends privileged fields?

What happens if the transaction fails halfway through?
```

These questions are mandatory reasoning prompts.

---

# 87. Coverage Is Not Line Coverage

Do NOT use:

```text
100% line coverage
```

as evidence that a route is adequately tested.

High line coverage can still miss:

- IDOR
- seller data leakage
- customer data leakage
- price manipulation
- inventory overselling
- duplicate payment
- invalid order transitions
- transaction rollback
- lost events
- stale cache authorization
- privilege escalation
- race conditions
- sensitive information leakage

The target is:

```text
behavioral coverage
+
security boundary coverage
+
business invariant coverage
```

---

# 88. Required Route Review Matrix

Before declaring a route complete, evaluate:

| Category                       | Applicable? | Tested? |
| ------------------------------ | ----------: | ------: |
| Happy path                     |             |         |
| Validation                     |             |         |
| Boundary values                |             |         |
| Authentication                 |             |         |
| Authorization                  |             |         |
| Customer ownership             |             |         |
| Seller ownership               |             |         |
| IDOR                           |             |         |
| Cross-resource references      |             |         |
| Price integrity                |             |         |
| Inventory integrity            |             |         |
| State transitions              |             |         |
| Duplicate operation            |             |         |
| Idempotency                    |             |         |
| Database invariants            |             |         |
| Transaction rollback           |             |         |
| Concurrency                    |             |         |
| Locking/optimistic concurrency |             |         |
| Redis/cache                    |             |         |
| Rate limiting                  |             |         |
| Outbox                         |             |         |
| PgBoss/job                     |             |         |
| WebSocket/realtime             |             |         |
| External dependency failure    |             |         |
| Payment behavior               |             |         |
| Error contract                 |             |         |
| Information leakage            |             |         |
| Security middleware            |             |         |
| Notifications                  |             |         |
| Audit/logging where applicable |             |         |
| Observability                  |             |         |

"Not applicable" is acceptable only when the route genuinely does not involve that behavior.

---

# 89. Golden Marketplace Integration Test

The project MUST maintain one high-value end-to-end backend integration flow covering the primary marketplace path.

The golden flow is:

```text
Customer
   ↓
Browse/Search
   ↓
Product
   ↓
Add to Cart
   ↓
Login
   ↓
Address
   ↓
Checkout
   ↓
Payment
   ↓
Order Created
   ↓
Notification / Realtime
   ↓
Seller Sees Order
   ↓
Seller Processes Order
   ↓
Seller Ships
   ↓
Customer Sees Updated Status
```

The golden test MUST verify important database state and side effects, not merely HTTP responses.

It does NOT replace individual route-level security and failure tests.

---

# 90. Definition of Done

A route/test task is NOT complete merely because tests pass.

## Application path

- [ ] Uses real `buildApp()`
- [ ] Uses `app.inject()`
- [ ] Exercises Fastify lifecycle
- [ ] Exercises relevant hooks
- [ ] Exercises real serialization/error handling

## Input

- [ ] Happy path
- [ ] Missing values
- [ ] Malformed values
- [ ] Wrong types
- [ ] Boundaries
- [ ] Oversized input where applicable
- [ ] Privileged fields

## Identity

- [ ] Unauthenticated
- [ ] Invalid authentication
- [ ] Expired/revoked authentication where applicable
- [ ] Correct authentication

## Authorization

- [ ] Required permission
- [ ] Insufficient permission
- [ ] Customer ownership
- [ ] Seller ownership
- [ ] Admin boundary where applicable
- [ ] Stale permission/cache behavior where applicable

## Marketplace security

- [ ] No IDOR
- [ ] No customer data leakage
- [ ] No seller data leakage
- [ ] No cross-resource ownership bypass
- [ ] No client-controlled sellerId/userId escalation
- [ ] No client-controlled price manipulation
- [ ] No client-controlled inventory manipulation

## Business behavior

- [ ] Business rules
- [ ] Valid state transitions
- [ ] Invalid state transitions
- [ ] Terminal-state behavior
- [ ] Duplicate behavior
- [ ] Idempotency where applicable
- [ ] Inventory rules
- [ ] Price rules

## Database

- [ ] Persistence verified
- [ ] Relationships verified
- [ ] Constraints verified
- [ ] Transaction behavior verified
- [ ] Rollback considered
- [ ] Assertion queries are scoped
- [ ] No accidental global aggregate assertions

## Checkout/payment

- [ ] Cart correctness
- [ ] Server-side price calculation
- [ ] Inventory validation
- [ ] Order creation
- [ ] Payment state
- [ ] Duplicate payment protection
- [ ] Payment failure behavior

## Async behavior

- [ ] Outbox behavior
- [ ] Event payload
- [ ] Job creation
- [ ] Retry/idempotency where applicable
- [ ] Failure behavior
- [ ] Duplicate event behavior

## Realtime

- [ ] Correct event type
- [ ] Correct recipient
- [ ] No cross-user event leakage
- [ ] Persistence does not depend on WebSocket success

## Infrastructure

- [ ] Redis/cache behavior where applicable
- [ ] Redis failure where applicable
- [ ] Concurrency where applicable
- [ ] Rate limiting where applicable
- [ ] Timeout/body-limit behavior where applicable

## Security

- [ ] No IDOR
- [ ] No privilege escalation
- [ ] No sensitive response leakage
- [ ] No sensitive log leakage
- [ ] No authentication secret leakage

## Quality

- [ ] Test is deterministic
- [ ] Test is isolated
- [ ] Test does not depend on ordering
- [ ] Test name describes behavior
- [ ] No arbitrary sleeps
- [ ] No unnecessary mocks
- [ ] No unscoped aggregate assertions
- [ ] Regression coverage added for bugs fixed

---

# 91. Mandatory Rules — Never Violate

An agent MUST NOT:

1. Replace `app.inject()` integration tests with mocked request/reply tests.

2. Replace real PostgreSQL behavior with an in-memory database merely to make tests easier.

3. Remove the project's randomized `runId`/identifier isolation strategy.

4. Introduce global database truncation/reset without explicit architectural approval.

5. Add unscoped aggregate assertions.

6. Assert global row counts in an accumulating database.

7. Assert global absence such as "count is zero" without a test-specific scope.

8. Create fixture helpers that hide ownership/resource scope.

9. Depend on another test having created required state.

10. Use arbitrary sleeps as the primary async synchronization mechanism.

11. Skip authentication/authorization because the happy path already authenticates.

12. Treat RBAC as equivalent to resource ownership.

13. Assume UUIDs eliminate IDOR.

14. Trust client-submitted `userId`, `sellerId`, `price`, `total`, `stock`, or privileged status fields.

15. Test only valid state transitions.

16. Test only HTTP responses when persistence or side effects are part of the behavior.

17. Ignore transaction rollback for multi-write operations.

18. Ignore duplicate payment/webhook/event processing when retries are possible.

19. Ignore concurrency where a business invariant can be violated.

20. Expose secrets, tokens, payment credentials, or cookies in test output.

21. Silently modify unrelated testing infrastructure.

22. Claim a behavior is covered when the test does not actually exercise it.

23. Make AI-generated text the source of truth for product, price, stock, order, or authorization facts.

24. Allow a realtime/WebSocket test to replace durable database verification.

---

# 92. Architectural Changes Require Explicit Approval

The following MUST NOT be changed as part of an ordinary route-test task.

## Database isolation

Do not introduce:

```text
TRUNCATE
global reset
rollback-per-test
```

without explicit architectural approval.

## Integration architecture

Do not replace:

```text
real Fastify + app.inject()
```

with:

```text
handler + mocked request/reply
```

## Test identifier strategy

Do not remove:

```text
runId
randomized identifiers
```

without explicit approval.

## Infrastructure

Do not replace real PostgreSQL behavior with:

```text
SQLite
in-memory database
mocked Drizzle
mocked transaction layer
```

merely because a test is difficult.

If the current architecture makes a test category difficult, report the limitation rather than silently changing the architecture.

---

# 93. Agent Workflow

When asked to add or modify tests for a route, follow this exact workflow.

## Step 1 — Read the route

Identify:

- HTTP method
- path
- params
- query
- body
- response
- hooks
- authentication
- authorization
- ownership
- service calls
- database reads
- database writes
- transactions
- cache interactions
- events
- jobs
- notifications
- realtime
- state transitions

---

## Step 2 — Read implementation dependencies

Inspect:

```text
route
 ↓
controller
 ↓
service
 ↓
repository/DB
 ↓
transaction
 ↓
cache
 ↓
outbox
 ↓
job/event
```

Do NOT design tests from the route file alone.

---

## Step 3 — Identify invariants

Write down what MUST always remain true.

Examples:

```text
customer can only access own order

seller can only modify own product

order total comes from server-side prices

inventory cannot become negative

payment cannot be applied twice

delivered order cannot return to processing

duplicate webhook cannot create duplicate payment

outbox event is committed with the business transaction

notification belongs to the intended user
```

Every important invariant should have a test.

---

## Step 4 — Build the scenario matrix

Before coding, enumerate:

```text
happy
invalid
unauthenticated
unauthorized
wrong customer
wrong seller
wrong resource
wrong state
duplicate
idempotent retry
concurrent
database failure
transaction failure
Redis failure
async failure
external dependency failure
```

Only applicable categories need implementation.

---

## Step 5 — Inspect existing fixtures

Find reusable fixtures.

Verify that:

- identifiers are isolated
- ownership is explicit
- database queries are scoped
- no helper relies on previous tests
- no helper performs unsafe global assertions

Do not blindly reuse an unsafe fixture.

---

## Step 6 — Implement integration tests

Use:

```text
real buildApp()
real app.inject()
real PostgreSQL
real relevant middleware
real transactions
```

Use test doubles only at genuine external integration boundaries.

---

## Step 7 — Verify persistence and side effects

After mutations, inspect applicable:

```text
DB
outbox
job
notification
cache
WebSocket event
payment
inventory
```

Do not stop at the response body.

---

## Step 8 — Add failure tests

Exercise relevant failure paths deliberately.

---

## Step 9 — Add concurrency tests

If concurrency can affect correctness, test actual concurrent execution.

---

## Step 10 — Run regression tests

Run:

```text
new tests
related module tests
full integration suite
```

when practical.

---

## Step 11 — Review for false confidence

Before declaring success, ask:

```text
Could this pass while another customer's data leaks?

Could this pass while another seller's data leaks?

Could this pass while a client changes the price?

Could this pass while inventory becomes negative?

Could this pass while duplicate payment occurs?

Could this pass while a transaction partially commits?

Could this pass while an event is lost?

Could this pass while a duplicate event creates duplicate effects?

Could this pass while stale permissions remain active?

Could this pass while two concurrent checkouts oversell inventory?

Could this pass while AI invents a product or price?

Could this pass while sensitive data is leaked?

Could this pass because old test data accidentally satisfied the assertion?
```

If yes, the test suite is incomplete.

---

# 94. Amazon Clone Critical Test Checklist

For this project, the following categories receive priority because they protect the core marketplace behavior.

## P0 — Must work

- [ ] Authentication
- [ ] Customer ownership
- [ ] Seller ownership
- [ ] Product visibility
- [ ] Product CRUD authorization
- [ ] Cart isolation
- [ ] Server-side pricing
- [ ] Inventory integrity
- [ ] Checkout
- [ ] Order creation
- [ ] Payment state
- [ ] Order state transitions
- [ ] Seller order access
- [ ] Seller shipping
- [ ] Customer order tracking
- [ ] Transaction rollback
- [ ] Outbox behavior
- [ ] Critical realtime event
- [ ] No cross-user data leakage

## P1 — Strongly recommended

- [ ] Duplicate checkout
- [ ] Duplicate payment/webhook
- [ ] Inventory concurrency
- [ ] Notification persistence
- [ ] Notification ownership
- [ ] Redis failure behavior
- [ ] PgBoss retry behavior
- [ ] Reviews
- [ ] Returns
- [ ] Search filters
- [ ] Search visibility
- [ ] AI search validation
- [ ] AI provider failure
- [ ] Rate limiting
- [ ] Sensitive-data leakage

## P2 — Add when time permits

- [ ] Advanced coupon scenarios
- [ ] Advanced return workflows
- [ ] Advanced shipment behavior
- [ ] Detailed observability assertions
- [ ] Advanced semantic ranking assertions
- [ ] Additional admin workflows
- [ ] Extensive external-provider failure matrices

Do NOT sacrifice P0 marketplace correctness to increase P2 test breadth.

---

# 95. Phase-Synchronized Testing

Testing MUST stay synchronized with implementation.

The agent MUST NOT jump ahead and build a large speculative test suite for functionality that has not been implemented.

Follow:

```text
IMPLEMENT PHASE
      ↓
IDENTIFY TESTABLE BEHAVIOR
      ↓
WRITE APPLICABLE TESTS
      ↓
RUN TESTS
      ↓
FIX FAILURES
      ↓
VERIFY DATABASE / SIDE EFFECTS
      ↓
PASS PHASE GATE
      ↓
NEXT IMPLEMENTATION PHASE
      ↓
NEXT TESTING PHASE
```

When a phase introduces a new domain, immediately add its applicable tests before moving forward.

Examples:

```text
Auth phase
    ↓
Auth integration tests

Catalog phase
    ↓
Catalog/search/product tests

Cart/checkout phase
    ↓
Cart/checkout/inventory/order tests

Seller phase
    ↓
Seller ownership/product/order tests

Payment/fulfillment phase
    ↓
Payment/order/shipment tests

Notification/realtime phase
    ↓
Notification/WebSocket tests

AI phase
    ↓
AI search/integration tests
```

Do not create tests for future functionality merely because it appears in the product specification.

---

# 96. Final Testing Standard

The correct question is not:

```text
"Did we test every route?"
```

It is:

```text
"Did we prove the important behavior and security boundaries
of every implemented route?"
```

The correct question is not:

```text
"Did the API return 200?"
```

It is:

```text
"Did the correct actor perform the correct operation,
on the correct resource,
in the correct state,
with the correct price and inventory,
and did every required database and asynchronous side effect
remain correct?"
```

The target is:

```text
API correctness
+
business correctness
+
ownership correctness
+
security correctness
+
database correctness
+
transaction correctness
+
async correctness
+
concurrency correctness
+
realtime correctness
```

A production-grade Amazon Clone integration test proves the **marketplace invariant**, not merely the HTTP response.

---

# 97. Quick Reference — Before Writing Any Test

Before writing a test, ask:

1. Am I testing through the real `buildApp()` and `app.inject()`?

2. What is the happy path?

3. What validation boundaries exist?

4. What happens without authentication?

5. What happens with invalid/expired authentication?

6. What permission is required?

7. What happens with insufficient permission?

8. Can another customer access this resource?

9. Can another seller access this resource?

10. Can a client spoof `userId` or `sellerId`?

11. Can a client manipulate price or total?

12. Can a client manipulate inventory?

13. Can a foreign resource ID be injected?

14. What are the valid state transitions?

15. What are the invalid state transitions?

16. What happens if the request is repeated?

17. Is the operation idempotent?

18. What database invariant must remain true?

19. What happens if a transaction fails halfway through?

20. Does the operation create an outbox event?

21. Is the outbox assertion scoped to this test?

22. Does it create a PgBoss job?

23. What happens if the job runs twice?

24. What happens if Redis is unavailable?

25. What happens if an external dependency times out?

26. Can two requests execute simultaneously?

27. Can inventory be oversold?

28. Can payment be processed twice?

29. Can an order transition to an invalid state?

30. Does the route affect cached authorization/data?

31. Does the route create a notification?

32. Does the route create a realtime event?

33. Could another user receive that event?

34. Could the response leak sensitive information?

35. Could the logs leak sensitive information?

36. Does the test depend on previous tests?

37. Does any assertion query global accumulated state?

38. Am I using arbitrary sleeps?

39. Have I added a regression test for any bug being fixed?

40. Can this test pass while the actual marketplace invariant is broken?

If any applicable question has no answer, the test is not finished.

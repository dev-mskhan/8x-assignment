# AGENTS.md — Modular Monolith Foundation Guide

This document is the architectural contract for this project.

Read this file before creating, modifying, or moving code.

The project is a **modular monolith**. It is one backend application organized into strongly separated business modules. Do not introduce microservices, Kafka, RabbitMQ, or other distributed infrastructure unless explicitly requested.

---

# 1. Architecture Principles

The application follows these principles:

1. **Modular monolith first**
2. **Business modules own business logic**
3. **Infrastructure is centralized**
4. **PostgreSQL is the source of truth**
5. **PgBoss handles durable background jobs**
6. **Redis handles caching and ephemeral real-time event distribution**
7. **WebSockets deliver live updates to connected clients**
8. **Outbox guarantees reliable asynchronous side effects**
9. **Database transactions protect consistency**
10. **HTTP controllers remain thin**
11. **Repositories contain persistence logic only**
12. **Services contain business logic**
13. **Workers execute asynchronous application services**
14. **Avoid unnecessary abstractions and files**
15. **Do not create microservices inside the monolith**

The goal is:

```text
Simple enough to build
+
Strong enough to scale
+
Clear enough for AI agents to navigate
```

---

# 2. Technology Stack

| Layer           | Technology        | Responsibility                       |
| --------------- | ----------------- | ------------------------------------ |
| HTTP            | Fastify           | API server                           |
| Validation      | Zod               | Request/env validation               |
| ORM             | Drizzle ORM       | PostgreSQL access                    |
| Database        | PostgreSQL / Neon | Durable application state            |
| Vector search   | pgvector          | Semantic/vector search when required |
| Jobs            | PgBoss            | Durable background processing        |
| Redis           | ioredis           | Cache, rate limiting, Pub/Sub        |
| Realtime        | WebSocket         | Browser/server live communication    |
| Logging         | Pino              | Structured application logging       |
| Testing         | Vitest            | Unit/integration tests               |
| Package manager | pnpm              | Dependency management                |

Do not add another infrastructure technology to solve a problem that the existing stack can solve.

---

# 3. Project Structure

Use this structure as the default:

```text
project-root/
│
├── apps/
│   └── server/
│       │
│       ├── package.json
│       ├── Dockerfile
│       │
│       └── src/
│           │
│           ├── main.ts
│           │
│           ├── app/
│           │   ├── app.ts
│           │   ├── plugins.ts
│           │   ├── routes.ts
│           │   └── websocket.ts
│           │
│           ├── config/
│           │   └── env.ts
│           │
│           ├── core/
│           │   │
│           │   ├── db/
│           │   │   └── db.ts
│           │   │
│           │   ├── redis/
│           │   │   ├── redis.ts
│           │   │   └── pubsub.ts
│           │   │
│           │   ├── queue/
│           │   │   ├── boss.ts
│           │   │   ├── jobs.ts
│           │   │   └── worker.ts
│           │   │
│           │   ├── events/
│           │   │   ├── event-bus.ts
│           │   │   └── outbox.ts
│           │   │
│           │   ├── errors/
│           │   │   ├── app-error.ts
│           │   │   └── error-handler.ts
│           │   │
│           │   ├── logger/
│           │   │   └── logger.ts
│           │   │
│           │   └── utils/
│           │
│           ├── modules/
│           │   │
│           │   ├── <module>/
│           │   │   ├── <module>.routes.ts
│           │   │   ├── <module>.controller.ts
│           │   │   ├── <module>.service.ts
│           │   │   ├── <module>.repository.ts
│           │   │   ├── <module>.schema.ts
│           │   │   └── <module>.jobs.ts
│           │   │
│           │   └── ...
│           │
│           └── workers/
│               └── register-workers.ts
│
├── packages/
│   │
│   ├── database/
│   │   └── src/
│   │       ├── client.ts
│   │       ├── index.ts
│   │       └── schema/
│   │           ├── index.ts
│   │           └── <domain>.schema.ts
│   │
│   ├── shared/
│   │   └── src/
│   │       ├── types/
│   │       ├── constants/
│   │       ├── schemas/
│   │       └── utils/
│   │
│   ├── env/
│   │   └── src/
│   │       └── server.ts
│   │
│   ├── typescript-config/
│   │
│   └── eslint-config/
│
├── infra/
│   └── docker/
│       ├── postgres/
│       └── redis/
│
├── docker-compose.yml
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── AGENTS.md
```

The `<module>` directories represent business capabilities, not individual database tables.

---

# 4. Application Entry Points

There are two application processes.

## API process

```text
apps/server/src/main.ts
```

Responsible for:

* creating the Fastify application
* registering plugins
* registering routes
* starting HTTP/WebSocket server
* graceful shutdown

## Worker process

```text
apps/server/src/workers/register-workers.ts
```

Responsible for:

* starting PgBoss
* registering all background workers
* processing asynchronous jobs
* graceful shutdown

The API and worker may use the same Docker image but should run as separate processes in production.

Do not put long-running background processing inside HTTP request handlers.

---

# 5. App Layer

The app layer assembles the application.

```text
app/
├── app.ts
├── plugins.ts
├── routes.ts
└── websocket.ts
```

## `app.ts`

Creates the Fastify instance.

It should not contain business logic.

## `plugins.ts`

Registers global Fastify plugins such as:

* helmet
* CORS
* cookies
* rate limiting
* sensible
* Swagger/OpenAPI
* authentication hooks where appropriate

## `routes.ts`

Registers module routes.

Example:

```ts
app.register(authRoutes, { prefix: "/api/v1/auth" });
app.register(userRoutes, { prefix: "/api/v1/users" });
app.register(productRoutes, { prefix: "/api/v1/products" });
```

## `websocket.ts`

Owns WebSocket connection setup.

It is responsible for:

* authenticating WebSocket connections
* tracking connected clients
* subscribing to Redis Pub/Sub
* forwarding relevant events to connected clients
* cleaning up disconnected clients

It must not contain business rules.

---

# 6. Core Layer

The `core` directory contains infrastructure shared by all modules.

Modules may depend on `core`.

Core must never depend on a specific business module.

```text
core/
├── db/
├── redis/
├── queue/
├── events/
├── errors/
├── logger/
└── utils/
```

---

# 7. Database

Use one shared Drizzle database client.

```text
core/db/db.ts
```

Only this layer creates the database client.

Do not call `drizzle()` throughout the application.

Example:

```ts
const db = getDb();
```

Database schemas live in:

```text
packages/database/src/schema/
```

Group schemas by domain rather than creating one file per table when multiple tables belong together.

For example:

```text
schema/
├── auth.schema.ts
├── users.schema.ts
├── catalog.schema.ts
├── commerce.schema.ts
├── fulfillment.schema.ts
└── notifications.schema.ts
```

The database is the source of truth for durable business state.

---

# 8. Database Transactions

Use transactions whenever multiple database changes must succeed or fail together.

Example:

```text
transaction
├── create order
├── create order items
├── update inventory
├── create payment record
└── create outbox event
```

Never perform related writes as independent operations when atomicity is required.

The following must normally be transactional:

* order creation
* payment state changes
* inventory reservation
* user/account state transitions
* multi-table domain operations
* domain change + outbox event

---

# 9. Modules

Modules are the primary business boundaries.

A module represents a business capability.

Examples:

```text
auth
users
catalog
cart
orders
payments
fulfillment
reviews
notifications
search
ai
```

Actual module names depend on the product.

Do not create a module simply because there is a database table.

For example, these are usually better grouped:

```text
catalog/
├── products
├── categories
├── variants
└── sellers
```

rather than creating four unrelated application modules.

---

# 10. Module File Responsibilities

A normal module should contain only the files it actually needs.

Minimum:

```text
<module>/
├── <module>.routes.ts
├── <module>.controller.ts
├── <module>.service.ts
└── <module>.repository.ts
```

Add these only when needed:

```text
<module>.schema.ts
<module>.jobs.ts
```

Do not create empty boilerplate files.

---

# 11. Routes

`<module>.routes.ts`

Responsibilities:

* define HTTP routes
* attach validation schemas
* attach authentication/pre-handler hooks
* call controllers

Routes must not:

* contain SQL
* contain business logic
* call Redis directly
* enqueue jobs directly
* implement complex validation manually

Example:

```ts
app.post(
  "/",
  {
    preHandler: [requireAuth],
    schema: createProductRouteSchema,
  },
  productController.create,
);
```

---

# 12. Controllers

`<module>.controller.ts`

Controllers are the HTTP boundary.

Responsibilities:

* read request parameters
* validate/parse input
* call services
* return HTTP responses

Controllers must not:

* contain business rules
* contain SQL
* directly manipulate Redis
* directly manipulate PgBoss
* perform multi-step domain workflows

Example:

```ts
async function create(request, reply) {
  const input = createProductSchema.parse(request.body);

  const product = await productService.create(
    request.user.id,
    input,
  );

  return reply.status(201).send({
    success: true,
    data: product,
  });
}
```

---

# 13. Services

`<module>.service.ts`

Services contain business logic.

Services orchestrate:

* repositories
* transactions
* other domain services
* cache
* domain events
* outbox events

Example:

```text
createOrder()
    ↓
validate cart
    ↓
validate prices
    ↓
validate inventory
    ↓
transaction
    ├── create order
    ├── create order items
    ├── reserve inventory
    └── create outbox event
```

Services should express business operations, not HTTP operations.

Do not name business methods after HTTP actions when a domain operation is more appropriate.

Prefer:

```ts
orderService.createOrder()
```

over:

```ts
orderService.handlePostRequest()
```

---

# 14. Repositories

`<module>.repository.ts`

Repositories contain persistence logic.

Repositories may:

* query PostgreSQL
* insert records
* update records
* delete records
* perform Drizzle queries
* execute module-specific database queries

Repositories must not contain business rules.

Bad:

```ts
if (order.status === "PAID") {
  ...
}
```

when that decision belongs to the service.

Good:

```ts
orderRepository.findById(id)
orderRepository.updateStatus(id, status)
```

---

# 15. Validation

Use Zod.

Validation belongs at boundaries.

Examples:

```text
HTTP request
environment variables
job payload
external provider response
```

Do not trust:

* request bodies
* query parameters
* job payloads
* webhook payloads
* external APIs

without validation.

Prefer schemas that can be reused by the appropriate boundary.

---

# 16. Background Jobs — PgBoss

PgBoss is the durable background job system.

It stores jobs in PostgreSQL.

Use PgBoss for work that:

* can happen asynchronously
* may take time
* requires retries
* should survive process restarts
* should not block an HTTP request

Examples:

```text
send email
send notification
generate embedding
process payment webhook
reconcile payment
expire order
cleanup sessions
cleanup old records
generate reports
process uploaded files
AI generation
```

Do not use PgBoss for normal synchronous CRUD.

Do not turn every function into a background job.

---

# 17. Job Naming

Each module owns its job definitions.

Example:

```text
orders/
└── orders.jobs.ts
```

```ts
export const ORDER_JOBS = {
  EXPIRE: "orders.expire",
  SEND_CONFIRMATION: "orders.send-confirmation",
} as const;
```

Never scatter raw queue names throughout the codebase.

Use constants.

---

# 18. Sending Jobs

Application services should use a central queue abstraction.

Do not call PgBoss directly from arbitrary application code.

Preferred:

```ts
await sendJob(
  ORDER_JOBS.SEND_CONFIRMATION,
  {
    orderId,
  },
);
```

rather than:

```ts
await boss.send("orders.send-confirmation", ...);
```

This keeps PgBoss implementation details centralized.

---

# 19. Job Workers

Workers are registered centrally:

```text
workers/
└── register-workers.ts
```

Example:

```ts
registerOrderWorkers(boss);
registerPaymentWorkers(boss);
registerNotificationWorkers(boss);
registerSearchWorkers(boss);
```

Workers should be thin.

Preferred:

```ts
registerWorker(
  boss,
  {
    queue: ORDER_JOBS.EXPIRE,
    concurrency: 5,
  },
  async (job) => {
    await orderService.expireOrder(job.data.orderId);
  },
);
```

Business logic belongs in services, not inside worker callbacks.

---

# 20. Job Idempotency

Every important background job must be safe to retry.

A job may run again after:

* process crashes
* timeout
* network failure
* provider failure
* retry
* deployment

Therefore:

```text
Do not assume a job runs exactly once.
```

Use idempotency keys where necessary.

Examples:

```text
payment:{paymentId}:capture
order:{orderId}:confirmation-email
notification:{notificationId}:delivery
embedding:{productId}:{version}
```

---

# 21. Job Categories

Do not create dozens of physical queues unnecessarily.

Prefer a small number of job categories and meaningful job names.

For example:

```text
critical
default
email
ai
cleanup
```

or simply use PgBoss job names directly if queue separation is not necessary.

Separate queues only when concurrency, priority, timeout, or operational behavior actually differs.

---

# 22. Outbox Pattern

Any important asynchronous side effect should use the outbox pattern.

Examples:

```text
database transaction
├── update order
├── update payment
└── insert outbox event
```

The outbox event is committed atomically with the business transaction.

A background publisher then turns the outbox event into a PgBoss job.

This prevents:

```text
database succeeded
but
job enqueue failed
```

from losing the event.

---

# 23. Outbox Flow

```text
HTTP request
     ↓
Service
     ↓
DB transaction
     ├── domain changes
     └── outbox_events INSERT
             ↓
          commit
             ↓
       Outbox publisher
             ↓
          PgBoss
             ↓
           Worker
```

The outbox is durable.

Redis Pub/Sub is not a replacement for the outbox.

---

# 24. Redis

Redis is infrastructure, not business state.

Use Redis for:

* caching
* rate limiting
* distributed coordination when necessary
* ephemeral Pub/Sub
* WebSocket fan-out
* short-lived data

Do not use Redis as the primary source of truth for orders, payments, users, inventory, or notifications.

---

# 25. Redis Client

Use a centralized Redis client:

```text
core/redis/redis.ts
```

Application code should not create arbitrary Redis connections.

Create a separate Pub/Sub abstraction:

```text
core/redis/pubsub.ts
```

This hides ioredis implementation details from modules.

---

# 26. Redis Key Naming

Use:

```text
<module>:<type>:<identifier>
```

Examples:

```text
auth:user:{userId}
auth:session:{sessionId}

catalog:product:{productId}

cart:user:{userId}

ratelimit:{scope}:{identifier}
```

Never put raw sensitive information into Redis keys.

Hash sensitive identifiers when necessary.

---

# 27. Redis Failure Policy

Redis should generally fail open for non-critical functionality.

For cache operations:

```text
Redis works
    ↓
use cache

Redis fails
    ↓
log warning
    ↓
use PostgreSQL
```

A Redis outage must not normally make the entire API unavailable.

Do not make Redis a mandatory dependency for durable business correctness.

---

# 28. Redis Pub/Sub

Redis Pub/Sub is for live, ephemeral communication.

Typical uses:

```text
notification updates
order status updates
chat events
WebSocket fan-out
cache invalidation
live dashboard updates
```

Example:

```text
notifications:user:{userId}
```

Important:

**Redis Pub/Sub is not durable.**

If a WebSocket client is offline when a Pub/Sub message is published, it may miss that message.

Therefore:

```text
PostgreSQL = durable truth
Redis Pub/Sub = live signal
WebSocket = client delivery
```

Never rely on Pub/Sub alone for important business events.

---

# 29. Notification Architecture

Notifications should use this architecture:

```text
Business event
      ↓
Database transaction
      ↓
Notification record
      ↓
Outbox / PgBoss
      ↓
Notification worker
      ↓
PostgreSQL notification row
      ↓
Redis Pub/Sub
      ↓
WebSocket
      ↓
Browser
```

The database notification record is durable.

Redis is only the real-time delivery mechanism.

When the client reconnects:

```text
WebSocket reconnect
      ↓
GET unread notifications
      ↓
PostgreSQL
      ↓
client reconciles missed events
```

This makes WebSocket delivery resilient without requiring Kafka.

---

# 30. WebSocket Architecture

The WebSocket server belongs to the same modular monolith.

Do not create a separate WebSocket microservice unless scaling requirements later justify it.

Architecture:

```text
                 ┌─────────────┐
                 │   Browser   │
                 └──────┬──────┘
                        │
                     WebSocket
                        │
                ┌───────▼────────┐
                │   Fastify API  │
                │                │
                │ WebSocket layer│
                └───────┬────────┘
                        │
                  Redis Pub/Sub
                        │
          ┌─────────────┴─────────────┐
          │                           │
       API #1                       API #2
          │                           │
       sockets                     sockets
```

This allows multiple API instances to receive the same real-time events.

---

# 31. WebSocket Authentication

Every WebSocket connection must be authenticated.

Use the application's existing authentication mechanism.

After authentication, associate the connection with:

```text
userId
```

Do not trust a client-supplied userId.

The server determines the authenticated user.

---

# 32. WebSocket Connection Management

Maintain an in-memory connection registry per API instance.

Conceptually:

```ts
Map<UserId, Set<WebSocket>>
```

A user may have:

* multiple browser tabs
* multiple devices
* multiple WebSocket connections

Therefore do not assume:

```text
one user = one socket
```

When Redis publishes:

```text
notifications:user:123
```

the API instance forwards the event to all local sockets belonging to user `123`.

---

# 33. WebSocket Reconnection

Clients must reconnect automatically.

On reconnect:

```text
connect
  ↓
authenticate
  ↓
fetch missed durable state
  ↓
resume live WebSocket events
```

Do not attempt to make Redis Pub/Sub provide message replay.

If durable replay is ever required from Redis itself, use Redis Streams or another durable mechanism, but do not add this complexity unless the product actually requires it.

---

# 34. AI Module

AI functionality belongs inside the modular monolith initially.

Example:

```text
modules/
└── ai/
    ├── ai.routes.ts
    ├── ai.controller.ts
    ├── ai.service.ts
    └── ai.repository.ts
```

AI services may call:

* OpenAI
* PostgreSQL
* pgvector
* product/catalog services

The AI must not bypass application business rules.

For product search:

```text
User query
    ↓
AI understands intent
    ↓
structured filters
    ↓
database / pgvector search
    ↓
business filters
    ↓
ranking
    ↓
AI response
```

Never allow an LLM to directly decide whether a product exists or whether a business rule is valid.

---

# 35. pgvector

Use PostgreSQL + pgvector when semantic search is required.

Keep vectors in PostgreSQL unless there is a demonstrated need for a separate vector database.

Example:

```text
products
├── normal product fields
└── embedding vector
```

Start with normal PostgreSQL filtering where possible.

Add vector search where it provides actual product value.

Do not introduce a separate vector database prematurely.

---

# 36. Module Dependency Rules

Dependencies should flow inward toward business capabilities.

Preferred:

```text
route
  ↓
controller
  ↓
service
  ↓
repository
  ↓
database
```

Infrastructure:

```text
service
  ↓
core infrastructure
```

Avoid:

```text
repository → service
controller → repository
repository → Redis Pub/Sub
controller → PgBoss
module A → module B repository
```

If one module needs another module's business behavior, call its service.

Example:

```ts
orderService
    ↓
paymentService
```

not:

```ts
orderService
    ↓
paymentRepository
```

---

# 37. Cross-Module Communication

Prefer explicit service calls for synchronous business operations.

Example:

```text
OrderService
    ↓
InventoryService
    ↓
PaymentService
```

Use asynchronous events/jobs when the operation does not need to complete before the HTTP request returns.

Example:

```text
Order created
    ↓
outbox
    ↓
PgBoss
    ↓
send email
```

Do not use Redis Pub/Sub as the main mechanism for business-to-business communication inside the monolith.

Redis Pub/Sub is primarily for real-time distribution.

---

# 38. Error Handling

Use centralized application errors.

Example:

```text
ValidationError        → 400
UnauthorizedError      → 401
ForbiddenError         → 403
NotFoundError          → 404
ConflictError          → 409
TooManyRequestsError   → 429
InternalError          → 500
```

Services should throw typed errors.

Controllers should not manually translate every error.

The global Fastify error handler handles HTTP conversion.

---

# 39. API Response Format

Use a consistent response shape.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found"
  }
}
```

Do not create a different response structure for every module.

---

# 40. Logging

Use structured Pino logging.

Every important operation should include useful context.

Example:

```ts
logger.info(
  {
    userId,
    orderId,
  },
  "Order created",
);
```

Do not log:

* passwords
* authentication tokens
* cookies
* payment secrets
* API keys
* sensitive personal information

---

# 41. Environment Variables

All environment variables must be validated through Zod.

Central location:

```text
packages/env/src/server.ts
```

Never use:

```ts
process.env.DATABASE_URL
```

throughout the application.

Instead:

```ts
serverEnv.DATABASE_URL
```

Required production secrets should not have unsafe defaults.

---

# 42. Testing

Use Vitest.

Test business logic primarily at the service layer.

Recommended levels:

```text
unit tests
    ↓
service/business rules

integration tests
    ↓
repository + PostgreSQL

API tests
    ↓
Fastify routes

worker tests
    ↓
job/service behavior
```

Do not mock everything.

For database-heavy business logic, integration tests against a real PostgreSQL environment are preferred.

---

# 43. File Creation Rules

Do not create files simply because the template contains them.

For a small module:

```text
products/
├── products.routes.ts
├── products.controller.ts
├── products.service.ts
└── products.repository.ts
```

If the module later requires background jobs:

```text
products.jobs.ts
```

If it requires special schemas:

```text
products.schema.ts
```

Add complexity only when justified.

---

# 44. What NOT to Add

Do not introduce these by default:

```text
Kafka
RabbitMQ
NATS
Temporal
Elasticsearch
OpenSearch
separate vector database
separate notification service
separate WebSocket service
microservices
API gateway
Kubernetes
service mesh
```

They may become appropriate later, but they are not part of the default architecture.

The first version should remain:

```text
Fastify
+
PostgreSQL / Neon
+
Drizzle
+
PgBoss
+
Redis
+
WebSocket
```

---

# 45. Deployment Model

Minimal production deployment:

```text
                  ┌──────────────┐
                  │    Client    │
                  └──────┬───────┘
                         │
                    Load Balancer
                         │
             ┌───────────┴───────────┐
             │                       │
        API instance             API instance
             │                       │
             └───────────┬───────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
           Neon DB               Redis
              │
           PgBoss
              │
        Worker instance(s)
```

Start with:

```text
1 × API
1 × Worker
1 × Neon PostgreSQL
1 × Redis
```

Scale API and worker processes independently when necessary.

---

# 46. Graceful Shutdown

On shutdown:

```text
1. stop accepting new requests
2. close/drain Fastify
3. stop WebSocket acceptance
4. stop PgBoss workers
5. stop outbox publisher
6. close Redis connections
7. close database connections
8. exit
```

Do not terminate the process while active jobs or critical requests are still being handled.

---

# 47. Startup Sequence

Recommended startup:

```text
1. validate environment
2. initialize logger
3. initialize database
4. initialize Redis
5. create Fastify app
6. register plugins
7. register routes
8. register WebSocket handlers
9. start HTTP server
10. start PgBoss
11. register workers
12. start outbox publisher
```

If a component is optional, keep startup failure behavior explicit.

---

# 48. Code Style Rules for Agents

When modifying the project:

1. Inspect the existing module before creating new files.
2. Reuse existing abstractions.
3. Do not create duplicate database clients.
4. Do not create duplicate Redis clients.
5. Do not call PgBoss directly when the queue abstraction exists.
6. Do not put business logic in routes/controllers.
7. Do not put business logic in repositories.
8. Do not put business logic directly inside workers.
9. Keep transactions inside service/repository boundaries.
10. Prefer existing utilities over new utilities.
11. Avoid premature abstractions.
12. Avoid unnecessary files.
13. Keep modules independently understandable.
14. Do not modify unrelated modules.
15. Do not introduce new infrastructure without explicit justification.

---

# 49. Preferred Request Flow

For a normal API request:

```text
HTTP
 ↓
Fastify route
 ↓
Controller
 ↓
Service
 ↓
Repository
 ↓
PostgreSQL
 ↓
Service
 ↓
Controller
 ↓
HTTP response
```

---

# 50. Preferred Async Flow

For asynchronous work:

```text
HTTP
 ↓
Controller
 ↓
Service
 ↓
DB transaction
 ├── business state
 └── outbox event
          ↓
      PgBoss
          ↓
       Worker
          ↓
       Service
          ↓
 external system
```

---

# 51. Preferred Realtime Flow

For live UI updates:

```text
Business change
      ↓
PostgreSQL
      ↓
Outbox / PgBoss
      ↓
Notification worker
      ↓
PostgreSQL notification
      ↓
Redis Pub/Sub
      ↓
WebSocket server
      ↓
Browser
```

If the browser misses the event:

```text
Browser reconnects
      ↓
fetch durable state
      ↓
PostgreSQL
```

This is intentional.

Do not attempt to make WebSockets or Redis Pub/Sub the source of truth.

---

# 52. The Four Infrastructure Responsibilities

Keep this mental model:

```text
PostgreSQL
    = truth

PgBoss
    = durable work

Redis
    = cache + live signal

WebSocket
    = live client delivery
```

Never confuse these responsibilities.

---

# 53. Final Architectural Rule

When deciding where code belongs, ask:

### Is it business logic?

Put it in a module service.

### Is it database persistence?

Put it in a repository.

### Is it HTTP-specific?

Put it in a controller/route.

### Is it durable asynchronous work?

Use PgBoss.

### Is it guaranteed side-effect triggering?

Use the outbox.

### Is it temporary/cache state?

Use Redis.

### Is it live fan-out?

Use Redis Pub/Sub.

### Is it browser live communication?

Use WebSocket.

### Is it durable application state?

Use PostgreSQL.

### Is it infrastructure shared by many modules?

Put it under `core`.

Keep the monolith modular, but do not turn the monolith into a collection of miniature microservices.

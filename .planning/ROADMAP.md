# Roadmap: Amazon Clone

## Phase 0 — Capture & Repository Baseline

**Goal:** Establish project memory, architecture guardrails, and repository readiness.

**Key tasks:**
- Confirm project intent and scope
- Review AGENTS.md, production-readiness checklists, and testing standards
- Lock the modular monolith architecture and stack constraints
- Create project planning artifacts and state tracking

**Outputs:**
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `.planning/config.json`

## Phase 1 — Foundation & Platform Setup

**Goal:** Establish the application shell, environment validation, shared packages, and the API/worker baseline.

**Key tasks:**
- Initialize Fastify application shell
- Centralize config and environment validation
- Set up database connection and migration scaffolding
- Set up Redis, queue, event, and logger infrastructure
- Add baseline error handling and response conventions
- Create the module pattern for business ownership

**Success criteria:**
- Backend boots cleanly with validated env vars
- Core infrastructure is centralized and reusable
- Basic module layout matches the architecture contract

## Phase 2 — Database & Seed Data

**Goal:** Build the durable commerce data model and seed realistic marketplace content.

**Key tasks:**
- Define PostgreSQL schemas for users, products, orders, payments, reviews, and notifications
- Add indexes and constraints for marketplace correctness
- Create migration pipeline and seed scripts for testing
- Validate transactional invariants for key commerce flows

**Success criteria:**
- Core tables and constraints exist and are stable
- Seeded data supports catalog browsing and checkout scenarios
- Data model is ready for auth, catalog, and order flows

## Phase 3 — Authentication & Users

**Goal:** Create the identity and account layer for customers and sellers.

**Key tasks:**
- Sign up, sign in, and session handling
- Password reset and account security flows
- User profile data and role handling for seller/customer contexts
- Authorization safeguards and secure account transitions

**Success criteria:**
- Authenticated users can access appropriate flows
- Security and validation rules are enforced at boundaries
- Seller/customer separation is reliable

## Phase 4 — Catalog, Search, Cart & Checkout

**Goal:** Enable the customer shopping flow from browsing to purchase.

**Key tasks:**
- Product catalog and listing pages
- Search, filtering, sorting, and pagination
- Cart and price calculation logic
- Checkout with order creation and transactional inventory updates

**Success criteria:**
- Storefront browsing works end-to-end
- Checkout completes without overselling or price drift
- Product and order state are correctly persisted and observable

## Phase 5 — Seller Marketplace

**Goal:** Give sellers the operational tools they need to manage listings and inventory.

**Key tasks:**
- Seller account setup and listing management
- Inventory updates and listing availability controls
- Seller orders and fulfillment tracking
- Business rules for ownership and access control

**Success criteria:**
- Sellers can create and maintain listings responsibly
- Inventory and order ownership are enforced correctly
- Seller workflows do not expose customer data or cross-tenant state

## Phase 6 — Payments & Fulfillment

**Goal:** Connect the commercial lifecycle to payment state and order fulfillment.

**Key tasks:**
- Payment state transitions and retry-safe callbacks
- Order fulfillment lifecycle management
- Status correctness and idempotency protections
- Outbox and worker integration for async payment/fulfillment work

**Success criteria:**
- Order and payment state remain consistent under repeated or concurrent events
- Payment flow can be retried without double-application
- Fulfillment changes are auditable and durable

## Phase 7 — Reviews, Notifications & Realtime

**Goal:** Deliver trust signals and live commerce feedback.

**Key tasks:**
- Product reviews and ratings
- Notification records and delivery workflows
- Redis Pub/Sub and WebSockets for live updates
- Customer and seller notification reconciliation on reconnect

**Success criteria:**
- Product trust data is visible and safe to display
- Live updates reach connected users without replacing durable source-of-truth DB state
- Notification flow remains consistent after reconnects or failures

## Phase 8 — AI Shopping

**Goal:** Add AI-assisted discovery while preserving business correctness.

**Key tasks:**
- Intent parsing and shopping assistance
- Structured filter conversion for catalog searches
- Ranking and validation of AI-recommended results
- Guardrails to ensure AI cannot bypass business rules or inventory logic

**Success criteria:**
- AI features help find products without bypassing catalog and business rules
- Results are constrained by persisted store data and access rules
- Product existence, pricing, and permission checks remain authoritative in PostgreSQL

## Phase 9 — Admin & Product Polish

**Goal:** Improve operator visibility and marketplace maturity.

**Key tasks:**
- Admin dashboards and moderation workflows
- Quality-of-life improvements in marketplace UX and flows
- Reliability and performance polish for production readiness

**Success criteria:**
- Marketplace operators can monitor and address common issues
- Product polish supports stable launch without ignoring core correctness

## Phase 10 — Production Hardening & Launch

**Goal:** Validate the complete marketplace for production launch.

**Key tasks:**
- Run end-to-end configuration, performance, and security validation
- Validate infrastructure, concurrency, and transaction behaviors under realistic load
- Finalize deployment, monitoring, and rollback readiness
- Ship the first production-grade marketplace launch

**Success criteria:**
- Prerelease checks pass for reliability, correctness, performance, and security
- Production launch operational plan is complete and documented

## Dependencies and Risk Notes

- Phase 2 must land before catalog and checkout logic become durable and testable
- Payment and fulfillment flows depend on transaction correctness and idempotency discipline
- AI features require schema and catalog quality before being trusted in customer-facing flows
- Real-time notifications should not be treated as durable event storage; DB remains authoritative

---
*Roadmap initialized: 2026-10-05*

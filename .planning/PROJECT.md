# Amazon Clone

## What This Is

Amazon Clone is a modular monolith e-commerce platform for browsing products, shopping as a customer, selling as a merchant, and managing commerce operations in one backend-driven system. The product is designed for a marketplace flow where customer trust, catalog quality, checkout reliability, and seller operations matter more than ceremony.

## Core Value

Customers can discover, compare, buy, and track products reliably while sellers can list, manage inventory, and fulfill orders without expensive custom infrastructure.

## Requirements

### Validated

- ✓ Product catalog and browse experience — existing platform foundation
- ✓ User and identity flows — foundational auth and session model
- ✓ Commerce domain architecture — modular monolith patterns defined for orders, payments, catalog, and fulfillment

### Active

- [ ] Customer can sign up and sign in securely
- [ ] Customer can browse and search a product catalog
- [ ] Customer can add items to cart and complete checkout
- [ ] Seller can create and manage listings and inventory
- [ ] Orders can be placed, tracked, and fulfilled reliably
- [ ] Payments and state transitions are handled safely and idempotently
- [ ] Customers can review products and receive notifications
- [ ] AI-assisted shopping can surface product intent-based recommendations
- [ ] Admin can monitor marketplace activity and quality

### Out of Scope

- Seller marketplace mobile app — defer to future delivery once web marketplace is stable
- Multi-region global expansion — out of initial phase scope
- Real-time chat support for buyers and sellers — better handled after checkout and marketplace basics
- Full enterprise B2B procurement portal — not required for core marketplace launch

## Context

This project follows the modular monolith foundation in AGENTS.md and focuses on a backend-first marketplace architecture using Fastify, PostgreSQL, Redis, PgBoss, WebSockets, and pgvector. The system is intentionally organized around business modules such as auth, catalog, cart, orders, payments, sellers, fulfillment, reviews, notifications, and AI search rather than feature-level fragmentation.

The repository is being treated as a production-grade Amazon Clone implementation with explicit emphasis on correctness, transactional integrity, performance, and testability. Existing planning documents point to a phased roadmap spanning foundation, database, auth, catalog, checkout, seller operations, payments, notifications, AI shopping, and production hardening.

## Constraints

- **Architecture**: Modular monolith with strong module boundaries — avoids premature microservice sprawl
- **Data truth**: PostgreSQL remains the durable source of truth for commerce state
- **Async work**: Background jobs and outbox-driven processing must be reliable and idempotent
- **Realtime**: Redis Pub/Sub and WebSockets provide live delivery, not durable source-of-truth behavior
- **Validation**: Zod validation is required at API, env, and external-input boundaries
- **Testing**: Integration-first backend validation is required for API and business workflows

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Modular monolith | Keeps architecture simple while preserving business separation | ✓ Good |
| PostgreSQL as system of record | Commerce data integrity and transactional correctness matter most | ✓ Good |
| PgBoss for durable async work | Prevents lost side effects during failures and restarts | ✓ Good |
| WebSockets via Redis Pub/Sub | Provides live order/notification updates without microservice complexity | ✓ Good |
| AI features within backend domain services | Keeps LLM behavior constrained by domain rules and DB truth | — Pending |

---
*Last updated: 2026-10-05 after initialization*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

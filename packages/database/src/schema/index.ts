/**
 * Database schema barrel export.
 *
 * All Drizzle table definitions are re-exported from here.
 * Schema files are grouped by domain (AGENTS.md §7):
 *
 *   auth.schema.ts       — users, sessions, password_reset_tokens
 *   users.schema.ts      — addresses
 *   catalog.schema.ts    — categories, products, product_variants (+ embeddings)
 *   commerce.schema.ts   — carts, cart_items, wishlists, orders, order_items,
 *                           payments, coupons, returns, return_items
 *   fulfillment.schema.ts — shipments, shipment_tracking
 *   notifications.schema.ts — notifications, conversations, messages, outbox_events
 *
 * Schema files are created in Phase 2.
 * This barrel will be populated incrementally.
 */

// TODO: Phase 2 — uncomment as schemas are created
// export * from "./auth.schema";
// export * from "./users.schema";
// export * from "./catalog.schema";
// export * from "./commerce.schema";
// export * from "./fulfillment.schema";
// export * from "./notifications.schema";

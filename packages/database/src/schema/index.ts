/**
 * Database schema barrel export.
 *
 * All Drizzle table definitions are re-exported from here.
 * Schema files are grouped by domain (AGENTS.md §7):
 *
 *   auth.schema.ts         — users, sessions, password_reset_tokens, oauth_accounts
 *   users.schema.ts        — addresses
 *   catalog.schema.ts      — sellers, categories, products, product_variants
 *   commerce.schema.ts     — carts, cart_items, wishlists, wishlist_items,
 *                            orders, order_items, payments, coupons,
 *                            returns, return_items
 *   fulfillment.schema.ts  — shipments, shipment_tracking
 *   notifications.schema.ts — outbox_events, notifications, conversations, messages
 *
 * Each enum is defined in exactly one schema file — no duplicate exports.
 */

export * from "./auth.schema";
export * from "./users.schema";
export * from "./catalog.schema";
export * from "./commerce.schema";
export * from "./fulfillment.schema";
export * from "./notifications.schema";

/**
 * Commerce domain schema.
 *
 * Tables: carts, cart_items, wishlists, wishlist_items,
 *         orders, order_items, payments, coupons,
 *         returns, return_items
 *
 * Key financial integrity rules (PRODUCTION_CHECKLIST §13):
 *  - All money: numeric(12,2)
 *  - order_items snapshot price at purchase time (unit_price_snapshot, subtotal_snapshot)
 *  - orders snapshot shipping_address + coupon at checkout time
 *  - idempotency_key UNIQUE on orders + payments prevents duplicates
 *  - CHECK (quantity > 0) on items prevents zero/negative quantities
 */
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth.schema";
import { products, productVariants, sellers } from "./catalog.schema";

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_IN_TRANSIT",
  "RETURN_RECEIVED",
  "REFUND_PENDING",
  "REFUNDED",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

export const couponTypeEnum = pgEnum("coupon_type", [
  "PERCENTAGE",
  "FIXED",
]);

export const returnReasonEnum = pgEnum("return_reason", [
  "DEFECTIVE",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "CHANGED_MIND",
  "OTHER",
]);

export const returnStatusEnum = pgEnum("return_status", [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "IN_TRANSIT",
  "RECEIVED",
  "REFUND_PENDING",
  "REFUNDED",
]);

// ─────────────────────────────────────────────
// COUPONS
// (defined before orders because orders references coupons)
// ─────────────────────────────────────────────

export const coupons = pgTable(
  "coupons",
  {
    id:                  uuid("id").primaryKey().defaultRandom(),
    code:                text("code").notNull(),
    type:                couponTypeEnum("type").notNull(),
    value:               numeric("value", { precision: 12, scale: 2 }).notNull(),
    minimumOrderValue:   numeric("minimum_order_value", { precision: 12, scale: 2 }),
    maximumDiscount:     numeric("maximum_discount", { precision: 12, scale: 2 }),
    usageLimit:          integer("usage_limit"),
    usedCount:           integer("used_count").notNull().default(0),
    startsAt:            timestamp("starts_at", { withTimezone: true }),
    expiresAt:           timestamp("expires_at", { withTimezone: true }),
    isActive:            boolean("is_active").notNull().default(true),
    createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx:        uniqueIndex("coupons_code_idx").on(t.code),
    // Index for "find active, non-expired coupons" check
    activeExpiryIdx: index("coupons_active_expiry_idx").on(t.isActive, t.expiresAt),
    valueCheck:     check("coupons_value_positive", sql`${t.value} > 0`),
  }),
);

// ─────────────────────────────────────────────
// CARTS
// One cart per user — created lazily on first add.
// ─────────────────────────────────────────────

export const carts = pgTable(
  "carts",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    userId:    uuid("user_id")
                 .notNull()
                 .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Enforce one cart per user at the DB level
    userIdIdx: uniqueIndex("carts_user_id_idx").on(t.userId),
  }),
);

// ─────────────────────────────────────────────
// CART ITEMS
// ─────────────────────────────────────────────

export const cartItems = pgTable(
  "cart_items",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    cartId:    uuid("cart_id")
                 .notNull()
                 .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
                 .notNull()
                 .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
                 .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity:  integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cartIdIdx:     index("cart_items_cart_id_idx").on(t.cartId),
    productIdIdx:  index("cart_items_product_id_idx").on(t.productId),
    // One row per variant per cart — merging duplicate adds is handled at service layer
    cartVariantIdx: uniqueIndex("cart_items_cart_variant_idx").on(t.cartId, t.variantId),
    quantityCheck:  check("cart_items_quantity_positive", sql`${t.quantity} > 0`),
  }),
);

// ─────────────────────────────────────────────
// WISHLISTS
// One wishlist per user.
// ─────────────────────────────────────────────

export const wishlists = pgTable(
  "wishlists",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    userId:    uuid("user_id")
                 .notNull()
                 .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: uniqueIndex("wishlists_user_id_idx").on(t.userId),
  }),
);

// ─────────────────────────────────────────────
// WISHLIST ITEMS
// ─────────────────────────────────────────────

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    wishlistId: uuid("wishlist_id")
                  .notNull()
                  .references(() => wishlists.id, { onDelete: "cascade" }),
    productId:  uuid("product_id")
                  .notNull()
                  .references(() => products.id, { onDelete: "cascade" }),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wishlistIdIdx: index("wishlist_items_wishlist_id_idx").on(t.wishlistId),
    // A product can appear only once per wishlist
    wishlistProductIdx: uniqueIndex("wishlist_items_wishlist_product_idx").on(
      t.wishlistId,
      t.productId,
    ),
  }),
);

// ─────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────

export const orders = pgTable(
  "orders",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    // Human-readable order reference, e.g. ORD-20261005-0001
    orderNumber:     text("order_number").notNull(),
    // Client-supplied idempotency key prevents duplicate order creation on retry
    idempotencyKey:  text("idempotency_key").notNull(),
    userId:          uuid("user_id")
                       .notNull()
                       .references(() => users.id),
    // Snapshot of shipping address at checkout time.
    // Protects historical accuracy if user later updates their address.
    shippingAddress: jsonb("shipping_address").notNull(),
    billingAddress:  jsonb("billing_address"),
    couponId:        uuid("coupon_id")
                       .references(() => coupons.id),
    // Snapshot of coupon terms at checkout time.
    // Protects historical accuracy if coupon is later modified.
    couponSnapshot:  jsonb("coupon_snapshot"),
    // All money values: numeric(12,2) — server-calculated, never trusted from client
    subtotal:        numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    discount:        numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
    shippingFee:     numeric("shipping_fee", { precision: 12, scale: 2 }).notNull().default("0"),
    tax:             numeric("tax", { precision: 12, scale: 2 }).notNull().default("0"),
    total:           numeric("total", { precision: 12, scale: 2 }).notNull(),
    status:          orderStatusEnum("status").notNull().default("PENDING"),
    paymentStatus:   paymentStatusEnum("payment_status").notNull().default("PENDING"),
    notes:           text("notes"),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderNumberIdx:   uniqueIndex("orders_order_number_idx").on(t.orderNumber),
    idempotencyIdx:   uniqueIndex("orders_idempotency_key_idx").on(t.idempotencyKey),
    userIdIdx:        index("orders_user_id_idx").on(t.userId),
    statusIdx:        index("orders_status_idx").on(t.status),
    // Composite index for seller order queries (filter by status + user)
    userStatusIdx:    index("orders_user_status_idx").on(t.userId, t.status),
    createdAtIdx:     index("orders_created_at_idx").on(t.createdAt),
  }),
);

// ─────────────────────────────────────────────
// ORDER ITEMS
// Snapshot of purchase-time data — never updated after order creation.
// ─────────────────────────────────────────────

export const orderItems = pgTable(
  "order_items",
  {
    id:                  uuid("id").primaryKey().defaultRandom(),
    orderId:             uuid("order_id")
                           .notNull()
                           .references(() => orders.id, { onDelete: "cascade" }),
    productId:           uuid("product_id")
                           .notNull()
                           .references(() => products.id),
    variantId:           uuid("variant_id")
                           .references(() => productVariants.id),
    sellerId:            uuid("seller_id")
                           .notNull()
                           .references(() => sellers.id),
    // Immutable snapshots — later catalog changes NEVER affect existing orders
    titleSnapshot:       text("title_snapshot").notNull(),
    skuSnapshot:         text("sku_snapshot").notNull(),
    attributesSnapshot:  jsonb("attributes_snapshot"),
    // Price at time of purchase — server-calculated, not from client
    unitPriceSnapshot:   numeric("unit_price_snapshot", { precision: 12, scale: 2 }).notNull(),
    quantity:            integer("quantity").notNull(),
    // Pre-calculated to avoid re-multiplication at read time
    subtotalSnapshot:    numeric("subtotal_snapshot", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => ({
    orderIdIdx:   index("order_items_order_id_idx").on(t.orderId),
    productIdIdx: index("order_items_product_id_idx").on(t.productId),
    sellerIdIdx:  index("order_items_seller_id_idx").on(t.sellerId),
    variantIdIdx: index("order_items_variant_id_idx").on(t.variantId),
    quantityCheck: check("order_items_quantity_positive", sql`${t.quantity} > 0`),
  }),
);

// ─────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────

export const payments = pgTable(
  "payments",
  {
    id:                uuid("id").primaryKey().defaultRandom(),
    orderId:           uuid("order_id")
                         .notNull()
                         .references(() => orders.id),
    provider:          text("provider").notNull(),      // "cod", "stripe", "paystack"
    // External provider transaction ID — null until provider confirms
    providerPaymentId: text("provider_payment_id"),
    // Server-calculated from the order — client amount is never trusted
    amount:            numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency:          text("currency").notNull().default("USD"),
    method:            text("method"),                  // "card", "cod", "bank_transfer"
    status:            paymentStatusEnum("status").notNull().default("PENDING"),
    // Prevents duplicate payment records on retry
    idempotencyKey:    text("idempotency_key").notNull(),
    // Provider-specific webhook/response data — never contains raw card details
    metadata:          jsonb("metadata"),
    createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdIdx:          index("payments_order_id_idx").on(t.orderId),
    // Unique to prevent duplicate provider transaction records
    providerPaymentIdx:  uniqueIndex("payments_provider_payment_id_idx").on(t.providerPaymentId),
    idempotencyIdx:      uniqueIndex("payments_idempotency_key_idx").on(t.idempotencyKey),
    statusIdx:           index("payments_status_idx").on(t.status),
  }),
);

// ─────────────────────────────────────────────
// RETURNS
// ─────────────────────────────────────────────

export const returns = pgTable(
  "returns",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    orderId:      uuid("order_id")
                    .notNull()
                    .references(() => orders.id),
    userId:       uuid("user_id")
                    .notNull()
                    .references(() => users.id),
    returnNumber: text("return_number").notNull(),
    reason:       returnReasonEnum("reason").notNull(),
    description:  text("description"),
    images:       jsonb("images").notNull().default([]),
    refundAmount: numeric("refund_amount", { precision: 12, scale: 2 }),
    status:       returnStatusEnum("status").notNull().default("REQUESTED"),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    returnNumberIdx: uniqueIndex("returns_return_number_idx").on(t.returnNumber),
    orderIdIdx:      index("returns_order_id_idx").on(t.orderId),
    userIdIdx:       index("returns_user_id_idx").on(t.userId),
    statusIdx:       index("returns_status_idx").on(t.status),
  }),
);

// ─────────────────────────────────────────────
// RETURN ITEMS
// ─────────────────────────────────────────────

export const returnItems = pgTable(
  "return_items",
  {
    id:               uuid("id").primaryKey().defaultRandom(),
    returnId:         uuid("return_id")
                        .notNull()
                        .references(() => returns.id, { onDelete: "cascade" }),
    orderItemId:      uuid("order_item_id")
                        .notNull()
                        .references(() => orderItems.id),
    quantity:         integer("quantity").notNull(),
    unitRefundAmount: numeric("unit_refund_amount", { precision: 12, scale: 2 }),
  },
  (t) => ({
    returnIdIdx:      index("return_items_return_id_idx").on(t.returnId),
    orderItemIdIdx:   index("return_items_order_item_id_idx").on(t.orderItemId),
    quantityCheck:    check("return_items_quantity_positive", sql`${t.quantity} > 0`),
  }),
);

// ─────────────────────────────────────────────
// REVIEWS
// Linked to an order to enforce verified-purchase rule.
// One review per user per product per order (unique constraint).
// ─────────────────────────────────────────────

export const reviewStatusEnum = pgEnum("review_status", [
  "PENDING",
  "PUBLISHED",
  "REJECTED",
]);

export const reviews = pgTable(
  "reviews",
  {
    id:               uuid("id").primaryKey().defaultRandom(),
    userId:           uuid("user_id")
                        .notNull()
                        .references(() => users.id),
    productId:        uuid("product_id")
                        .notNull()
                        .references(() => products.id),
    // orderId enforces verified purchase — reviewer must have a delivered order
    orderId:          uuid("order_id")
                        .notNull()
                        .references(() => orders.id),
    rating:           integer("rating").notNull(),
    title:            text("title"),
    comment:          text("comment"),
    images:           jsonb("images").notNull().default([]),
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    status:           reviewStatusEnum("status").notNull().default("PENDING"),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    productIdIdx: index("reviews_product_id_idx").on(t.productId),
    userIdIdx:    index("reviews_user_id_idx").on(t.userId),
    // One review per user per product per order
    userProductOrderIdx: uniqueIndex("reviews_user_product_order_idx").on(t.userId, t.productId, t.orderId),
    // Rating must be 1-5
    ratingCheck:  check("reviews_rating_range", sql`${t.rating} >= 1 AND ${t.rating} <= 5`),
    statusIdx:    index("reviews_status_idx").on(t.status),
  }),
);

// ---- Types -----------------------------------------------------------------

export type Coupon       = typeof coupons.$inferSelect;
export type NewCoupon    = typeof coupons.$inferInsert;
export type Cart         = typeof carts.$inferSelect;
export type NewCart      = typeof carts.$inferInsert;
export type CartItem     = typeof cartItems.$inferSelect;
export type NewCartItem  = typeof cartItems.$inferInsert;
export type Wishlist     = typeof wishlists.$inferSelect;
export type NewWishlist  = typeof wishlists.$inferInsert;
export type WishlistItem    = typeof wishlistItems.$inferSelect;
export type NewWishlistItem = typeof wishlistItems.$inferInsert;
export type Order        = typeof orders.$inferSelect;
export type NewOrder     = typeof orders.$inferInsert;
export type OrderItem    = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type Payment      = typeof payments.$inferSelect;
export type NewPayment   = typeof payments.$inferInsert;
export type Return       = typeof returns.$inferSelect;
export type NewReturn    = typeof returns.$inferInsert;
export type ReturnItem   = typeof returnItems.$inferSelect;
export type NewReturnItem = typeof returnItems.$inferInsert;
export type Review       = typeof reviews.$inferSelect;
export type NewReview    = typeof reviews.$inferInsert;

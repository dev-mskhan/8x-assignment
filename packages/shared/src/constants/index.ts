/**
 * Shared constants.
 *
 * Only truly cross-cutting constants belong here.
 * Module-specific constants live in their respective modules.
 */

/** API version prefix */
export const API_VERSION = "v1" as const;
export const API_BASE = `/api/${API_VERSION}` as const;

/** Default pagination limits */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** User roles */
export const USER_ROLES = {
  CUSTOMER: "CUSTOMER",
  SELLER: "SELLER",
  ADMIN: "ADMIN",
} as const;

/** Order status values — full lifecycle */
export const ORDER_STATUS = {
  CART: "CART",
  CHECKOUT: "CHECKOUT",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_SUCCEEDED: "PAYMENT_SUCCEEDED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  CONFIRMED: "CONFIRMED",
  PROCESSING: "PROCESSING",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  RETURN_REQUESTED: "RETURN_REQUESTED",
  RETURN_APPROVED: "RETURN_APPROVED",
  RETURN_REJECTED: "RETURN_REJECTED",
  RETURN_IN_TRANSIT: "RETURN_IN_TRANSIT",
  RETURN_RECEIVED: "RETURN_RECEIVED",
  REFUND_PENDING: "REFUND_PENDING",
  REFUNDED: "REFUNDED",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** Payment status values */
export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

/** Outbox event status values */
export const OUTBOX_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

/** Domain event types — all PgBoss jobs and outbox events */
export const EVENT_TYPES = {
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_CONFIRMED: "ORDER_CONFIRMED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  PAYMENT_SUCCEEDED: "PAYMENT_SUCCEEDED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  SHIPMENT_CREATED: "SHIPMENT_CREATED",
  ORDER_SHIPPED: "ORDER_SHIPPED",
  ORDER_DELIVERED: "ORDER_DELIVERED",
  RETURN_CREATED: "RETURN_CREATED",
  REFUND_COMPLETED: "REFUND_COMPLETED",
  REVIEW_CREATED: "REVIEW_CREATED",
  NOTIFICATION_CREATED: "NOTIFICATION_CREATED",
  MESSAGE_CREATED: "MESSAGE_CREATED",
  PRODUCT_PUBLISHED: "PRODUCT_PUBLISHED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  SELLER_APPROVED: "SELLER_APPROVED",
  SELLER_REJECTED: "SELLER_REJECTED",
  USER_REGISTERED: "USER_REGISTERED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/** Redis channel naming helpers */
export const REDIS_CHANNELS = {
  userEvents: (userId: string) => `user:${userId}:events`,
  conversationEvents: (conversationId: string) =>
    `conversation:${conversationId}:events`,
  systemEvents: () => `system:events`,
} as const;

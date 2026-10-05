/**
 * Fulfillment domain schema.
 *
 * Tables: shipments, shipment_tracking
 *
 * Shipment tracking events use a separate table (not JSONB array) so individual
 * events are queryable and properly indexed by timestamp.
 */
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { orders } from "./commerce.schema";

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "PENDING",
  "SHIPPED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
]);

// ─────────────────────────────────────────────
// SHIPMENTS
// ─────────────────────────────────────────────

export const shipments = pgTable(
  "shipments",
  {
    id:                uuid("id").primaryKey().defaultRandom(),
    orderId:           uuid("order_id")
                         .notNull()
                         .references(() => orders.id),
    carrier:           text("carrier"),
    trackingNumber:    text("tracking_number"),
    status:            shipmentStatusEnum("status").notNull().default("PENDING"),
    estimatedDelivery: timestamp("estimated_delivery", { withTimezone: true }),
    shippedAt:         timestamp("shipped_at", { withTimezone: true }),
    deliveredAt:       timestamp("delivered_at", { withTimezone: true }),
    createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdIdx:        index("shipments_order_id_idx").on(t.orderId),
    trackingNumberIdx: index("shipments_tracking_number_idx").on(t.trackingNumber),
    statusIdx:         index("shipments_status_idx").on(t.status),
  }),
);

// ─────────────────────────────────────────────
// SHIPMENT TRACKING EVENTS
// Individual events — queryable and sortable by timestamp.
// ─────────────────────────────────────────────

export const shipmentTracking = pgTable(
  "shipment_tracking",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    shipmentId:  uuid("shipment_id")
                   .notNull()
                   .references(() => shipments.id, { onDelete: "cascade" }),
    status:      text("status").notNull(),
    location:    text("location"),
    description: text("description"),
    // When this event actually occurred (not when it was recorded)
    occurredAt:  timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shipmentIdIdx:    index("shipment_tracking_shipment_id_idx").on(t.shipmentId),
    // Chronological query index — ORDER BY occurred_at ASC for timeline view
    occurredAtIdx:    index("shipment_tracking_occurred_at_idx").on(t.shipmentId, t.occurredAt),
  }),
);

// ---- Types -----------------------------------------------------------------

export type Shipment         = typeof shipments.$inferSelect;
export type NewShipment      = typeof shipments.$inferInsert;
export type ShipmentTracking    = typeof shipmentTracking.$inferSelect;
export type NewShipmentTracking = typeof shipmentTracking.$inferInsert;

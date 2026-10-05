/**
 * Notifications domain schema.
 *
 * Tables: outbox_events, notifications, conversations, messages
 *
 * Architecture:
 *   Business transaction → PostgreSQL + outbox_events INSERT
 *     → OutboxPublisher polls pending events
 *     → sendJob() → PgBoss → Worker
 *     → Notification row INSERT
 *     → Redis Pub/Sub → WebSocket → Browser
 *
 * outbox_events schema must exactly match what core/events/outbox.ts queries:
 *   status = 'pending' → mark 'processing' → mark 'completed'/'failed'
 *   Indexed on (status, created_at) for the poll query.
 *
 * Redis Pub/Sub is ephemeral. The notifications table is the durable truth.
 */
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.schema";

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const notificationTypeEnum = pgEnum("notification_type", [
  "ORDER",
  "PAYMENT",
  "SHIPMENT",
  "RETURN",
  "PROMOTION",
  "SYSTEM",
  "REVIEW",
]);

export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "USER",
  "ASSISTANT",
]);

// ─────────────────────────────────────────────
// OUTBOX EVENTS
// Committed atomically with business transactions.
// OutboxPublisher polls pending → dispatches via PgBoss.
// ─────────────────────────────────────────────

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id:            uuid("id").primaryKey().defaultRandom(),
    type:          text("type").notNull(),          // e.g. "ORDER_CREATED", "PAYMENT_COMPLETED"
    aggregateId:   text("aggregate_id").notNull(),  // e.g. orderId, paymentId
    aggregateType: text("aggregate_type").notNull(), // e.g. "order", "payment"
    payload:       jsonb("payload").notNull(),
    status:        outboxStatusEnum("status").notNull().default("pending"),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt:   timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    // Critical: outbox publisher polls WHERE status = 'pending' ORDER BY created_at ASC
    statusCreatedAtIdx: index("outbox_events_status_created_at_idx").on(t.status, t.createdAt),
    aggregateIdIdx:     index("outbox_events_aggregate_id_idx").on(t.aggregateId),
  }),
);

// ─────────────────────────────────────────────
// NOTIFICATIONS
// Durable per-user notification records.
// read_at = null means unread.
// ─────────────────────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    userId:    uuid("user_id")
                 .notNull()
                 .references(() => users.id, { onDelete: "cascade" }),
    type:      notificationTypeEnum("type").notNull(),
    title:     text("title").notNull(),
    message:   text("message").notNull(),
    // Stores only stable reference IDs, not copies of mutable business data:
    // { orderId, productId, sellerId, etc. }
    data:      jsonb("data"),
    // null = unread, timestamp = when marked read
    readAt:    timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:       index("notifications_user_id_idx").on(t.userId),
    // Used for unread count query: WHERE user_id = ? AND read_at IS NULL
    userReadAtIdx:   index("notifications_user_read_at_idx").on(t.userId, t.readAt),
    createdAtIdx:    index("notifications_created_at_idx").on(t.createdAt),
  }),
);

// ─────────────────────────────────────────────
// AI CONVERSATIONS
// ─────────────────────────────────────────────

export const conversations = pgTable(
  "conversations",
  {
    id:            uuid("id").primaryKey().defaultRandom(),
    userId:        uuid("user_id")
                     .notNull()
                     .references(() => users.id, { onDelete: "cascade" }),
    title:         text("title"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:        index("conversations_user_id_idx").on(t.userId),
    lastMessageAtIdx: index("conversations_last_message_at_idx").on(t.userId, t.lastMessageAt),
  }),
);

// ─────────────────────────────────────────────
// AI MESSAGES
// ─────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
                      .notNull()
                      .references(() => conversations.id, { onDelete: "cascade" }),
    role:           messageRoleEnum("role").notNull(),
    content:        text("content").notNull(),
    // Product IDs referenced or recommended in this message (not product snapshots)
    productIds:     jsonb("product_ids").notNull().default([]),
    // Provider-specific metadata: model, tokens, finish_reason, etc.
    metadata:       jsonb("metadata"),
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationIdIdx: index("messages_conversation_id_idx").on(t.conversationId),
    // For loading conversation history in chronological order
    conversationTimeIdx: index("messages_conversation_created_at_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  }),
);

// ---- Types -----------------------------------------------------------------

export type OutboxEvent     = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent  = typeof outboxEvents.$inferInsert;
export type Notification    = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Conversation    = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message         = typeof messages.$inferSelect;
export type NewMessage      = typeof messages.$inferInsert;

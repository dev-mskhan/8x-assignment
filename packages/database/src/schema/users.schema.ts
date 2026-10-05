/**
 * Users domain schema.
 *
 * Tables: addresses
 *
 * Intentionally separate from auth.schema.ts per AGENTS.md §7 domain grouping.
 * The FK references auth.users — this is a user profile concern, not an auth concern.
 */
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.schema";

// ─────────────────────────────────────────────
// ADDRESSES
// ─────────────────────────────────────────────

export const addresses = pgTable(
  "addresses",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    userId:       uuid("user_id")
                    .notNull()
                    .references(() => users.id, { onDelete: "cascade" }),
    label:        text("label"),            // "Home", "Office", etc. — optional display hint
    fullName:     text("full_name").notNull(),
    phone:        text("phone").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city:         text("city").notNull(),
    state:        text("state"),
    postalCode:   text("postal_code").notNull(),
    country:      text("country").notNull(),
    // isDefault uniqueness is enforced at the service layer (only one default per user)
    isDefault:    boolean("is_default").notNull().default(false),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx:         index("addresses_user_id_idx").on(t.userId),
    // Composite index for fast "find default address for user" query
    userDefaultIdx:    index("addresses_user_default_idx").on(t.userId, t.isDefault),
  }),
);

// ---- Types -----------------------------------------------------------------

export type Address    = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;

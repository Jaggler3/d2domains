import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const charges = pgTable("charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: text("order_id").notNull().unique(),
  userId: text("user_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("succeeded"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Charge = typeof charges.$inferSelect;
export type NewCharge = typeof charges.$inferInsert;

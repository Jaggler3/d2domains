import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  domainName: text("domain_name").notNull(),
  years: integer("years").notNull().default(1),
  purchaseType: text("purchase_type").notNull().default("registration"),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  domainName: text("domain_name").notNull().unique(),
  status: text("status").notNull().default("active"),
  years: integer("years").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  orderId: text("order_id").notNull().unique(),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;

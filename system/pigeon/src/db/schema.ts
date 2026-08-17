import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { AddonLine } from "../adapters/weasel";

export const provisioning = pgTable(
  "provisioning",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: text("order_id").notNull().unique(),
    userId: text("user_id").notNull(),
    domainName: text("domain_name").notNull(),
    addons: jsonb("addons").$type<AddonLine[]>().notNull(),
    status: text("status").notNull().default("provisioning"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provisioning_order_id_idx").on(t.orderId)],
);

export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: text("order_id").notNull(),
    address: text("address").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mailboxes_order_id_idx").on(t.orderId),
    uniqueIndex("mailboxes_order_address_unique").on(t.orderId, t.address),
  ],
);

export type ProvisioningRow = typeof provisioning.$inferSelect;
export type NewProvisioningRow = typeof provisioning.$inferInsert;
export type MailboxRow = typeof mailboxes.$inferSelect;
export type NewMailboxRow = typeof mailboxes.$inferInsert;
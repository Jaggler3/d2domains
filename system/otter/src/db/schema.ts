import { pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  domainName: text("domain_name").notNull().unique(),
  pulled: boolean("pulled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const records = pgTable("records", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  value: text("value").notNull(),
  ttl: integer("ttl").notNull().default(3600),
  priority: integer("priority"),
  registryRecordId: text("registry_record_id"),
  syncStatus: text("sync_status").notNull().default("pending"),
  syncError: text("sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Zone = typeof zones.$inferSelect;
export type NewZone = typeof zones.$inferInsert;
export type Record = typeof records.$inferSelect;
export type NewRecord = typeof records.$inferInsert;

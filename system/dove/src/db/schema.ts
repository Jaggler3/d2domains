import { pgTable, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

// Stalwart SQL directory — these exact tables/queries are what Stalwart's
// Sql Directory object reads. dove owns writing them.

export const accounts = pgTable("accounts", {
  name: text("name").primaryKey(),
  secret: text("secret").notNull(),
  description: text("description"),
  type: text("type").notNull().default("individual"),
  active: boolean("active").notNull().default(true),
});

export const groupMembers = pgTable("group_members", {
  name: text("name").notNull(),
  memberOf: text("member_of").notNull(),
  primaryKey: text("_pk").primaryKey(),
});

export const emails = pgTable("emails", {
  name: text("name").notNull(),
  address: text("address").notNull(),
  type: text("type"),
});

// dove's own provisioning bookkeeping (not read by Stalwart).

export const domains = pgTable("dove_domains", {
  id: text("id").primaryKey(),
  domainName: text("domain_name").notNull().unique(),
  stalwartDomainId: text("stalwart_domain_id"),
  orderId: text("order_id"),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  dnsPublished: boolean("dns_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mailboxes = pgTable("dove_mailboxes", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull(),
  userId: text("user_id").notNull(),
  address: text("address").notNull().unique(),
  accountName: text("account_name").notNull(),
  secret: text("secret").notNull(),
  orderId: text("order_id"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const provisioning = pgTable("dove_provisioning", {
  orderId: text("order_id").primaryKey(),
  domainName: text("domain_name").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
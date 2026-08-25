CREATE TABLE "accounts" (
	"name" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'individual' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dove_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_name" text NOT NULL,
	"stalwart_domain_id" text,
	"order_id" text,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dove_domains_domain_name_unique" UNIQUE("domain_name")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"name" text NOT NULL,
	"address" text NOT NULL,
	"type" text
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"name" text NOT NULL,
	"member_of" text NOT NULL,
	"_pk" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dove_mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"account_name" text NOT NULL,
	"secret" text NOT NULL,
	"order_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dove_mailboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "dove_provisioning" (
	"order_id" text PRIMARY KEY NOT NULL,
	"domain_name" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"address" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"user_id" text NOT NULL,
	"domain_name" text NOT NULL,
	"addons" jsonb NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE INDEX "mailboxes_order_id_idx" ON "mailboxes" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_order_address_unique" ON "mailboxes" USING btree ("order_id","address");--> statement-breakpoint
CREATE INDEX "provisioning_order_id_idx" ON "provisioning" USING btree ("order_id");
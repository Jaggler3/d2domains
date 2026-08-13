CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"years" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" text NOT NULL,
	CONSTRAINT "domains_domain_name_unique" UNIQUE("domain_name"),
	CONSTRAINT "domains_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain_name" text NOT NULL,
	"years" integer DEFAULT 1 NOT NULL,
	"purchase_type" text DEFAULT 'registration' NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key")
);

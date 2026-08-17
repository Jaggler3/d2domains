ALTER TABLE "orders" ADD COLUMN "total_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "addons" jsonb DEFAULT '[]'::jsonb NOT NULL;
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"ttl" integer DEFAULT 3600 NOT NULL,
	"priority" integer,
	"registry_record_id" text,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain_name" text NOT NULL,
	"pulled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_domain_name_unique" UNIQUE("domain_name")
);
--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;
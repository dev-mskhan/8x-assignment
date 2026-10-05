DO $$ BEGIN
 CREATE TYPE "public"."review_status" AS ENUM('PENDING', 'PUBLISHED', 'REJECTED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"comment" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_purchase" boolean DEFAULT false NOT NULL,
	"status" "review_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_product_id_idx" ON "reviews" ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_user_id_idx" ON "reviews" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_user_product_order_idx" ON "reviews" ("user_id","product_id","order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_status_idx" ON "reviews" ("status");
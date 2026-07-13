CREATE TABLE "birrjs_used_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_url" text NOT NULL,
	"subscription_id" text NOT NULL,
	"used_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birrjs_used_receipt" ADD CONSTRAINT "birrjs_used_receipt_subscription_id_birrjs_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."birrjs_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_used_receipt_url_unique" ON "birrjs_used_receipt" USING btree ("receipt_url");
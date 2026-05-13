CREATE TABLE "birrjs_entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text,
	"customer_id" text NOT NULL,
	"feature_id" text NOT NULL,
	"limit" integer,
	"balance" integer,
	"next_reset_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birrjs_entitlement" ADD CONSTRAINT "birrjs_entitlement_subscription_id_birrjs_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."birrjs_subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_entitlement" ADD CONSTRAINT "birrjs_entitlement_customer_id_birrjs_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."birrjs_customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_entitlement" ADD CONSTRAINT "birrjs_entitlement_feature_id_birrjs_feature_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."birrjs_feature"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "birrjs_entitlement_subscription_idx" ON "birrjs_entitlement" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "birrjs_entitlement_customer_feature_idx" ON "birrjs_entitlement" USING btree ("customer_id","feature_id");--> statement-breakpoint
CREATE INDEX "birrjs_entitlement_next_reset_idx" ON "birrjs_entitlement" USING btree ("next_reset_at");
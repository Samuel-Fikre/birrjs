CREATE TABLE "birrjs_trial_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"customer_email" text,
	"phone_hash" text,
	"plan_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"redeemed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birrjs_plan" ADD COLUMN "trial_days" integer;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ADD COLUMN "trial_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_trial_redemption" ADD CONSTRAINT "birrjs_trial_redemption_customer_id_birrjs_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."birrjs_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_trial_redemption" ADD CONSTRAINT "birrjs_trial_redemption_subscription_id_birrjs_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."birrjs_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_trial_redemption_customer_plan_unique" ON "birrjs_trial_redemption" USING btree ("customer_id","plan_id");--> statement-breakpoint
CREATE INDEX "birrjs_trial_redemption_customer_idx" ON "birrjs_trial_redemption" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "birrjs_trial_redemption_email_idx" ON "birrjs_trial_redemption" USING btree ("customer_email");--> statement-breakpoint
CREATE INDEX "birrjs_trial_redemption_phone_hash_idx" ON "birrjs_trial_redemption" USING btree ("phone_hash");
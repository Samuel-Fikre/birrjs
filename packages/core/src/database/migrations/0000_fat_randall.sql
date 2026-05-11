CREATE TABLE "birrjs_customer" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"metadata" jsonb,
	"deleted_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birrjs_feature" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birrjs_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"subscription_id" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'ETB',
	"status" text NOT NULL,
	"provider_tx_ref" text,
	"description" text,
	"period_start_at" timestamp,
	"period_end_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "birrjs_invoice_amount_non_negative" CHECK (amount >= 0)
);
--> statement-breakpoint
CREATE TABLE "birrjs_plan" (
	"id" text NOT NULL,
	"internal_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"price_amount" integer,
	"price_interval" text,
	"currency" text DEFAULT 'ETB',
	"features" jsonb,
	"provider" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "birrjs_plan_price_amount_non_negative" CHECK (price_amount IS NULL OR price_amount >= 0)
);
--> statement-breakpoint
CREATE TABLE "birrjs_plan_feature" (
	"plan_id" text NOT NULL,
	"feature_id" text NOT NULL,
	"limit" integer,
	"reset_interval" text,
	"config" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "birrjs_plan_feature_plan_id_feature_id_pk" PRIMARY KEY("plan_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "birrjs_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp,
	"expires_at" timestamp,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"failed_at" timestamp,
	"expired_at" timestamp,
	"last_payment_at" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider_tx_ref" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birrjs_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_reference_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"trace_id" text,
	"received_at" timestamp NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD CONSTRAINT "birrjs_invoice_customer_id_birrjs_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."birrjs_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD CONSTRAINT "birrjs_invoice_subscription_id_birrjs_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."birrjs_subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_plan_feature" ADD CONSTRAINT "birrjs_plan_feature_plan_id_birrjs_plan_internal_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."birrjs_plan"("internal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_plan_feature" ADD CONSTRAINT "birrjs_plan_feature_feature_id_birrjs_feature_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."birrjs_feature"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ADD CONSTRAINT "birrjs_subscription_customer_id_birrjs_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."birrjs_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ADD CONSTRAINT "birrjs_subscription_plan_id_birrjs_plan_internal_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."birrjs_plan"("internal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "birrjs_customer_deleted_at_idx" ON "birrjs_customer" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "birrjs_invoice_customer_idx" ON "birrjs_invoice" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "birrjs_invoice_subscription_idx" ON "birrjs_invoice" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "birrjs_plan_default_idx" ON "birrjs_plan" USING btree ("is_default");--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_plan_id_version_unique" ON "birrjs_plan" USING btree ("id","version");--> statement-breakpoint
CREATE INDEX "birrjs_plan_feature_plan_idx" ON "birrjs_plan_feature" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "birrjs_subscription_customer_status_idx" ON "birrjs_subscription" USING btree ("customer_id","status","ended_at");--> statement-breakpoint
CREATE INDEX "birrjs_subscription_plan_idx" ON "birrjs_subscription" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_webhook_event_provider_unique" ON "birrjs_webhook_event" USING btree ("provider_id","provider_reference_id");--> statement-breakpoint
CREATE INDEX "birrjs_webhook_event_status_idx" ON "birrjs_webhook_event" USING btree ("provider_id","status");
CREATE TABLE "birrjs_subscription_plan_change" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"from_plan_internal_id" text NOT NULL,
	"to_plan_internal_id" text NOT NULL,
	"direction" text NOT NULL,
	"strategy" text NOT NULL,
	"debit_amount" integer DEFAULT 0 NOT NULL,
	"credit_amount" integer DEFAULT 0 NOT NULL,
	"due_now_amount" integer DEFAULT 0 NOT NULL,
	"banked_credit_amount" integer DEFAULT 0 NOT NULL,
	"deferred_amount" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'ETB' NOT NULL,
	"cycle_start_at" timestamp with time zone NOT NULL,
	"cycle_end_at" timestamp with time zone,
	"status" text NOT NULL,
	"provider_tx_ref" text,
	"quote_hash" text,
	"carry_over_usage" boolean DEFAULT true NOT NULL,
	"reason" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "birrjs_plan_change_direction_valid" CHECK ("birrjs_subscription_plan_change"."direction" IN ('upgrade', 'downgrade', 'switch')),
	CONSTRAINT "birrjs_plan_change_status_valid" CHECK ("birrjs_subscription_plan_change"."status" IN ('pending', 'applied', 'voided', 'failed')),
	CONSTRAINT "birrjs_plan_change_strategy_valid" CHECK ("birrjs_subscription_plan_change"."strategy" IN ('keep_anchor', 'rebase')),
	CONSTRAINT "birrjs_plan_change_amounts_non_negative" CHECK (debit_amount >= 0 AND credit_amount >= 0)
);
--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD COLUMN "plan_change_id" text;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD COLUMN "kind" text DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD COLUMN "refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD COLUMN "lines" jsonb;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ADD COLUMN "period_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ADD COLUMN "pending_change_id" text;--> statement-breakpoint
ALTER TABLE "birrjs_subscription_plan_change" ADD CONSTRAINT "birrjs_subscription_plan_change_subscription_id_birrjs_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."birrjs_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_subscription_plan_change" ADD CONSTRAINT "birrjs_subscription_plan_change_customer_id_birrjs_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."birrjs_customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_subscription_plan_change" ADD CONSTRAINT "birrjs_subscription_plan_change_from_plan_internal_id_birrjs_plan_internal_id_fk" FOREIGN KEY ("from_plan_internal_id") REFERENCES "public"."birrjs_plan"("internal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birrjs_subscription_plan_change" ADD CONSTRAINT "birrjs_subscription_plan_change_to_plan_internal_id_birrjs_plan_internal_id_fk" FOREIGN KEY ("to_plan_internal_id") REFERENCES "public"."birrjs_plan"("internal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_plan_change_pending_unique" ON "birrjs_subscription_plan_change" USING btree ("subscription_id") WHERE "birrjs_subscription_plan_change"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_plan_change_tx_ref_unique" ON "birrjs_subscription_plan_change" USING btree ("provider_tx_ref") WHERE "birrjs_subscription_plan_change"."provider_tx_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "birrjs_plan_change_subscription_idx" ON "birrjs_subscription_plan_change" USING btree ("subscription_id","status");--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD CONSTRAINT "birrjs_invoice_plan_change_id_birrjs_subscription_plan_change_id_fk" FOREIGN KEY ("plan_change_id") REFERENCES "public"."birrjs_subscription_plan_change"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "birrjs_invoice_plan_change_idx" ON "birrjs_invoice" USING btree ("plan_change_id");--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD CONSTRAINT "birrjs_invoice_kind_valid" CHECK ("birrjs_invoice"."kind" IN ('recurring', 'proration'));--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ADD CONSTRAINT "birrjs_invoice_refunded_within_amount" CHECK ("birrjs_invoice"."refunded_amount" >= 0 AND "birrjs_invoice"."refunded_amount" <= "birrjs_invoice"."amount");
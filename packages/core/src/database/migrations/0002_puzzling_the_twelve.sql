DROP INDEX "birrjs_plan_default_idx";--> statement-breakpoint
ALTER TABLE "birrjs_customer" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_customer" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_customer" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_entitlement" ALTER COLUMN "next_reset_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_entitlement" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_entitlement" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_feature" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_feature" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ALTER COLUMN "period_start_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ALTER COLUMN "period_end_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_invoice" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_plan" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_plan" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_plan_feature" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_plan_feature" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ALTER COLUMN "canceled_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ALTER COLUMN "ended_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ALTER COLUMN "last_payment_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_webhook_event" ALTER COLUMN "received_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birrjs_webhook_event" ALTER COLUMN "processed_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_plan_single_default" ON "birrjs_plan" USING btree ("is_default") WHERE "birrjs_plan"."is_default" = true;--> statement-breakpoint
ALTER TABLE "birrjs_subscription" DROP COLUMN "failed_at";--> statement-breakpoint
ALTER TABLE "birrjs_subscription" DROP COLUMN "expired_at";
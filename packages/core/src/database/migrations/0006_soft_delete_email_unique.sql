DROP INDEX IF EXISTS "birrjs_customer_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_customer_email_unique" ON "birrjs_customer" USING btree ("email") WHERE "birrjs_customer"."deleted_at" IS NULL;

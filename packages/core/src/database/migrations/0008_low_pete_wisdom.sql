CREATE TABLE "birrjs_reminder_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"reminder_day" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birrjs_reminder_sent" ADD CONSTRAINT "birrjs_reminder_sent_subscription_id_birrjs_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."birrjs_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "birrjs_reminder_sent_uniq" ON "birrjs_reminder_sent" USING btree ("subscription_id","reminder_day");
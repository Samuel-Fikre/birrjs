import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTableCreator,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ProrationLine } from "../proration/proration.types";
import type { ProviderProductMap } from "../provider";

const pgTable = pgTableCreator((name) => `birrjs_${name}`);

const createTimestampColumns = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

export const customer = pgTable(
  "customer",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    name: text("name"),
    phone: text("phone"),
    metadata: jsonb("metadata").$type<Record<string, string> | null>(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...createTimestampColumns(),
  },
  (table) => [
    index("birrjs_customer_deleted_at_idx").on(table.deletedAt),
    uniqueIndex("birrjs_customer_email_unique")
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const plan = pgTable(
  "plan",
  {
    id: text("id").notNull(),
    internalId: text("internal_id").primaryKey(),
    name: text("name").notNull(),
    group: text("group").notNull().default(""),
    priceAmount: integer("price_amount"),
    priceInterval: text("price_interval"),
    currency: text("currency").default("ETB"),
    trialDays: integer("trial_days"),
    resetOnTrialConversion: boolean("reset_on_trial_conversion").notNull().default(false),
    features: jsonb("features").$type<Record<string, unknown> | null>(),
    provider: jsonb("provider").$type<ProviderProductMap>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    hash: text("hash"),
    version: integer("version").notNull().default(1),
    ...createTimestampColumns(),
  },
  (table) => [
    uniqueIndex("birrjs_plan_single_default")
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
    uniqueIndex("birrjs_plan_id_version_unique").on(table.id, table.version),
    check("birrjs_plan_price_amount_non_negative", sql`price_amount IS NULL OR price_amount >= 0`),
  ],
);

export const feature = pgTable("feature", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  ...createTimestampColumns(),
});

export const planFeature = pgTable(
  "plan_feature",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plan.internalId, { onDelete: "cascade" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => feature.id, { onDelete: "cascade" }),
    limit: integer("limit"),
    resetInterval: text("reset_interval"),
    config: jsonb("config").$type<Record<string, unknown> | null>(),
    ...createTimestampColumns(),
  },
  (table) => [
    index("birrjs_plan_feature_plan_idx").on(table.planId),
    primaryKey({ columns: [table.planId, table.featureId] }),
  ],
);

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.internalId, { onDelete: "restrict" }),
    status: text("status").notNull(),
    interval: text("interval"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    periodStartAt: timestamp("period_start_at", { withTimezone: true }),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    // Plain text, not an FK: subscription_plan_change already points back here,
    // and a circular reference would make the migration order unsatisfiable.
    pendingChangeId: text("pending_change_id"),
    providerTxRef: text("provider_tx_ref"),
    ...createTimestampColumns(),
  },
  (table) => [
    index("birrjs_subscription_customer_status_idx").on(
      table.customerId,
      table.status,
      table.endedAt,
    ),
    index("birrjs_subscription_plan_idx").on(table.planId),
  ],
);

/**
 * One in-flight or settled plan change. Amounts are in minor units, matching
 * `plan.priceAmount` and `invoice.amount`.
 */
export const subscriptionPlanChange = pgTable(
  "subscription_plan_change",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    fromPlanInternalId: text("from_plan_internal_id")
      .notNull()
      .references(() => plan.internalId, { onDelete: "restrict" }),
    toPlanInternalId: text("to_plan_internal_id")
      .notNull()
      .references(() => plan.internalId, { onDelete: "restrict" }),
    direction: text("direction").notNull(),
    strategy: text("strategy").notNull(),
    debitAmount: integer("debit_amount").notNull().default(0),
    creditAmount: integer("credit_amount").notNull().default(0),
    dueNowAmount: integer("due_now_amount").notNull().default(0),
    bankedCreditAmount: integer("banked_credit_amount").notNull().default(0),
    deferredAmount: integer("deferred_amount").notNull().default(0),
    currency: text("currency").notNull().default("ETB"),
    cycleStartAt: timestamp("cycle_start_at", { withTimezone: true }).notNull(),
    cycleEndAt: timestamp("cycle_end_at", { withTimezone: true }),
    status: text("status").notNull(),
    providerTxRef: text("provider_tx_ref"),
    quoteHash: text("quote_hash"),
    carryOverUsage: boolean("carry_over_usage").notNull().default(true),
    reason: text("reason"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    ...createTimestampColumns(),
  },
  (table) => [
    // Two concurrent upgrades would double-charge; the database, not the code,
    // enforces that only one is open at a time.
    uniqueIndex("birrjs_plan_change_pending_unique")
      .on(table.subscriptionId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("birrjs_plan_change_tx_ref_unique")
      .on(table.providerTxRef)
      .where(sql`${table.providerTxRef} IS NOT NULL`),
    index("birrjs_plan_change_subscription_idx").on(table.subscriptionId, table.status),
    check(
      "birrjs_plan_change_direction_valid",
      sql`${table.direction} IN ('upgrade', 'downgrade', 'switch')`,
    ),
    check(
      "birrjs_plan_change_status_valid",
      sql`${table.status} IN ('pending', 'applied', 'voided', 'failed')`,
    ),
    check("birrjs_plan_change_strategy_valid", sql`${table.strategy} IN ('keep_anchor', 'rebase')`),
    check("birrjs_plan_change_amounts_non_negative", sql`debit_amount >= 0 AND credit_amount >= 0`),
  ],
);

export const invoice = pgTable(
  "invoice",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => subscription.id, {
      onDelete: "set null",
    }),
    planChangeId: text("plan_change_id").references(() => subscriptionPlanChange.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull().default("recurring"),
    amount: integer("amount").notNull(),
    refundedAmount: integer("refunded_amount").notNull().default(0),
    lines: jsonb("lines").$type<ProrationLine[] | null>(),
    currency: text("currency").default("ETB"),
    status: text("status").notNull(),
    providerTxRef: text("provider_tx_ref"),
    description: text("description"),
    periodStartAt: timestamp("period_start_at", { withTimezone: true }),
    periodEndAt: timestamp("period_end_at", { withTimezone: true }),
    ...createTimestampColumns(),
  },
  (table) => [
    index("birrjs_invoice_customer_idx").on(table.customerId, table.createdAt),
    index("birrjs_invoice_subscription_idx").on(table.subscriptionId),
    index("birrjs_invoice_plan_change_idx").on(table.planChangeId),
    check("birrjs_invoice_amount_non_negative", sql`amount >= 0`),
    check("birrjs_invoice_kind_valid", sql`${table.kind} IN ('recurring', 'proration')`),
    check(
      "birrjs_invoice_refunded_within_amount",
      sql`${table.refundedAmount} >= 0 AND ${table.refundedAmount} <= ${table.amount}`,
    ),
  ],
);

export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    providerReferenceId: text("provider_reference_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    error: text("error"),
    traceId: text("trace_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("birrjs_webhook_event_provider_unique").on(
      table.providerId,
      table.providerReferenceId,
    ),
    index("birrjs_webhook_event_status_idx").on(table.providerId, table.status),
  ],
);

export const reminderSent = pgTable(
  "reminder_sent",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" }),
    reminderDay: integer("reminder_day").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("birrjs_reminder_sent_uniq").on(table.subscriptionId, table.reminderDay)],
);

export const usedReceipt = pgTable(
  "used_receipt",
  {
    id: text("id").primaryKey(),
    receiptUrl: text("receipt_url").notNull(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" }),
    usedAt: timestamp("used_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("birrjs_used_receipt_url_unique").on(table.receiptUrl)],
);

export const trialRedemption = pgTable(
  "trial_redemption",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    customerEmail: text("customer_email"),
    phoneHash: text("phone_hash"),
    fingerprint: text("fingerprint"),
    planId: text("plan_id").notNull(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("birrjs_trial_redemption_customer_plan_unique").on(table.customerId, table.planId),
    index("birrjs_trial_redemption_customer_idx").on(table.customerId),
    index("birrjs_trial_redemption_email_idx").on(table.customerEmail),
    index("birrjs_trial_redemption_phone_hash_idx").on(table.phoneHash),
    index("birrjs_trial_redemption_fingerprint_idx").on(table.fingerprint),
  ],
);

export const entitlement = pgTable(
  "entitlement",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").references(() => subscription.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    featureId: text("feature_id")
      .notNull()
      .references(() => feature.id),
    limit: integer("limit"),
    balance: integer("balance"),
    nextResetAt: timestamp("next_reset_at", { withTimezone: true }),
    ...createTimestampColumns(),
  },
  (table) => [
    index("birrjs_entitlement_subscription_idx").on(table.subscriptionId),
    index("birrjs_entitlement_customer_feature_idx").on(table.customerId, table.featureId),
    index("birrjs_entitlement_next_reset_idx").on(table.nextResetAt),
  ],
);

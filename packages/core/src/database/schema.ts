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
    metadata: jsonb("metadata").$type<Record<string, string> | null>(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...createTimestampColumns(),
  },
  (table) => [index("birrjs_customer_deleted_at_idx").on(table.deletedAt)],
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
    features: jsonb("features").$type<Record<string, unknown> | null>(),
    provider: jsonb("provider").$type<ProviderProductMap>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
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
    startedAt: timestamp("started_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
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
    amount: integer("amount").notNull(),
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
    check("birrjs_invoice_amount_non_negative", sql`amount >= 0`),
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

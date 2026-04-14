import {
  boolean,
  index,
  integer,
  jsonb,
  pgTableCreator,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const pgTable = pgTableCreator((name) => `birrjs_${name}`);

const createdAt = timestamp("created_at")
  .notNull()
  .$defaultFn(() => new Date());
const updatedAt = timestamp("updated_at")
  .notNull()
  .$defaultFn(() => new Date())
  .$onUpdateFn(() => new Date());

export const customer = pgTable(
  "customer",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    name: text("name"),
    metadata: jsonb("metadata").$type<Record<string, string> | null>(),
    deletedAt: timestamp("deleted_at"),
    createdAt,
    updatedAt,
  },
  (table) => [index("birrjs_customer_deleted_at_idx").on(table.deletedAt)],
);

export const plan = pgTable(
  "plan",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    priceAmount: integer("price_amount"),
    priceInterval: text("price_interval"),
    currency: text("currency").default("ETB"),
    features: jsonb("features").$type<Record<string, unknown> | null>(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [index("birrjs_plan_default_idx").on(table.isDefault)],
);

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id),
    status: text("status").notNull(),
    startedAt: timestamp("started_at"),
    expiresAt: timestamp("expires_at"),
    canceledAt: timestamp("canceled_at"),
    endedAt: timestamp("ended_at"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    providerTxRef: text("provider_tx_ref"),
    createdAt,
    updatedAt,
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
      .references(() => customer.id),
    subscriptionId: text("subscription_id").references(() => subscription.id),
    amount: integer("amount").notNull(),
    currency: text("currency").default("ETB"),
    status: text("status").notNull(),
    providerTxRef: text("provider_tx_ref"),
    description: text("description"),
    periodStartAt: timestamp("period_start_at"),
    periodEndAt: timestamp("period_end_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("birrjs_invoice_customer_idx").on(table.customerId, table.createdAt),
    index("birrjs_invoice_subscription_idx").on(table.subscriptionId),
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
    receivedAt: timestamp("received_at").notNull(),
    processedAt: timestamp("processed_at"),
  },
  (table) => [
    uniqueIndex("birrjs_webhook_event_provider_unique").on(
      table.providerId,
      table.providerReferenceId,
    ),
    index("birrjs_webhook_event_status_idx").on(table.providerId, table.status),
  ],
);

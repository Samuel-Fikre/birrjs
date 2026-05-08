import type {
  customer,
  invoice,
  plan,
  planFeature,
  subscription,
  webhookEvent,
} from "../database/schema";

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;

export type StoredPlan = typeof plan.$inferSelect;
export type NewPlan = typeof plan.$inferInsert;

export type PlanFeature = typeof planFeature.$inferSelect;
export type NewPlanFeature = typeof planFeature.$inferInsert;

export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;

export type Invoice = typeof invoice.$inferSelect;
export type NewInvoice = typeof invoice.$inferInsert;

export type WebhookEvent = typeof webhookEvent.$inferSelect;
export type NewWebhookEvent = typeof webhookEvent.$inferInsert;

export interface StoredPlanSnapshot {
  features: readonly PlanFeature[];
  plan: StoredPlan;
}

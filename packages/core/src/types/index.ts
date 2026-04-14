export type SubscriptionStatus = "active" | "expired" | "canceled" | "pending";

export type InvoiceStatus = "draft" | "pending" | "paid" | "failed" | "void";

export type WebhookEventStatus = "received" | "processing" | "processed" | "failed";

export type PlanInterval = "monthly" | "yearly" | "weekly" | "daily";

export interface CustomerWithSubscriptions {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Record<string, string> | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subscriptions: Array<{
    id: string;
    planId: string;
    status: SubscriptionStatus;
    expiresAt: Date;
  }>;
}

export interface PlanWithFeatures {
  id: string;
  name: string;
  priceAmount: number | null;
  priceInterval: string | null;
  currency: string;
  features: Record<string, unknown> | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

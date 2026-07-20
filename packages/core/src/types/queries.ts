import type { SubscriptionStatus } from "./index";

export interface CustomerQueryResult {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
}

export interface SubscriptionQueryResult {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  interval: string | null;
  startedAt: Date | null;
  expiresAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface CountRedemptionsParams {
  customerId: string;
  customerEmail?: string;
  phoneHash?: string;
  fingerprint?: string;
}

export interface BirrJSQueries {
  getCustomer: (id: string) => Promise<CustomerQueryResult | null>;
  getSubscription: (id: string) => Promise<SubscriptionQueryResult | null>;
  countRedemptions: (params: CountRedemptionsParams) => Promise<number>;
}

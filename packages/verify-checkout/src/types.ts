import type { PaymentProvider } from "@birrjs/core";

export const VERIFY_CHECKOUT_API_VERSION = "2026-06-01";
export const DEFAULT_VERIFY_CHECKOUT_BASE_URL = "https://checkoutapi.verify.et";

export type VerifyCheckoutDepositStatus =
  | "created"
  | "assigned"
  | "awaiting_transfer"
  | "reference_submitted"
  | "verification_pending"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled"
  | "review_required";

export type VerifyCheckoutWebhookEventType =
  | "deposit.created"
  | "deposit.assigned"
  | "deposit.reference_submitted"
  | "deposit.verification_pending"
  | "deposit.succeeded"
  | "deposit.manually_succeeded"
  | "deposit.failed"
  | "deposit.manually_failed"
  | "deposit.expired"
  | "deposit.cancelled"
  | "deposit.review_required"
  | "deposit.review_resolved"
  | "webhook.test";

export type VerifyCheckoutVerification = {
  verified?: boolean;
  amount_match?: boolean;
};

export type VerifyCheckoutDeposit = {
  id: string;
  merchant_customer_id?: string;
  status: VerifyCheckoutDepositStatus;
  amount?: string;
  currency: string;
  checkout_url?: string;
  verification?: VerifyCheckoutVerification;
};

export type CreateDepositInput = {
  merchantCustomerId: string;
  amount?: string;
  currency?: string;
  paymentMethod?: string;
  returnUrl: string;
};

export type ListDepositsParams = {
  merchantOrderId?: string;
  status?: VerifyCheckoutDepositStatus;
  limit?: number;
};

export type VerifyCheckoutWebhookEvent = {
  id: string;
  type: VerifyCheckoutWebhookEventType;
  api_version: string;
  sequence?: number;
  created_at?: string;
  data?: {
    object?: VerifyCheckoutDeposit & { environment?: string };
  };
};

export interface VerifyCheckoutProviderOptions {
  apiKey: string;
  webhookSecret?: string;
  returnUrl: string;
  callbackUrl?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface VerifyCheckoutProviderConfig extends VerifyCheckoutProviderOptions {
  id: string;
  kind: string;
  secretKey: string;
  callbackUrl: string;
  runtime: PaymentProvider;
}

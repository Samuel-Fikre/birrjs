import type { NormalizedWebhookEvent } from "@birrjs/core";

/**
 * Chapa transaction status
 */
export type ChapaTransactionStatus =
  | "pending"
  | "success"
  | "failed"
  | "cancelled"
  | "reversed"
  | "refunded"
  | string;

/**
 * Chapa transaction initialization request parameters
 */
export interface ChapaTransactionRequest {
  amount: string;
  currency: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  tx_ref: string;
  callback_url: string;
  return_url: string;
  customization?: {
    title?: string;
    description?: string;
  };
  meta?: {
    hide_receipt?: string;
    invoices?: string;
  };
}

/**
 * Chapa transaction initialization response
 */

export interface ChapaTransactionResponse {
  message: string;
  status: ChapaTransactionStatus;
  data: {
    checkout_url: string;
  } | null;
}

/**
 * Chapa callback response after payment completion
 */
export interface ChapaCallbackResponse {
  trx_ref: string;
  ref_id: string;
  status: ChapaTransactionStatus;
}

/**
 * Chapa webhook event structure
 */
export interface ChapaWebhookEvent {
  event: string;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile: string;
  currency: string;
  amount: string;
  charge: string;
  status: ChapaTransactionStatus;
  mode: string;
  reference: string;
  created_at: string;
  updated_at: string;
  type: string;
  tx_ref: string;
  payment_method: string;
  customization: {
    title: string | null;
    description: string | null;
    logo: string | null;
  } | null;
  meta: unknown | null;
}

/**
 * Chapa provider configuration
 */
export interface ChapaProviderConfig {
  id: string;
  kind: "chapa";
  secretKey: string;
  webhookSecret: string;
  currency?: string;
  /**
   * Internal test hook so repo tests can stub the Chapa runtime without a network client.
   */
  runtime?: ChapaRuntime;
}

/**
 * Chapa runtime interface
 * Gateway-only implementation - Chapa handles one-time transactions, PayKit handles subscription logic
 */
export interface ChapaRuntime {
  upsertCustomer(data: {
    createTestClock?: boolean;
    id: string;
    email?: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<{ providerCustomer: { id: string; frozenTime?: string; testClockId?: string } }>;

  deleteCustomer(data: { providerCustomerId: string }): Promise<void>;

  getTestClock(data: {
    testClockId: string;
  }): Promise<{ frozenTime: Date; id: string; name?: string | null; status: string }>;

  advanceTestClock(data: {
    testClockId: string;
    frozenTime: Date;
  }): Promise<{ frozenTime: Date; id: string; name?: string | null; status: string }>;

  attachPaymentMethod(data: {
    providerCustomerId: string;
    returnURL: string;
  }): Promise<{ url: string }>;

  createSubscriptionCheckout(data: {
    providerCustomerId: string;
    providerPriceId: string;
    successUrl: string;
    cancelUrl?: string;
    metadata?: Record<string, string>;
  }): Promise<{ paymentUrl: string; providerCheckoutSessionId: string }>;

  createSubscription(data: { providerCustomerId: string; providerPriceId: string }): Promise<{
    invoice?: {
      currency: string;
      hostedUrl?: string | null;
      periodEndAt?: Date | null;
      periodStartAt?: Date | null;
      providerInvoiceId: string;
      status: string | null;
      totalAmount: number;
    } | null;
    paymentUrl: string | null;
    requiredAction?: { clientSecret?: string; paymentIntentId?: string; type: string } | null;
    subscription?: {
      cancelAtPeriodEnd: boolean;
      canceledAt?: Date | null;
      currentPeriodEndAt?: Date | null;
      currentPeriodStartAt?: Date | null;
      endedAt?: Date | null;
      providerPriceId?: string | null;
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
      status: string;
    } | null;
  }>;

  updateSubscription(data: { providerPriceId: string; providerSubscriptionId: string }): Promise<{
    invoice?: {
      currency: string;
      hostedUrl?: string | null;
      periodEndAt?: Date | null;
      periodStartAt?: Date | null;
      providerInvoiceId: string;
      status: string | null;
      totalAmount: number;
    } | null;
    paymentUrl: string | null;
    requiredAction?: { clientSecret?: string; paymentIntentId?: string; type: string } | null;
    subscription?: {
      cancelAtPeriodEnd: boolean;
      canceledAt?: Date | null;
      currentPeriodEndAt?: Date | null;
      currentPeriodStartAt?: Date | null;
      endedAt?: Date | null;
      providerPriceId?: string | null;
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
      status: string;
    } | null;
  }>;

  createInvoice(data: {
    providerCustomerId: string;
    lines: Array<{ amount: number; description: string }>;
    autoAdvance?: boolean;
  }): Promise<{
    currency: string;
    hostedUrl?: string | null;
    periodEndAt?: Date | null;
    periodStartAt?: Date | null;
    providerInvoiceId: string;
    status: string | null;
    totalAmount: number;
  }>;

  scheduleSubscriptionChange(data: {
    providerPriceId?: string | null;
    providerSubscriptionScheduleId?: string | null;
    providerSubscriptionId: string;
  }): Promise<{
    invoice?: {
      currency: string;
      hostedUrl?: string | null;
      periodEndAt?: Date | null;
      periodStartAt?: Date | null;
      providerInvoiceId: string;
      status: string | null;
      totalAmount: number;
    } | null;
    paymentUrl: string | null;
    requiredAction?: { clientSecret?: string; paymentIntentId?: string; type: string } | null;
    subscription?: {
      cancelAtPeriodEnd: boolean;
      canceledAt?: Date | null;
      currentPeriodEndAt?: Date | null;
      currentPeriodStartAt?: Date | null;
      endedAt?: Date | null;
      providerPriceId?: string | null;
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
      status: string;
    } | null;
  }>;

  cancelSubscription(data: {
    currentPeriodEndAt?: Date | null;
    providerSubscriptionId: string;
    providerSubscriptionScheduleId?: string | null;
  }): Promise<{
    invoice?: {
      currency: string;
      hostedUrl?: string | null;
      periodEndAt?: Date | null;
      periodStartAt?: Date | null;
      providerInvoiceId: string;
      status: string | null;
      totalAmount: number;
    } | null;
    paymentUrl: string | null;
    requiredAction?: { clientSecret?: string; paymentIntentId?: string; type: string } | null;
    subscription?: {
      cancelAtPeriodEnd: boolean;
      canceledAt?: Date | null;
      currentPeriodEndAt?: Date | null;
      currentPeriodStartAt?: Date | null;
      endedAt?: Date | null;
      providerPriceId?: string | null;
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
      status: string;
    } | null;
  }>;

  listActiveSubscriptions(data: {
    providerCustomerId: string;
  }): Promise<Array<{ providerSubscriptionId: string }>>;

  resumeSubscription(data: {
    providerSubscriptionId: string;
    providerSubscriptionScheduleId?: string | null;
  }): Promise<{
    invoice?: {
      currency: string;
      hostedUrl?: string | null;
      periodEndAt?: Date | null;
      periodStartAt?: Date | null;
      providerInvoiceId: string;
      status: string | null;
      totalAmount: number;
    } | null;
    paymentUrl: string | null;
    requiredAction?: { clientSecret?: string; paymentIntentId?: string; type: string } | null;
    subscription?: {
      cancelAtPeriodEnd: boolean;
      canceledAt?: Date | null;
      currentPeriodEndAt?: Date | null;
      currentPeriodStartAt?: Date | null;
      endedAt?: Date | null;
      providerPriceId?: string | null;
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
      status: string;
    } | null;
  }>;

  detachPaymentMethod(data: { providerMethodId: string }): Promise<void>;

  syncProduct(data: {
    id: string;
    name: string;
    priceAmount: number;
    priceInterval?: string | null;
    existingProviderProductId?: string | null;
    existingProviderPriceId?: string | null;
  }): Promise<{ providerProductId: string; providerPriceId: string }>;

  handleWebhook(data: {
    body: string;
    headers: Record<string, string>;
  }): Promise<NormalizedWebhookEvent[]>;

  createPortalSession(data: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}

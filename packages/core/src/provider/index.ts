/**
 * Convert minor units to decimal string format for provider APIs
 */
export function toDecimalAmount(amount: number): string {
  return (amount / 100).toFixed(2);
}

/**
 * Convert decimal string from provider to minor units
 */
export function fromDecimalAmount(amount: string): number {
  const parsed = parseFloat(amount);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid decimal amount: ${amount}`);
  }
  return Math.round(parsed * 100);
}

export interface ProviderMetadata {
  // subAccountId?: string;
  // splitCode?: string;
  [key: string]: unknown;
}

export type ProviderProductMap = Record<string, ProviderMetadata>;

/**
 * Payment provider configuration
 */
export interface PaymentProviderConfig {
  id: string;
  kind: string;
  secretKey: string;
  webhookSecret?: string;
  callbackUrl: string;
  returnUrl?: string;
  currency?: string;
  testMode?: boolean;
  runtime?: PaymentProvider;
}

/**
 * Transaction initialization request
 */
export interface TransactionRequest {
  amount: number;
  currency: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  txRef: string;
  callbackUrl: string;
  returnUrl?: string;
  metadata?: Record<string, string>;
  customization?: {
    title?: string;
    description?: string;
    logo?: string;
  };
  meta?: {
    hide_receipt?: string;
    invoices?: string;
  };
}

export type PaymentChannelType = "telebirr" | "cbe" | "awash";

export interface PaymentChannel {
  type: PaymentChannelType;
  label: string;
  value: string;
  accountHolder?: string;
}

export interface PaymentInstructions {
  amount: number;
  channels: PaymentChannel[];
}

/**
 * Transaction initialization response
 */
export interface TransactionResponse {
  success: boolean;
  checkoutUrl?: string;
  paymentInstructions?: PaymentInstructions;
  txRef?: string;
  error?: string;
}

/**
 * Transaction verification response
 */
export interface VerificationResponse {
  success: boolean;
  status: string;
  amount?: number;
  currency?: string;
  email?: string;
  txRef?: string;
  providerTxRef?: string;
  mode?: string;
  error?: string;
}

/**
 * Webhook event
 */
export interface WebhookEvent {
  providerReferenceId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Payment provider interface
 * All payment providers (Chapa, Santim Pay, etc.) must implement this
 */
export interface PaymentProvider {
  initializeTransaction(request: TransactionRequest): Promise<TransactionResponse>;
  verifyTransaction(txRef: string): Promise<VerificationResponse>;
  handleWebhook(
    payload: unknown,
    rawBody: string | Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookEvent>;
}

/**
 * Provider error base class
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

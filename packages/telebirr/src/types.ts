export type Scalar = string | number | boolean;

export interface TelebirrConfig {
  gatewayUrl: string;
  checkoutUrl: string;
  fabricAppId: string;
  appSecret: string;
  merchantAppId: string;
  merchantCode: string;
  privateKeyPem: string;
  notifyUrl: string;
  redirectUrl: string;
  timeoutMs?: number;
}

export interface CreatePaymentInput {
  amount: string;
  title: string;
  merchantOrderId?: string;
}

export interface CreatedPayment {
  merchantOrderId: string;
  prepayId: string;
  checkoutUrl: string;
}

export interface TelebirrResponse {
  result?: string;
  code?: string;
  msg?: string;
  message?: string;
  token?: string;
  effectiveDate?: string;
  expirationDate?: string;
  biz_content?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelebirrTokenResponse {
  token: string;
  effectiveDate: string;
  expirationDate: string;
}

export interface SignedRequest {
  nonce_str: string;
  method: string;
  timestamp: string;
  version: "1.0";
  biz_content: Record<string, Scalar>;
  sign_type: "SHA256WithRSA";
  sign?: string;
}

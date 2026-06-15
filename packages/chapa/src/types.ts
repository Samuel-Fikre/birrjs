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
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  tx_ref: string;
  callback_url: string;
  return_url?: string;
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
 * Chapa transaction verification response
 */
export interface ChapaVerifyResponse {
  message: string;
  status: ChapaTransactionStatus;
  data: {
    first_name: string;
    last_name: string;
    email: string;
    currency: string;
    amount: number;
    charge: number;
    mode: string;
    method: string;
    type: string;
    status: ChapaTransactionStatus;
    reference: string;
    tx_ref: string;
    customization: {
      title: string | null;
      description: string | null;
      logo: string | null;
    } | null;
    meta: unknown | null;
    created_at: string;
    updated_at: string;
  } | null;
}

import { ProviderError } from "@birrjs/core";

export const VERIFY_CHECKOUT_ERROR_CODES = {
  INITIALIZATION_FAILED: "VERIFY_CHECKOUT_INITIALIZATION_FAILED",
  INVALID_CONFIG: "VERIFY_CHECKOUT_INVALID_CONFIG",
  VERIFICATION_FAILED: "VERIFY_CHECKOUT_VERIFICATION_FAILED",
  INVALID_WEBHOOK: "VERIFY_CHECKOUT_INVALID_WEBHOOK",
  NETWORK_ERROR: "VERIFY_CHECKOUT_NETWORK_ERROR",
  TIMEOUT_ERROR: "VERIFY_CHECKOUT_TIMEOUT_ERROR",
  SERVER_ERROR: "VERIFY_CHECKOUT_SERVER_ERROR",
  CLIENT_ERROR: "VERIFY_CHECKOUT_CLIENT_ERROR",
  MALFORMED_RESPONSE: "VERIFY_CHECKOUT_MALFORMED_RESPONSE",
  UNAUTHORIZED: "VERIFY_CHECKOUT_UNAUTHORIZED",
  FORBIDDEN: "VERIFY_CHECKOUT_FORBIDDEN",
  INSUFFICIENT_CREDITS: "VERIFY_CHECKOUT_INSUFFICIENT_CREDITS",
  RATE_LIMITED: "VERIFY_CHECKOUT_RATE_LIMITED",
  IDEMPOTENCY_CONFLICT: "VERIFY_CHECKOUT_IDEMPOTENCY_CONFLICT",
  VALIDATION_FAILED: "VERIFY_CHECKOUT_VALIDATION_FAILED",
} as const;

export type VerifyCheckoutErrorCode =
  (typeof VERIFY_CHECKOUT_ERROR_CODES)[keyof typeof VERIFY_CHECKOUT_ERROR_CODES];

export class VerifyCheckoutApiError extends Error {
  readonly statusCode: number;
  readonly errorCode?: string;
  readonly requestId?: string;
  readonly retryable?: boolean;
  readonly body?: unknown;

  constructor(
    message: string,
    statusCode: number,
    options: {
      errorCode?: string;
      requestId?: string;
      retryable?: boolean;
      body?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "VerifyCheckoutApiError";
    this.statusCode = statusCode;
    this.errorCode = options.errorCode;
    this.requestId = options.requestId;
    this.retryable = options.retryable;
    this.body = options.body;
    Object.setPrototypeOf(this, VerifyCheckoutApiError.prototype);
  }
}

export class VerifyCheckoutError extends ProviderError {
  constructor(
    message: string,
    code: VerifyCheckoutErrorCode = VERIFY_CHECKOUT_ERROR_CODES.INITIALIZATION_FAILED,
    statusCode?: number,
  ) {
    super(message, code, statusCode);
    this.name = "VerifyCheckoutError";
  }

  static isRetryable(error: VerifyCheckoutError): boolean {
    return (
      error.code === VERIFY_CHECKOUT_ERROR_CODES.NETWORK_ERROR ||
      error.code === VERIFY_CHECKOUT_ERROR_CODES.TIMEOUT_ERROR ||
      error.code === VERIFY_CHECKOUT_ERROR_CODES.SERVER_ERROR ||
      error.code === VERIFY_CHECKOUT_ERROR_CODES.RATE_LIMITED ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    );
  }
}

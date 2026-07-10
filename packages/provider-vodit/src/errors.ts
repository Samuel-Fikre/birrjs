import { ProviderError } from "@birrjs/core";

export const VODIT_ERROR_CODES = {
  VERIFICATION_FAILED: "VODIT_VERIFICATION_FAILED",
  NETWORK_ERROR: "VODIT_NETWORK_ERROR",
  TIMEOUT_ERROR: "VODIT_TIMEOUT_ERROR",
  SERVER_ERROR: "VODIT_SERVER_ERROR",
  UNAUTHORIZED: "VODIT_UNAUTHORIZED",
  RATE_LIMITED: "VODIT_RATE_LIMITED",
  RECIPIENT_MISMATCH: "VODIT_RECIPIENT_MISMATCH",
  AMOUNT_PARSE_FAILED: "VODIT_AMOUNT_PARSE_FAILED",
  RECEIPT_INVALID: "VODIT_RECEIPT_INVALID",
  UNSUPPORTED_WEBHOOK: "VODIT_UNSUPPORTED_WEBHOOK",
} as const;

export class VoditApiError extends Error {
  readonly statusCode: number;
  readonly retryAfter?: number;

  constructor(
    message: string,
    statusCode: number,
    public code: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "VoditApiError";
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, VoditApiError.prototype);
  }
}

export class VoditError extends ProviderError {
  constructor(
    message: string,
    code: string = VODIT_ERROR_CODES.VERIFICATION_FAILED,
    statusCode?: number,
  ) {
    super(message, code, statusCode);
    this.name = "VoditError";
  }

  static isRetryable(error: VoditError): boolean {
    return (
      error.code === VODIT_ERROR_CODES.NETWORK_ERROR ||
      error.code === VODIT_ERROR_CODES.TIMEOUT_ERROR ||
      error.code === VODIT_ERROR_CODES.SERVER_ERROR ||
      error.code === VODIT_ERROR_CODES.RATE_LIMITED ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    );
  }
}

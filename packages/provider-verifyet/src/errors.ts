import { ProviderError } from "@birrjs/core";

export const VERIFYET_ERROR_CODES = {
  VERIFICATION_FAILED: "VERIFYET_VERIFICATION_FAILED",
  NETWORK_ERROR: "VERIFYET_NETWORK_ERROR",
  TIMEOUT_ERROR: "VERIFYET_TIMEOUT_ERROR",
  SERVER_ERROR: "VERIFYET_SERVER_ERROR",
  UNAUTHORIZED: "VERIFYET_UNAUTHORIZED",
  RATE_LIMITED: "VERIFYET_RATE_LIMITED",
  INSUFFICIENT_CREDITS: "VERIFYET_INSUFFICIENT_CREDITS",
  VERIFICATION_PENDING: "VERIFYET_VERIFICATION_PENDING",
  SETTLEMENT_MISMATCH: "VERIFYET_SETTLEMENT_MISMATCH",
  UNSUPPORTED_WEBHOOK: "VERIFYET_UNSUPPORTED_WEBHOOK",
} as const;

export class VerifyEtApiError extends Error {
  readonly statusCode: number;
  readonly retryAfter?: number;

  constructor(
    message: string,
    statusCode: number,
    public code: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "VerifyEtApiError";
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, VerifyEtApiError.prototype);
  }
}

export class VerifyEtError extends ProviderError {
  constructor(
    message: string,
    code: string = VERIFYET_ERROR_CODES.VERIFICATION_FAILED,
    statusCode?: number,
  ) {
    super(message, code, statusCode);
    this.name = "VerifyEtError";
  }

  static isRetryable(error: VerifyEtError): boolean {
    return (
      error.code === VERIFYET_ERROR_CODES.NETWORK_ERROR ||
      error.code === VERIFYET_ERROR_CODES.TIMEOUT_ERROR ||
      error.code === VERIFYET_ERROR_CODES.SERVER_ERROR ||
      error.code === VERIFYET_ERROR_CODES.RATE_LIMITED ||
      error.code === VERIFYET_ERROR_CODES.VERIFICATION_PENDING ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    );
  }
}

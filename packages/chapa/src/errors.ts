import { ProviderError } from "@birrjs/core";

export const CHAPA_ERROR_CODES = {
  INITIALIZATION_FAILED: "CHAPA_INITIALIZATION_FAILED",
  VERIFICATION_FAILED: "CHAPA_VERIFICATION_FAILED",
  INVALID_WEBHOOK: "CHAPA_INVALID_WEBHOOK",
  NETWORK_ERROR: "CHAPA_NETWORK_ERROR",
  TIMEOUT_ERROR: "CHAPA_TIMEOUT_ERROR",
  SERVER_ERROR: "CHAPA_SERVER_ERROR",
  CLIENT_ERROR: "CHAPA_CLIENT_ERROR",
  MALFORMED_RESPONSE: "CHAPA_MALFORMED_RESPONSE",
  UNAUTHORIZED: "CHAPA_UNAUTHORIZED",
  NOT_FOUND: "CHAPA_NOT_FOUND",
  RATE_LIMITED: "CHAPA_RATE_LIMITED",
} as const;

export class ChapaApiError extends Error {
  readonly statusCode: number;
  readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = "ChapaApiError";
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, ChapaApiError.prototype);
  }
}

export class ChapaError extends ProviderError {
  constructor(
    message: string,
    code: string = CHAPA_ERROR_CODES.INITIALIZATION_FAILED,
    statusCode?: number,
  ) {
    super(message, code, statusCode);
  }

  static isRetryable(error: ChapaError): boolean {
    return (
      error.code === CHAPA_ERROR_CODES.NETWORK_ERROR ||
      error.code === CHAPA_ERROR_CODES.TIMEOUT_ERROR ||
      error.code === CHAPA_ERROR_CODES.SERVER_ERROR ||
      error.code === CHAPA_ERROR_CODES.RATE_LIMITED ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    );
  }
}

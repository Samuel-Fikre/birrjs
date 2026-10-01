import { ProviderError } from "@birrjs/core";

export const TELEBIRR_ERROR_CODES = {
  INITIALIZATION_FAILED: "TELEBIRR_INITIALIZATION_FAILED",
  INVALID_PRIVATE_KEY: "TELEBIRR_INVALID_PRIVATE_KEY",
  VERIFICATION_FAILED: "TELEBIRR_VERIFICATION_FAILED",
  INVALID_WEBHOOK: "TELEBIRR_INVALID_WEBHOOK",
  NETWORK_ERROR: "TELEBIRR_NETWORK_ERROR",
  TIMEOUT_ERROR: "TELEBIRR_TIMEOUT_ERROR",
  SERVER_ERROR: "TELEBIRR_SERVER_ERROR",
  CLIENT_ERROR: "TELEBIRR_CLIENT_ERROR",
  MALFORMED_RESPONSE: "TELEBIRR_MALFORMED_RESPONSE",
  UNAUTHORIZED: "TELEBIRR_UNAUTHORIZED",
  SIGNING_FAILED: "TELEBIRR_SIGNING_FAILED",
} as const;

export class TelebirrApiError extends Error {
  readonly statusCode: number;
  readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = "TelebirrApiError";
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, TelebirrApiError.prototype);
  }
}

export class TelebirrError extends ProviderError {
  constructor(
    message: string,
    code: string = TELEBIRR_ERROR_CODES.INITIALIZATION_FAILED,
    statusCode?: number,
  ) {
    super(message, code, statusCode);
  }

  static isRetryable(error: TelebirrError): boolean {
    return (
      error.code === TELEBIRR_ERROR_CODES.NETWORK_ERROR ||
      error.code === TELEBIRR_ERROR_CODES.TIMEOUT_ERROR ||
      error.code === TELEBIRR_ERROR_CODES.SERVER_ERROR ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    );
  }
}

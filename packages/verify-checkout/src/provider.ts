import type {
  PaymentProvider,
  TransactionRequest,
  TransactionResponse,
  VerificationResponse,
  WebhookEvent,
} from "@birrjs/core";
import { fromDecimalAmount, toDecimalAmount } from "@birrjs/core";

import type { VerifyCheckoutClient } from "./client";
import { VerifyCheckoutApiError, VerifyCheckoutError, VERIFY_CHECKOUT_ERROR_CODES } from "./errors";
import type { VerifyCheckoutErrorCode } from "./errors";
import { verifyWebhookSignature } from "./signing";
import type { VerifyCheckoutDeposit, VerifyCheckoutDepositStatus } from "./types";

export interface VerifyCheckoutRuntimeOptions {
  returnUrl: string;
  webhookSecret?: string;
}

const DEPOSIT_CACHE_MAX_ENTRIES = 500;

const TERMINAL_FAILED_STATUSES: VerifyCheckoutDepositStatus[] = ["failed", "expired", "cancelled"];

function toProviderError(error: unknown, fallback: VerifyCheckoutErrorCode): VerifyCheckoutError {
  if (error instanceof VerifyCheckoutError) return error;

  if (error instanceof VerifyCheckoutApiError) {
    const { statusCode } = error;
    if (statusCode === 401) {
      return new VerifyCheckoutError(
        "Authentication failed: invalid or revoked API key",
        VERIFY_CHECKOUT_ERROR_CODES.UNAUTHORIZED,
        statusCode,
      );
    }
    if (statusCode === 403) {
      return new VerifyCheckoutError(
        "API key lacks the required scope",
        VERIFY_CHECKOUT_ERROR_CODES.FORBIDDEN,
        statusCode,
      );
    }
    if (statusCode === 402) {
      return new VerifyCheckoutError(
        "Insufficient verification credits",
        VERIFY_CHECKOUT_ERROR_CODES.INSUFFICIENT_CREDITS,
        statusCode,
      );
    }
    if (statusCode === 409) {
      return new VerifyCheckoutError(
        error.message,
        VERIFY_CHECKOUT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        statusCode,
      );
    }
    if (statusCode === 429) {
      return new VerifyCheckoutError(
        "Rate limit exceeded",
        VERIFY_CHECKOUT_ERROR_CODES.RATE_LIMITED,
        statusCode,
      );
    }
    if (statusCode === 400 || statusCode === 422) {
      return new VerifyCheckoutError(
        error.message,
        VERIFY_CHECKOUT_ERROR_CODES.VALIDATION_FAILED,
        statusCode,
      );
    }
    if (statusCode >= 500) {
      return new VerifyCheckoutError(
        `Verify Checkout server error: ${statusCode}`,
        VERIFY_CHECKOUT_ERROR_CODES.SERVER_ERROR,
        statusCode,
      );
    }
    return new VerifyCheckoutError(
      error.message,
      VERIFY_CHECKOUT_ERROR_CODES.CLIENT_ERROR,
      statusCode,
    );
  }

  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new VerifyCheckoutError(
      "Request timed out",
      VERIFY_CHECKOUT_ERROR_CODES.TIMEOUT_ERROR,
      504,
    );
  }

  if (error instanceof TypeError) {
    return new VerifyCheckoutError(error.message, VERIFY_CHECKOUT_ERROR_CODES.NETWORK_ERROR);
  }

  return new VerifyCheckoutError(
    error instanceof Error ? error.message : "Unknown error",
    fallback,
  );
}

function interpretDeposit(deposit: VerifyCheckoutDeposit, txRef: string): VerificationResponse {
  const verification = deposit.verification;

  if (deposit.status === "succeeded") {
    if (verification && (verification.verified === false || verification.amount_match === false)) {
      return {
        success: false,
        status: "failed",
        error: "Payment verification did not confirm the expected amount.",
        txRef,
      };
    }
    return {
      success: true,
      status: "success",
      amount: deposit.amount !== undefined ? fromDecimalAmount(deposit.amount) : undefined,
      currency: deposit.currency ?? "ETB",
      txRef,
      providerTxRef: deposit.id,
    };
  }

  if (TERMINAL_FAILED_STATUSES.includes(deposit.status)) {
    return {
      success: false,
      status: "failed",
      error:
        deposit.status === "expired"
          ? "Checkout expired before payment completed."
          : deposit.status === "cancelled"
            ? "Payment was cancelled."
            : "Payment failed verification.",
      txRef,
    };
  }

  if (deposit.status === "review_required") {
    return {
      success: false,
      status: "pending",
      error: "Payment is under review. Please try again later.",
      txRef,
    };
  }

  return {
    success: false,
    status: "pending",
    error: "Payment verification is still in progress. Please try again shortly.",
    txRef,
  };
}

export function createVerifyCheckoutProvider(
  client: VerifyCheckoutClient,
  options: VerifyCheckoutRuntimeOptions,
): PaymentProvider {
  const depositCache = new Map<string, string>();

  function rememberDeposit(txRef: string, depositId: string): void {
    if (depositCache.size >= DEPOSIT_CACHE_MAX_ENTRIES) {
      const oldest = depositCache.keys().next().value;
      if (oldest !== undefined) depositCache.delete(oldest);
    }
    depositCache.set(txRef, depositId);
  }

  async function getDepositOrUndefined(
    depositId: string,
  ): Promise<VerifyCheckoutDeposit | undefined> {
    try {
      return await client.getDeposit(depositId);
    } catch (error) {
      if (error instanceof VerifyCheckoutApiError && error.statusCode === 404) return undefined;
      throw error;
    }
  }

  async function resolveDeposit(ref: string): Promise<VerifyCheckoutDeposit | undefined> {
    if (ref.startsWith("dep_")) {
      return await getDepositOrUndefined(ref);
    }

    const cachedId = depositCache.get(ref);
    if (cachedId !== undefined) {
      const cached = await getDepositOrUndefined(cachedId);
      if (cached !== undefined) return cached;
    }

    const recent = await client.listDeposits({ limit: 100 });
    return recent.find((deposit) => deposit.merchant_customer_id === ref);
  }

  return {
    async initializeTransaction(request: TransactionRequest): Promise<TransactionResponse> {
      const returnUrl = request.returnUrl ?? options.returnUrl;
      if (!returnUrl) {
        throw new VerifyCheckoutError(
          "returnUrl is required — register its origin in the Verify Checkout dashboard",
          VERIFY_CHECKOUT_ERROR_CODES.INVALID_CONFIG,
        );
      }

      const currency = (request.currency || "ETB").toUpperCase();
      if (currency !== "ETB") {
        throw new VerifyCheckoutError(
          `Verify Checkout supports ETB only (received ${currency})`,
          VERIFY_CHECKOUT_ERROR_CODES.INVALID_CONFIG,
        );
      }

      try {
        const deposit = await client.createDeposit(
          {
            merchantCustomerId: request.txRef,
            amount: toDecimalAmount(request.amount),
            currency,
            returnUrl,
          },
          request.txRef,
        );

        if (!deposit.checkout_url) {
          throw new VerifyCheckoutError(
            "Deposit response did not include checkout_url",
            VERIFY_CHECKOUT_ERROR_CODES.MALFORMED_RESPONSE,
          );
        }

        rememberDeposit(request.txRef, deposit.id);

        return {
          success: true,
          checkoutUrl: deposit.checkout_url,
          txRef: request.txRef,
        };
      } catch (error) {
        throw toProviderError(error, VERIFY_CHECKOUT_ERROR_CODES.INITIALIZATION_FAILED);
      }
    },

    async verifyTransaction(
      txRef: string,
      _subscriptionId?: string,
      _channelType?: string,
    ): Promise<VerificationResponse> {
      try {
        const deposit = await resolveDeposit(txRef);
        if (!deposit) {
          return {
            success: false,
            status: "failed",
            error: "Transaction not found. Please check the reference and try again.",
            txRef,
          };
        }
        return interpretDeposit(deposit, txRef);
      } catch (error) {
        throw toProviderError(error, VERIFY_CHECKOUT_ERROR_CODES.VERIFICATION_FAILED);
      }
    },

    async handleWebhook(
      payload: unknown,
      rawBody: string | Buffer,
      headers: Record<string, string>,
    ): Promise<WebhookEvent> {
      try {
        if (typeof payload !== "object" || payload === null) {
          throw new VerifyCheckoutError(
            "Invalid webhook payload",
            VERIFY_CHECKOUT_ERROR_CODES.INVALID_WEBHOOK,
          );
        }
        const event = payload as Record<string, unknown>;

        // Fail closed when a signing secret is configured.
        if (options.webhookSecret) {
          const bodyText =
            typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
          if (!verifyWebhookSignature(bodyText, headers, options.webhookSecret)) {
            throw new VerifyCheckoutError(
              "Invalid webhook signature",
              VERIFY_CHECKOUT_ERROR_CODES.INVALID_WEBHOOK,
            );
          }
        }

        const eventId = typeof event.id === "string" ? event.id : undefined;
        const data = event.data as { object?: Record<string, unknown> } | undefined;
        const object = data?.object;

        const depositId =
          object && typeof object.id === "string" && object.id.length > 0 ? object.id : undefined;
        const merchantCustomerId =
          object && typeof object.merchant_customer_id === "string"
            ? object.merchant_customer_id.trim()
            : "";

        if (depositId === undefined || merchantCustomerId.length === 0) {
          return {
            providerReferenceId: eventId ?? "verify-checkout-unmatched",
            type: "charge.pending",
            payload: event,
          };
        }

        const deposit = await client.getDeposit(depositId);
        const verification = deposit.verification;

        let type: string;
        if (deposit.status === "succeeded") {
          const confirmed =
            verification === undefined ||
            (verification.verified !== false && verification.amount_match !== false);
          type = confirmed ? "charge.success" : "charge.pending";
        } else if (TERMINAL_FAILED_STATUSES.includes(deposit.status)) {
          type = "charge.failed/cancelled";
        } else {
          type = "charge.pending";
        }

        return {
          providerReferenceId: merchantCustomerId,
          type,
          payload: deposit as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof VerifyCheckoutError) throw error;
        throw toProviderError(error, VERIFY_CHECKOUT_ERROR_CODES.INVALID_WEBHOOK);
      }
    },
  };
}

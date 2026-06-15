import type {
  PaymentProvider,
  PaymentProviderConfig,
  TransactionRequest,
  TransactionResponse,
  VerificationResponse,
  WebhookEvent,
} from "@birrjs/core";
import { toDecimalAmount, fromDecimalAmount } from "@birrjs/core";

import type { ChapaClient } from "./client";
import { createChapaClient } from "./client";
import { ChapaError, CHAPA_ERROR_CODES, ChapaApiError } from "./errors";
import { ChapaWebhookEventSchema } from "./schemas";
import type {
  ChapaTransactionRequest,
  ChapaTransactionResponse,
  ChapaVerifyResponse,
} from "./types";

/**
 * Create Chapa provider
 */
export function createChapaProvider(
  client: ChapaClient,
  config: PaymentProviderConfig,
): PaymentProvider {
  const defaultCurrency = config.currency ?? "ETB";

  return {
    async initializeTransaction(request: TransactionRequest): Promise<TransactionResponse> {
      try {
        // Convert minor units to decimal for Chapa
        const chapaRequest: ChapaTransactionRequest = {
          amount: toDecimalAmount(request.amount),
          currency: request.currency ?? defaultCurrency,
          email: request.email,
          phone_number: request.phoneNumber,
          tx_ref: request.txRef,
          callback_url: request.callbackUrl,
          customization: request.customization,
          ...(request.firstName && { first_name: request.firstName }),
          ...(request.lastName && { last_name: request.lastName }),
          ...(request.returnUrl && { return_url: request.returnUrl }),
          ...(request.meta && { meta: request.meta }),
        };

        const response: ChapaTransactionResponse = await client.initializeTransaction(chapaRequest);

        // Check for provider failure response
        if (response.status === "failed" || response.status === "cancelled") {
          return {
            success: false,
            error: response.message || "Transaction failed",
          };
        }

        // Check for malformed response (missing checkout_url)
        if (!response.data?.checkout_url) {
          return {
            success: false,
            error: "Invalid response from Chapa: missing checkout URL",
          };
        }

        return {
          success: true,
          checkoutUrl: response.data.checkout_url,
          txRef: request.txRef,
        };
      } catch (error) {
        // Use structured error fields from ChapaApiError
        if (error instanceof ChapaApiError) {
          const { statusCode } = error;

          // Determine error type based on status code
          if (statusCode >= 500) {
            throw new ChapaError(
              `Chapa server error: ${statusCode}`,
              CHAPA_ERROR_CODES.SERVER_ERROR,
              statusCode,
            );
          }
          if (statusCode === 401) {
            throw new ChapaError(
              "Chapa authorization failed: invalid API key",
              CHAPA_ERROR_CODES.UNAUTHORIZED,
              statusCode,
            );
          }
          if (statusCode === 404) {
            throw new ChapaError(
              "Chapa resource not found",
              CHAPA_ERROR_CODES.NOT_FOUND,
              statusCode,
            );
          }
          if (statusCode === 429) {
            throw new ChapaError(
              "Chapa rate limit exceeded",
              CHAPA_ERROR_CODES.RATE_LIMITED,
              statusCode,
            );
          }
          if (statusCode >= 400) {
            const detail =
              error instanceof ChapaApiError && error.body
                ? ` - ${JSON.stringify(error.body)}`
                : "";
            throw new ChapaError(
              `Chapa client error: ${statusCode}${detail}`,
              CHAPA_ERROR_CODES.CLIENT_ERROR,
              statusCode,
            );
          }
          throw new ChapaError(error.message, CHAPA_ERROR_CODES.INITIALIZATION_FAILED, statusCode);
        }

        // Fallback for other error types
        if (error instanceof Error) {
          throw new ChapaError(error.message, CHAPA_ERROR_CODES.INITIALIZATION_FAILED);
        }

        throw new ChapaError(
          "Unknown error initializing transaction",
          CHAPA_ERROR_CODES.INITIALIZATION_FAILED,
        );
      }
    },

    async verifyTransaction(txRef: string): Promise<VerificationResponse> {
      try {
        const response: ChapaVerifyResponse = await client.verifyTransaction(txRef);

        if (response.status !== "success") {
          return {
            success: false,
            status: response.status,
            error: "Transaction verification failed",
          };
        }

        return {
          success: true,
          status: response.status,
          amount: response.data ? fromDecimalAmount(response.data.amount.toString()) : undefined,
          currency: response.data?.currency,
          email: response.data?.email,
          txRef: response.data?.tx_ref,
          providerTxRef: response.data?.reference,
          mode: response.data?.mode,
        };
      } catch (error) {
        if (error instanceof ChapaApiError) {
          const { statusCode } = error;

          // Determine error type based on status code
          if (statusCode >= 500) {
            throw new ChapaError(
              `Chapa server error: ${statusCode}`,
              CHAPA_ERROR_CODES.SERVER_ERROR,
              statusCode,
            );
          }
          if (statusCode === 401) {
            throw new ChapaError(
              "Chapa authorization failed: invalid API key",
              CHAPA_ERROR_CODES.UNAUTHORIZED,
              statusCode,
            );
          }
          if (statusCode === 404) {
            throw new ChapaError(
              "Chapa resource not found",
              CHAPA_ERROR_CODES.NOT_FOUND,
              statusCode,
            );
          }
          if (statusCode === 429) {
            throw new ChapaError(
              "Chapa rate limit exceeded",
              CHAPA_ERROR_CODES.RATE_LIMITED,
              statusCode,
            );
          }
          if (statusCode >= 400) {
            const detail =
              error instanceof ChapaApiError && error.body
                ? ` - ${JSON.stringify(error.body)}`
                : "";
            throw new ChapaError(
              `Chapa client error: ${statusCode}${detail}`,
              CHAPA_ERROR_CODES.CLIENT_ERROR,
              statusCode,
            );
          }
          throw new ChapaError(error.message, CHAPA_ERROR_CODES.VERIFICATION_FAILED, statusCode);
        }

        // Fallback for other error types
        if (error instanceof Error) {
          throw new ChapaError(error.message, CHAPA_ERROR_CODES.VERIFICATION_FAILED);
        }

        throw new ChapaError(
          "Unknown error verifying transaction",
          CHAPA_ERROR_CODES.VERIFICATION_FAILED,
        );
      }
    },

    async handleWebhook(
      payload: unknown,
      rawBody: string | Buffer,
      headers: Record<string, string>,
    ): Promise<WebhookEvent> {
      try {
        // Validate webhook payload structure
        const parsed = ChapaWebhookEventSchema.safeParse(payload);
        if (!parsed.success) {
          throw new ChapaError(
            "Invalid webhook payload structure",
            CHAPA_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        const event = parsed.data;

        // Verify webhook signature if webhookSecret is provided
        if (config.webhookSecret) {
          const crypto = await import("crypto");
          const chapaSignature = headers["chapa-signature"];
          const xChapaSignature = headers["x-chapa-signature"];

          if (!chapaSignature && !xChapaSignature) {
            throw new ChapaError("Missing webhook signature", CHAPA_ERROR_CODES.INVALID_WEBHOOK);
          }

          // Compute both possible signatures
          const chapaSigExpected = crypto
            .createHmac("sha256", config.webhookSecret)
            .update(config.webhookSecret)
            .digest("hex");

          const xChapaSigExpected = crypto
            .createHmac("sha256", config.webhookSecret)
            .update(rawBody)
            .digest("hex");

          // Check if either header matches (Chapa docs: if either is valid, proceed)
          let valid = false;

          if (chapaSignature) {
            const buf = Buffer.from(chapaSignature, "utf8");
            const exp = Buffer.from(chapaSigExpected, "utf8");
            if (buf.length === exp.length && crypto.timingSafeEqual(buf, exp)) {
              valid = true;
            }
          }

          if (!valid && xChapaSignature) {
            const buf = Buffer.from(xChapaSignature, "utf8");
            const exp = Buffer.from(xChapaSigExpected, "utf8");
            if (buf.length === exp.length && crypto.timingSafeEqual(buf, exp)) {
              valid = true;
            }
          }

          if (!valid) {
            throw new ChapaError("Invalid webhook signature", CHAPA_ERROR_CODES.INVALID_WEBHOOK);
          }
        }

        // Extract tx_ref from webhook
        const txRef = event.tx_ref;

        // tx_ref is required for verification
        if (!txRef) {
          throw new ChapaError(
            "Missing tx_ref in webhook payload",
            CHAPA_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        // Verify transaction with Chapa API before processing (as per Chapa docs)
        const verification = await this.verifyTransaction(txRef);
        if (!verification.success) {
          throw new ChapaError(
            "Webhook transaction verification failed",
            CHAPA_ERROR_CODES.VERIFICATION_FAILED,
          );
        }

        // Verify critical fields match webhook values
        if (verification.status !== event.status) {
          throw new ChapaError(
            "Webhook status mismatch with Chapa API",
            CHAPA_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        if (verification.amount && verification.amount !== fromDecimalAmount(event.amount)) {
          throw new ChapaError(
            "Webhook amount mismatch with Chapa API",
            CHAPA_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        if (verification.currency && verification.currency !== event.currency) {
          throw new ChapaError(
            "Webhook currency mismatch with Chapa API",
            CHAPA_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        if (verification.txRef && verification.txRef !== event.tx_ref) {
          throw new ChapaError(
            "Webhook tx_ref mismatch with Chapa API",
            CHAPA_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        if (verification.mode && verification.mode !== event.mode) {
          throw new ChapaError(
            "Webhook mode mismatch with Chapa API",
            CHAPA_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        return {
          providerReferenceId: txRef,
          type: event.event,
          payload: event as unknown as Record<string, unknown>,
        };
      } catch (error) {
        // Preserve specific error types instead of always wrapping as INVALID_WEBHOOK
        if (error instanceof ChapaError) {
          throw error;
        }
        if (error instanceof ChapaApiError) {
          throw new ChapaError(
            error.message,
            CHAPA_ERROR_CODES.VERIFICATION_FAILED,
            error.statusCode,
          );
        }
        throw new ChapaError(
          error instanceof Error ? error.message : "Invalid webhook payload",
          CHAPA_ERROR_CODES.INVALID_WEBHOOK,
        );
      }
    },
  };
}

/**
 * Chapa provider options — what you pass to `chapa()`
 */
export interface ChapaProviderOptions {
  secretKey: string;
  webhookSecret?: string;
  callbackUrl: string;
  returnUrl?: string;
  currency?: string;
  testMode?: boolean;
}

/**
 * Chapa provider configuration — what `chapa()` returns
 */
export interface ChapaProviderConfig extends ChapaProviderOptions {
  id: string;
  kind: string;
  runtime: PaymentProvider;
}

/**
 * Create Chapa provider configuration
 */
export function chapa(options: ChapaProviderOptions): ChapaProviderConfig {
  const config: PaymentProviderConfig = {
    ...options,
    id: "chapa",
    kind: "chapa",
  };
  const client = createChapaClient(config);
  const runtime = createChapaProvider(client, config);

  return {
    ...config,
    runtime,
  };
}

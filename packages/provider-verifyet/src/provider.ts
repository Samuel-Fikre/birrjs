import type {
  PaymentChannel,
  PaymentProvider,
  TransactionRequest,
  TransactionResponse,
  VerificationResponse,
  WebhookEvent,
} from "@birrjs/core";

import type { VerifyEtClient } from "./client";
import { VerifyEtApiError, VerifyEtError, VERIFYET_ERROR_CODES } from "./errors";
import { normalizeReceiptReference } from "./normalizers";
import type { VerifyEtChannel, VerifyEtSettlementMatch } from "./types";
import { CHANNEL_LABELS } from "./types";

function settlementMismatchMessage(
  match: VerifyEtSettlementMatch,
  channel: VerifyEtChannel | undefined,
): string {
  switch (match.reason) {
    case "missing_receiver_account":
      return "Could not read the receipt details. Please try again or contact support.";
    default:
      return channel
        ? "Payment doesn't match the expected account. Please check you paid to the correct account."
        : "We couldn't verify your payment. Please try again or contact support.";
  }
}

async function retryWithConfigAccount(
  client: VerifyEtClient,
  ref: string,
  subscriptionId: string | undefined,
  itemBank: string,
  channels: VerifyEtChannel[],
): Promise<VerificationResponse | null> {
  const detectedChannel = channels.find((ch) => ch.type === itemBank);
  if (!detectedChannel) return null;

  try {
    const retryResponse = await client.verify(ref, {
      waitMs: 15000,
      subscriptionId,
      settlementAccount: detectedChannel.value,
    });

    if (retryResponse.verification.processingStatus !== "completed") return null;

    const retryItem = retryResponse.data[0];
    if (!retryItem?.settlementAccountMatch?.matched) return null;

    const amount = retryItem.amount;
    if (amount == null) return null;

    return {
      success: true,
      status: "completed",
      amount: Math.round(amount * 100),
      currency: retryItem.currency ?? "ETB",
      providerTxRef: retryResponse.requestId,
    };
  } catch {
    return null;
  }
}

export type VerifyEtProvider = PaymentProvider;

export function createVerifyEtProvider(
  client: VerifyEtClient,
  channels: VerifyEtChannel[],
): VerifyEtProvider {
  return {
    async initializeTransaction(request: TransactionRequest): Promise<TransactionResponse> {
      const amount = request.amount / 100;
      const paymentChannels: PaymentChannel[] = channels.map((ch) => ({
        type: ch.type,
        label: CHANNEL_LABELS[ch.type] ?? ch.type,
        value: ch.value,
        accountHolder: ch.name,
      }));

      return {
        success: true,
        paymentInstructions: {
          amount,
          channels: paymentChannels,
        },
        txRef: request.txRef,
      };
    },

    async verifyTransaction(
      receiptUrl: string,
      subscriptionId?: string,
      channelType?: string,
    ): Promise<VerificationResponse> {
      let response;

      const channel = channelType ? channels.find((ch) => ch.type === channelType) : undefined;

      const ref = normalizeReceiptReference(receiptUrl);

      try {
        response = await client.verify(ref, {
          waitMs: 15000,
          subscriptionId,
          settlementAccount: channel?.value,
        });
      } catch (error) {
        if (error instanceof VerifyEtApiError) {
          const { statusCode } = error;
          if (statusCode === 401)
            throw new VerifyEtError(
              "Authentication failed",
              VERIFYET_ERROR_CODES.UNAUTHORIZED,
              statusCode,
            );
          if (statusCode === 402)
            throw new VerifyEtError(
              "Insufficient credits",
              VERIFYET_ERROR_CODES.INSUFFICIENT_CREDITS,
              statusCode,
            );
          if (statusCode === 422)
            return {
              success: false,
              status: "failed",
              error:
                "This receipt URL format isn't recognized. If you paid via Telebirr, try pasting just the transaction number instead of the full URL.",
            };
          if (statusCode === 429)
            throw new VerifyEtError(
              "Rate limit exceeded",
              VERIFYET_ERROR_CODES.RATE_LIMITED,
              statusCode,
            );
          if (statusCode >= 500)
            throw new VerifyEtError(
              "Verify.et server error",
              VERIFYET_ERROR_CODES.SERVER_ERROR,
              statusCode,
            );
          throw new VerifyEtError(
            error.message,
            VERIFYET_ERROR_CODES.VERIFICATION_FAILED,
            statusCode,
          );
        }
        if (
          error instanceof DOMException &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          throw new VerifyEtError(
            "Request timed out after 30s",
            VERIFYET_ERROR_CODES.TIMEOUT_ERROR,
            504,
          );
        }
        throw new VerifyEtError(
          error instanceof Error ? error.message : "Network error",
          VERIFYET_ERROR_CODES.NETWORK_ERROR,
        );
      }

      // Idempotency-Key will return cached result
      if (response.verification.processingStatus === "queued") {
        return {
          success: false,
          status: "pending",
          error: "Verification is pending. Please try again in a few seconds.",
        };
      }

      const item = response.data[0];
      if (!item) {
        return {
          success: false,
          status: "failed",
          error: "No verification data returned",
        };
      }

      if (!item.verified) {
        return {
          success: false,
          status: "failed",
          error:
            item.status === "not_found"
              ? "Transaction not found. Please check the receipt and try again."
              : `Verification failed: ${item.status}`,
        };
      }

      if (!item.settlementAccountMatch) {
        if (!channel) {
          const retryResult = await retryWithConfigAccount(
            client,
            ref,
            subscriptionId,
            item.bank,
            channels,
          );
          if (retryResult) return retryResult;
        }
        return {
          success: false,
          status: "failed",
          error: "We couldn't verify your payment. Please try again or contact support.",
        };
      }

      if (!item.settlementAccountMatch.matched) {
        if (channel || item.settlementAccountMatch.reason === "no_registered_accounts") {
          const retryResult = await retryWithConfigAccount(
            client,
            ref,
            subscriptionId,
            item.bank,
            channels,
          );
          if (retryResult) return retryResult;
        }
        return {
          success: false,
          status: "failed",
          error: settlementMismatchMessage(item.settlementAccountMatch, channel),
        };
      }

      const amount = item.amount;

      if (amount == null) {
        return {
          success: false,
          status: "failed",
          error: "Could not determine receipt amount",
        };
      }

      const amountInMinor = Math.round(amount * 100);

      return {
        success: true,
        status: "completed",
        amount: amountInMinor,
        currency: item.currency ?? "ETB",
        providerTxRef: response.requestId,
      };
    },

    async handleWebhook(
      _payload: unknown,
      _rawBody: string | Buffer,
      _headers: Record<string, string>,
    ): Promise<WebhookEvent> {
      return {
        providerReferenceId: "none",
        type: "unsupported",
        payload: {},
      };
    },
  };
}

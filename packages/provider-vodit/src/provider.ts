import type {
  PaymentProvider,
  TransactionRequest,
  TransactionResponse,
  VerificationResponse,
  WebhookEvent,
  PaymentInstructions,
} from "@birrjs/core";

import type { VoditClient } from "./client";
import { VoditApiError, VoditError, VODIT_ERROR_CODES } from "./errors";
import type { VoditChannelType, VoditVerifyResponse, VoditChannel } from "./types";
import { CHANNEL_LABELS } from "./types";

function extractLast4(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function tryField(receipt: Record<string, unknown>, field: string): number | null {
  const val = receipt[field];
  if (val == null) return null;

  if (typeof val === "number") return val;

  if (typeof val === "string") {
    const cleaned = val
      .replace(/\s*(Birr|ETB)\s*/gi, "")
      .replace(/,/g, "")
      .trim();
    const parsed = Number.parseFloat(cleaned);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function tryNestedField(
  receipt: Record<string, unknown>,
  path: string[],
): string | undefined | null {
  let current: unknown = receipt;
  for (const key of path) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current as string | undefined | null;
}

function parseReceiptAmount(
  receipt: Record<string, unknown> | null,
  providerKey: VoditChannelType,
): number | null {
  if (!receipt) return null;

  switch (providerKey) {
    case "telebirr":
      return tryField(receipt, "totalPaidAmount") ?? tryField(receipt, "settledAmount");
    case "cbe":
      return tryField(receipt, "transferredAmount") ?? tryField(receipt, "totalAmount");
    case "zemen":
      return tryField(receipt, "totalAmountPaid") ?? tryField(receipt, "settledAmount");
    case "boa":
      return tryField(receipt, "totalAmount") ?? tryField(receipt, "transferredAmount");
    case "awash":
      return tryField(receipt, "amount");
    default:
      return null;
  }
}

function getRecipientAccountLast4(
  receipt: Record<string, unknown>,
  providerKey: VoditChannelType,
): string | null {
  switch (providerKey) {
    case "telebirr":
      return extractLast4(receipt.creditedPartyAccountNo as string | undefined);
    case "cbe":
      return extractLast4(receipt.receiverAccount as string | undefined);
    case "zemen":
      return extractLast4(receipt.recipientAccount as string | undefined);
    case "boa":
      return extractLast4(receipt.receiverAccount as string | undefined);
    case "awash":
      return extractLast4(tryNestedField(receipt, ["transaction", "beneficiaryAccount"]));
    default:
      return null;
  }
}

function getRecipientName(
  receipt: Record<string, unknown>,
  providerKey: VoditChannelType,
): string | null {
  switch (providerKey) {
    case "telebirr":
      return (receipt.creditedPartyName as string | undefined) ?? null;
    case "cbe":
      return (receipt.receiverName as string | undefined) ?? null;
    case "zemen":
      return (receipt.recipientName as string | undefined) ?? null;
    case "boa":
      return (receipt.receiverName as string | undefined) ?? null;
    case "awash":
      return tryNestedField(receipt, ["transaction", "beneficiaryName"]) ?? null;
    default:
      return null;
  }
}

function isTransactionCompleted(
  receipt: Record<string, unknown> | null | undefined,
  providerKey: VoditChannelType,
  httpStatus: number,
): boolean {
  if (httpStatus === 502) return true;
  if (!receipt) return false;

  if (providerKey === "telebirr" || providerKey === "zemen") {
    const status = receipt.transactionStatus as string | undefined;
    if (!status) return false;
    return status.toLowerCase() === "completed";
  }

  return true;
}

export type VoditProvider = PaymentProvider;

export function createVoditProvider(client: VoditClient, channels: VoditChannel[]): VoditProvider {
  for (const ch of channels) {
    if (!ch.name?.trim()) {
      throw new VoditError(
        `Vodit channel "${ch.type}" requires a name for recipient verification`,
        VODIT_ERROR_CODES.INVALID_CONFIG,
        400,
      );
    }
  }

  return {
    async initializeTransaction(request: TransactionRequest): Promise<TransactionResponse> {
      const amount = request.amount / 100;
      const paymentChannels = channels.map((ch) => ({
        type: ch.type,
        label: CHANNEL_LABELS[ch.type] ?? ch.type,
        value: ch.value,
        accountHolder: ch.name,
      }));

      const paymentInstructions: PaymentInstructions = {
        amount,
        channels: paymentChannels,
      };

      return {
        success: true,
        paymentInstructions,
        txRef: request.txRef,
      };
    },

    async verifyTransaction(receiptUrl: string): Promise<VerificationResponse> {
      let response: VoditVerifyResponse;

      try {
        response = await client.verify(receiptUrl, { waitMs: 10000 });
      } catch (error) {
        if (error instanceof VoditApiError) {
          const { statusCode } = error;
          if (statusCode >= 500)
            throw new VoditError("Vodit server error", VODIT_ERROR_CODES.SERVER_ERROR, statusCode);
          if (statusCode === 401)
            throw new VoditError(
              "Authentication failed",
              VODIT_ERROR_CODES.UNAUTHORIZED,
              statusCode,
            );
          if (statusCode === 429)
            throw new VoditError("Rate limit exceeded", VODIT_ERROR_CODES.RATE_LIMITED, statusCode);
          throw new VoditError(error.message, VODIT_ERROR_CODES.VERIFICATION_FAILED, statusCode);
        }
        if (
          error instanceof DOMException &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          throw new VoditError("Request timed out after 30s", VODIT_ERROR_CODES.TIMEOUT_ERROR, 504);
        }
        throw new VoditError(
          error instanceof Error ? error.message : "Network error",
          VODIT_ERROR_CODES.NETWORK_ERROR,
        );
      }

      if (!response.ok && !response.receipt) {
        return {
          success: false,
          status: "failed",
          error:
            typeof response.error === "string"
              ? response.error
              : (response.error?.message ?? "Receipt verification failed"),
        };
      }

      const providerKey = response.providerKey;

      if (!isTransactionCompleted(response.receipt, providerKey, response.httpStatus)) {
        return {
          success: false,
          status: "failed",
          error:
            providerKey === "telebirr" || providerKey === "zemen"
              ? `Transaction not completed, expected "Completed" but got "${
                  (response.receipt?.transactionStatus as string | undefined) ?? "missing"
                }"`
              : "Receipt validation failed",
        };
      }

      const receiptAmount = parseReceiptAmount(response.receipt, providerKey);

      if (receiptAmount == null) {
        return {
          success: false,
          status: "failed",
          error: "Could not parse receipt amount",
        };
      }

      const amountInMinor = Math.round(receiptAmount * 100);

      const rawReceipt = response.receipt ?? {};
      const receiptLast4 = getRecipientAccountLast4(rawReceipt, providerKey);
      const receiptName = getRecipientName(rawReceipt, providerKey);
      const channel = channels.find((ch) => ch.type === providerKey);

      if (channel) {
        const channelLast4 = extractLast4(channel.value);

        if (receiptLast4 && channelLast4 && receiptLast4 !== channelLast4) {
          return {
            success: false,
            status: "failed",
            error:
              "The receipt doesn't match the payment account. Please make sure you paid to one of the accounts listed above.",
          };
        }

        if (receiptName && !receiptName.toLowerCase().startsWith(channel.name.toLowerCase())) {
          return {
            success: false,
            status: "failed",
            error:
              "The receipt doesn't match the payment account. Please make sure you paid to one of the accounts listed above.",
          };
        }
      }

      return {
        success: true,
        status: "completed",
        amount: amountInMinor,
        currency: "ETB",
        providerTxRef: receiptUrl,
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

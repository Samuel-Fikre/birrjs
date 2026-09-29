import type {
  PaymentProvider,
  PaymentProviderConfig,
  TransactionRequest,
  TransactionResponse,
  VerificationResponse,
  WebhookEvent,
} from "@birrjs/core";
import { toDecimalAmount, fromDecimalAmount } from "@birrjs/core";

import type { TelebirrClient } from "./client";
import { createTelebirrClient, isSuccessfulPayment } from "./client";
import { TelebirrError, TelebirrApiError, TELEBIRR_ERROR_CODES } from "./errors";
import { normalizePrivateKey } from "./private-key";
import { verifyRequestSignature } from "./signing";
import type { TelebirrConfig } from "./types";

export function createTelebirrProvider(
  client: TelebirrClient,
  config: PaymentProviderConfig,
  telebirrPublicKeyPem?: string,
): PaymentProvider {
  const defaultCurrency = config.currency ?? "ETB";

  return {
    async initializeTransaction(request: TransactionRequest): Promise<TransactionResponse> {
      try {
        const response = await client.createPayment({
          amount: toDecimalAmount(request.amount),
          title: request.customization?.title ?? "Subscription",
          merchantOrderId: request.txRef,
        });

        return {
          success: true,
          checkoutUrl: response.checkoutUrl,
          txRef: response.merchantOrderId,
        };
      } catch (error) {
        if (error instanceof TelebirrApiError) {
          const { statusCode } = error;

          if (statusCode >= 500) {
            throw new TelebirrError(
              `Telebirr server error: ${statusCode}`,
              TELEBIRR_ERROR_CODES.SERVER_ERROR,
              statusCode,
            );
          }
          if (statusCode === 401) {
            throw new TelebirrError(
              "Telebirr authorization failed: invalid credentials",
              TELEBIRR_ERROR_CODES.UNAUTHORIZED,
              statusCode,
            );
          }
          if (statusCode >= 400) {
            throw new TelebirrError(
              `Telebirr client error: ${statusCode}`,
              TELEBIRR_ERROR_CODES.CLIENT_ERROR,
              statusCode,
            );
          }
          throw new TelebirrError(
            error.message,
            TELEBIRR_ERROR_CODES.INITIALIZATION_FAILED,
            statusCode,
          );
        }

        if (error instanceof Error) {
          throw new TelebirrError(error.message, TELEBIRR_ERROR_CODES.INITIALIZATION_FAILED);
        }

        throw new TelebirrError(
          "Unknown error initializing transaction",
          TELEBIRR_ERROR_CODES.INITIALIZATION_FAILED,
        );
      }
    },

    async verifyTransaction(
      txRef: string,
      _subscriptionId?: string,
      _channelType?: string,
    ): Promise<VerificationResponse> {
      try {
        const response = await client.queryOrder(txRef);

        if (!isSuccessfulPayment(response)) {
          return {
            success: false,
            status: (response.biz_content?.order_status as string) ?? "failed",
            error: "Transaction verification failed",
          };
        }

        const amountStr = response.biz_content?.total_amount;
        const amount =
          typeof amountStr === "string"
            ? fromDecimalAmount(amountStr)
            : typeof amountStr === "number"
              ? fromDecimalAmount(amountStr.toString())
              : undefined;

        return {
          success: true,
          status: "success",
          amount,
          currency: (response.biz_content?.trans_currency as string) ?? defaultCurrency,
          txRef,
          providerTxRef: (response.biz_content?.payment_order_id as string) ?? undefined,
        };
      } catch (error) {
        if (error instanceof TelebirrApiError) {
          const { statusCode } = error;

          if (statusCode >= 500) {
            throw new TelebirrError(
              `Telebirr server error: ${statusCode}`,
              TELEBIRR_ERROR_CODES.SERVER_ERROR,
              statusCode,
            );
          }
          if (statusCode === 401) {
            throw new TelebirrError(
              "Telebirr authorization failed: invalid credentials",
              TELEBIRR_ERROR_CODES.UNAUTHORIZED,
              statusCode,
            );
          }
          if (statusCode >= 400) {
            throw new TelebirrError(
              `Telebirr client error: ${statusCode}`,
              TELEBIRR_ERROR_CODES.CLIENT_ERROR,
              statusCode,
            );
          }
          throw new TelebirrError(
            error.message,
            TELEBIRR_ERROR_CODES.VERIFICATION_FAILED,
            statusCode,
          );
        }

        if (error instanceof Error) {
          throw new TelebirrError(error.message, TELEBIRR_ERROR_CODES.VERIFICATION_FAILED);
        }

        throw new TelebirrError(
          "Unknown error verifying transaction",
          TELEBIRR_ERROR_CODES.VERIFICATION_FAILED,
        );
      }
    },

    async handleWebhook(
      payload: unknown,
      _rawBody: string | Buffer,
      _headers: Record<string, string>,
    ): Promise<WebhookEvent> {
      try {
        if (typeof payload !== "object" || payload === null) {
          throw new TelebirrError("Invalid webhook payload", TELEBIRR_ERROR_CODES.INVALID_WEBHOOK);
        }

        const event = payload as Record<string, unknown>;

        // Verify notify signature when Telebirr public key is configured (fail closed).
        // EXCLUDED_KEYS in signing already skips sign/sign_type during canonicalization.
        if (telebirrPublicKeyPem) {
          const sign = event.sign;
          if (typeof sign !== "string" || sign.length === 0) {
            throw new TelebirrError(
              "Missing sign in webhook payload",
              TELEBIRR_ERROR_CODES.INVALID_WEBHOOK,
            );
          }
          if (!verifyRequestSignature(event, sign, telebirrPublicKeyPem)) {
            throw new TelebirrError(
              "Invalid webhook signature",
              TELEBIRR_ERROR_CODES.INVALID_WEBHOOK,
            );
          }
        }

        // Unwrap data envelope if present
        const data = (event.data as Record<string, unknown>) ?? event;

        const merchantOrderId = (data.merch_order_id as string) ?? (data.merchantOrderId as string);
        if (!merchantOrderId) {
          throw new TelebirrError(
            "Missing merch_order_id in webhook payload",
            TELEBIRR_ERROR_CODES.INVALID_WEBHOOK,
          );
        }

        // Never trust callback — query Telebirr directly
        const verification = await client.queryOrder(merchantOrderId);

        const success = isSuccessfulPayment(verification);

        return {
          providerReferenceId: merchantOrderId,
          type: success ? "charge.success" : "charge.failed/cancelled",
          payload: verification as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof TelebirrError) {
          throw error;
        }
        if (error instanceof TelebirrApiError) {
          throw new TelebirrError(
            error.message,
            TELEBIRR_ERROR_CODES.VERIFICATION_FAILED,
            error.statusCode,
          );
        }
        throw new TelebirrError(
          error instanceof Error ? error.message : "Invalid webhook payload",
          TELEBIRR_ERROR_CODES.INVALID_WEBHOOK,
        );
      }
    },
  };
}

export interface TelebirrProviderOptions {
  gatewayUrl: string;
  checkoutUrl: string;
  fabricAppId: string;
  appSecret: string;
  merchantAppId: string;
  merchantCode: string;
  privateKeyPem: string;
  telebirrPublicKeyPem?: string;
  notifyUrl: string;
  redirectUrl: string;
  currency?: string;
  timeoutMs?: number;
}

export interface TelebirrProviderConfig extends TelebirrProviderOptions {
  id: string;
  kind: string;
  secretKey: string;
  callbackUrl: string;
  runtime: PaymentProvider;
}

export function telebirr(options: TelebirrProviderOptions): TelebirrProviderConfig {
  // Normalize the private key to ensure PEM format
  const normalizedKey = normalizePrivateKey(options.privateKeyPem);

  const telebirrConfig: TelebirrConfig = {
    gatewayUrl: options.gatewayUrl,
    checkoutUrl: options.checkoutUrl,
    fabricAppId: options.fabricAppId,
    appSecret: options.appSecret,
    merchantAppId: options.merchantAppId,
    merchantCode: options.merchantCode,
    privateKeyPem: normalizedKey,
    notifyUrl: options.notifyUrl,
    redirectUrl: options.redirectUrl,
    timeoutMs: options.timeoutMs,
  };

  const config = {
    ...options,
    id: "telebirr",
    kind: "telebirr",
    secretKey: options.appSecret,
    callbackUrl: options.notifyUrl,
  } satisfies PaymentProviderConfig;

  const client = createTelebirrClient(telebirrConfig);
  const runtime = createTelebirrProvider(client, config, options.telebirrPublicKeyPem || undefined);

  return {
    ...config,
    privateKeyPem: normalizedKey,
    runtime,
  };
}

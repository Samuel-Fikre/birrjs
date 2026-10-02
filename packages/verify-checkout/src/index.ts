import type { PaymentProviderConfig } from "@birrjs/core";

import { createVerifyCheckoutClient } from "./client";
import { VerifyCheckoutError, VERIFY_CHECKOUT_ERROR_CODES } from "./errors";
import { createVerifyCheckoutProvider } from "./provider";
import type { VerifyCheckoutProviderConfig, VerifyCheckoutProviderOptions } from "./types";

export { createVerifyCheckoutClient } from "./client";
export type { VerifyCheckoutClient, VerifyCheckoutClientConfig } from "./client";
export { VerifyCheckoutApiError, VerifyCheckoutError, VERIFY_CHECKOUT_ERROR_CODES } from "./errors";
export { createVerifyCheckoutProvider } from "./provider";
export type { VerifyCheckoutRuntimeOptions } from "./provider";
export { verifyWebhookSignature } from "./signing";
export { DEFAULT_VERIFY_CHECKOUT_BASE_URL, VERIFY_CHECKOUT_API_VERSION } from "./types";
export type {
  CreateDepositInput,
  ListDepositsParams,
  VerifyCheckoutDeposit,
  VerifyCheckoutDepositStatus,
  VerifyCheckoutProviderConfig,
  VerifyCheckoutProviderOptions,
  VerifyCheckoutVerification,
  VerifyCheckoutWebhookEvent,
  VerifyCheckoutWebhookEventType,
} from "./types";

export function verifyCheckout(
  options: VerifyCheckoutProviderOptions,
): VerifyCheckoutProviderConfig {
  if (!options.apiKey) {
    throw new VerifyCheckoutError(
      "apiKey is required (starts with vchk_)",
      VERIFY_CHECKOUT_ERROR_CODES.INVALID_CONFIG,
    );
  }
  if (!options.returnUrl) {
    throw new VerifyCheckoutError(
      "returnUrl is required — register its origin (scheme, host, port) in the Verify Checkout dashboard",
      VERIFY_CHECKOUT_ERROR_CODES.INVALID_CONFIG,
    );
  }

  const client = createVerifyCheckoutClient({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
  });

  const runtime = createVerifyCheckoutProvider(client, {
    returnUrl: options.returnUrl,
    webhookSecret: options.webhookSecret,
  });

  const config = {
    ...options,
    id: "verify-checkout",
    kind: "verify-checkout",
    secretKey: options.apiKey,
    callbackUrl: options.callbackUrl ?? options.returnUrl,
  } satisfies PaymentProviderConfig;

  return {
    ...config,
    runtime,
  };
}

export { createVerifyEtProvider } from "./provider";
export { createVerifyEtClient } from "./client";
export { VerifyEtApiError, VerifyEtError, VERIFYET_ERROR_CODES } from "./errors";
export type {
  VerifyEtProviderOptions,
  VerifyEtProviderConfig,
  VerifyEtChannel,
  VerifyEtChannelType,
} from "./types";
export type { VerifyEtVerifyResponse, VerifyEtStatusResponse } from "./types";
export type { VerifyEtClient } from "./client";

import { createVerifyEtClient } from "./client";
import { createVerifyEtProvider } from "./provider";
import type { VerifyEtProviderOptions, VerifyEtProviderConfig } from "./types";

export function verifyEt(options: VerifyEtProviderOptions): VerifyEtProviderConfig {
  const client = createVerifyEtClient({ apiKey: options.apiKey });
  const runtime = createVerifyEtProvider(client, options.channels);

  return {
    ...options,
    id: "verify-et",
    kind: "verify-et",
    secretKey: options.apiKey,
    callbackUrl: "",
    runtime,
  };
}

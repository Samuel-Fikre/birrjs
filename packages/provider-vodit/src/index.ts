export { createVoditProvider } from "./provider";
export { createVoditClient } from "./client";
export { VoditApiError, VoditError, VODIT_ERROR_CODES } from "./errors";
export type {
  VoditProviderOptions,
  VoditProviderConfig,
  VoditChannel,
  VoditChannelType,
} from "./types";
export type { VoditVerifyResponse, VoditStatusResponse } from "./types";
export type { VoditClient } from "./client";

import { createVoditClient } from "./client";
import { createVoditProvider } from "./provider";
import type { VoditProviderOptions, VoditProviderConfig } from "./types";

export function vodit(options: VoditProviderOptions): VoditProviderConfig {
  const client = createVoditClient({ apiKey: options.apiKey });
  const runtime = createVoditProvider(client, options.channels);

  return {
    ...options,
    id: "vodit",
    kind: "vodit",
    secretKey: options.apiKey,
    callbackUrl: "",
    runtime,
  };
}

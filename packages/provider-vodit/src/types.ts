import type { PaymentProvider } from "@birrjs/core";

export type VoditChannelType = "telebirr" | "cbe" | "awash";

export interface VoditChannel {
  type: VoditChannelType;
  value: string;
  name: string;
}

export interface VoditProviderOptions {
  apiKey: string;
  returnUrl?: string;
  channels: VoditChannel[];
}

export type VoditProviderConfig = VoditProviderOptions & {
  id: string;
  kind: string;
  secretKey: string;
  callbackUrl: string;
  runtime: PaymentProvider;
};

export interface VoditVerifyResponse {
  ok: boolean;
  providerKey: VoditChannelType;
  resolvedUrl: string;
  httpStatus: number;
  fetchedAt?: string;
  rawHtmlLength?: number;
  receipt: Record<string, unknown> | null;
  error: string | { code: string; message: string } | null;
  cached?: boolean;
  processingStatus?: "completed" | "queued" | "failed";
  requestId?: string;
  statusUrl?: string;
  eventsUrl?: string;
}

export interface VoditStatusResponse {
  ok: boolean;
  status: "operational" | "slow" | "down";
  checkedAt: string;
  cached: boolean;
  components: Array<{
    name: string;
    host: string;
    group: "internal" | "upstream";
    status: "operational" | "slow" | "down";
    responseMs: number | null;
    httpStatus: number | null;
    error: string | null;
  }>;
}

export const CHANNEL_LABELS: Record<VoditChannelType, string> = {
  telebirr: "Telebirr",
  cbe: "Commercial Bank Of Ethiopia",
  awash: "Awash Bank",
};

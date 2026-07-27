import type { PaymentProvider } from "@birrjs/core";

export type VerifyEtChannelType =
  | "telebirr"
  | "cbe"
  | "mpesa"
  | "dashen"
  | "boa"
  | "cbebirr"
  | "awash"
  | "siinqee"
  | "kaafiebirr";

export interface VerifyEtChannel {
  type: VerifyEtChannelType;
  value: string;
  name: string;
}

export interface VerifyEtProviderOptions {
  apiKey: string;
  channels: VerifyEtChannel[];
}

export type VerifyEtProviderConfig = VerifyEtProviderOptions & {
  id: string;
  kind: string;
  secretKey: string;
  callbackUrl: string;
  runtime: PaymentProvider;
};

export interface VerifyEtSettlementMatch {
  matched: boolean;
  matchType: string;
  matchConfidence: string;
  source: string;
  bank: string;
  receiverAccount: string;
  matchedSettlementAccount: string | null;
  matchedUserBankAccountId: string | null;
  matchedBusinessBankAccountId: string | null;
  candidateCount: number;
  ambiguous: boolean;
  reason: string;
}

export interface VerifyEtVerificationItem {
  bank: string;
  status: string;
  verified: boolean;
  amount?: number;
  currency?: string;
  senderName?: string;
  receiverName?: string;
  receiverAccount?: string;
  referenceNumber?: string;
  accountSuffix?: string;
  timestamp?: string;
  settlementAccountMatch?: VerifyEtSettlementMatch;
  confirmationHistory?: {
    scope: string;
    isFirstConfirmation: boolean;
    confirmedBefore: boolean;
    firstConfirmedAt: string;
    lastConfirmedAt: string;
    confirmationCount: number;
  };
}

export interface VerifyEtVerification {
  requestId: string;
  processingStatus: "queued" | "running" | "completed" | "failed";
  status: string;
  verified: boolean;
  bank?: string;
  result?: Record<string, unknown>;
}

export interface VerifyEtVerifyResponse {
  success: boolean;
  message: string;
  data: VerifyEtVerificationItem[];
  requestId: string;
  verification: VerifyEtVerification;
  links?: {
    statusUrl: string;
    pollAfterMs?: number;
    webhookRegistered?: boolean;
  };
  statusUrl?: string;
  estimatedWaitMs?: number;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

export interface VerifyEtStatusResponse {
  status: "operational" | "slow" | "down";
  checkedAt: string;
}

export const CHANNEL_LABELS: Record<VerifyEtChannelType, string> = {
  telebirr: "Telebirr",
  cbe: "Commercial Bank Of Ethiopia",
  mpesa: "M-Pesa",
  dashen: "Dashen Bank",
  boa: "Bank of Abyssinia",
  cbebirr: "CBE Birr",
  awash: "Awash Bank",
  siinqee: "Siinqee Bank",
  kaafiebirr: "Kaafie Birr",
};

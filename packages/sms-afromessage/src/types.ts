export interface AfromessageConfig {
  apiKey: string;
  from?: string;
  sender?: string;
  messages?: {
    paymentReceived?: string;
    paymentFailed?: string;
    subscriptionExpired?: string;
  };
}

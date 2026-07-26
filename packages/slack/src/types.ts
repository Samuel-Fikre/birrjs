export interface SlackConfig {
  webhookUrl: string;
  messages?: {
    paymentReceived?: string;
    paymentFailed?: string;
    subscriptionExpired?: string;
  };
}

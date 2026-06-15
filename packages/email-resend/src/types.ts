export interface ResendConfig {
  apiKey: string;
  from: string;
  subject?: {
    paymentReceived?: string;
    paymentFailed?: string;
    subscriptionExpired?: string;
    subscriptionReminder?: string;
  };
  messages?: {
    paymentReceived?: string;
    paymentFailed?: string;
    subscriptionExpired?: string;
    subscriptionReminder?: string;
  };
}

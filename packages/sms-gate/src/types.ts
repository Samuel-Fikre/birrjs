export interface SmsGateConfig {
  username: string;
  password: string;
  deviceId?: string;
  baseUrl?: string;
  simNumber?: number;
  messages?: {
    paymentReceived?: string;
    paymentFailed?: string;
    subscriptionExpired?: string;
    subscriptionReminder?: string;
  };
}

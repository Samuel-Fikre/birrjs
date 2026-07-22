import type { BirrJSPlugin } from "@birrjs/core";

import { SmsGateClient } from "./client";
import {
  formatMessage,
  DEFAULT_PAYMENT_RECEIVED,
  DEFAULT_PAYMENT_FAILED,
  DEFAULT_SUBSCRIPTION_EXPIRED,
  DEFAULT_SUBSCRIPTION_REMINDER,
  DEFAULT_TRIAL_STARTED,
  DEFAULT_TRIAL_ENDING,
} from "./messages";
import type { SmsGateConfig } from "./types";
import { getPhone } from "./utils";

export type { SmsGateConfig };
export {
  SmsGateClient,
  SmsGateError,
  SmsGateAuthError,
  SmsGateDeviceError,
  SmsGateQueueError,
  SmsGateValidationError,
} from "./client";

export function smsGate(config: SmsGateConfig): BirrJSPlugin {
  const client = new SmsGateClient(config);

  return {
    id: "sms-gate",
    onEvent: {
      "subscription.activated": async (payload, ctx) => {
        const phone = await getPhone(payload.customerId, ctx);
        if (!phone) return;
        const message = formatMessage(config.messages?.paymentReceived, DEFAULT_PAYMENT_RECEIVED, {
          planName: payload.planName,
        });
        await client.send(phone, message);
      },
      "subscription.cancelled": async (payload, ctx) => {
        const phone = await getPhone(payload.customerId, ctx);
        if (!phone) return;
        const message = formatMessage(config.messages?.paymentFailed, DEFAULT_PAYMENT_FAILED, {
          planName: payload.planName,
        });
        await client.send(phone, message);
      },
      "subscription.expired": async (payload, ctx) => {
        const phone = await getPhone(payload.customerId, ctx);
        if (!phone) return;
        const message = formatMessage(
          config.messages?.subscriptionExpired,
          DEFAULT_SUBSCRIPTION_EXPIRED,
          { planName: payload.planName },
        );
        await client.send(phone, message);
      },
      "subscription.trial_started": async (payload, ctx) => {
        const phone = await getPhone(payload.customerId, ctx);
        if (!phone) return;
        const message = formatMessage(config.messages?.trialStarted, DEFAULT_TRIAL_STARTED, {
          planName: payload.planName,
        });
        await client.send(phone, message);
      },
      "subscription.reminder": async (payload, _ctx) => {
        if (!payload.customerPhone) return;
        const message = formatMessage(
          config.messages?.subscriptionReminder,
          DEFAULT_SUBSCRIPTION_REMINDER,
          { daysUntil: String(payload.daysUntilExpiry), planName: payload.planName },
        );
        await client.send(payload.customerPhone, message);
      },
      "subscription.trial_ending": async (payload, _ctx) => {
        if (!payload.customerPhone) return;
        const message = formatMessage(config.messages?.trialEnding, DEFAULT_TRIAL_ENDING, {
          daysUntil: String(payload.daysUntilTrialEnd),
          planName: payload.planName,
        });
        await client.send(payload.customerPhone, message);
      },
    },
  };
}

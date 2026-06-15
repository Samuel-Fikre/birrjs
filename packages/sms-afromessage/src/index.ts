import type { BirrJSPlugin, BirrJSContext } from "@birrjs/core";

import type { AfromessageConfig } from "./types";

export type { AfromessageConfig };

const AFROMESSAGE_API = "https://api.afromessage.com/api/send";

async function sendSms(config: AfromessageConfig, to: string, message: string): Promise<void> {
  const params = new URLSearchParams({ to, message, template: "0" });
  if (config.from) params.set("from", config.from);
  if (config.sender) params.set("sender", config.sender);

  const response = await fetch(`${AFROMESSAGE_API}?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
    },
  });

  const body = (await response.json()) as { acknowledge: string; response?: { errors?: string[] } };

  if (!response.ok) {
    throw new Error(`Afromessage API HTTP error: ${response.status} ${response.statusText}`);
  }

  if (body.acknowledge !== "success") {
    const errors = body.response?.errors ?? ["Unknown error"];
    throw new Error(`Afromessage API error: ${errors.join(", ")}`);
  }
}

function formatMessage(
  template: string | undefined,
  fallback: string,
  vars: Record<string, string>,
): string {
  const tpl = template ?? fallback;
  return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

async function getPhone(customerId: string, ctx: BirrJSContext): Promise<string | undefined> {
  const customer = await ctx.queries.getCustomer(customerId);
  return customer?.phone ?? undefined;
}

const DEFAULT_PAYMENT_RECEIVED = "Your payment has been received. Thank you!";
const DEFAULT_PAYMENT_FAILED = "Your payment failed. Please update your payment method.";
const DEFAULT_SUBSCRIPTION_EXPIRED = "Your subscription has expired. Renew now to continue access.";
const DEFAULT_SUBSCRIPTION_REMINDER =
  "Reminder: your subscription expires in {daysUntil} days. Renew now!";

export function afromessage(config: AfromessageConfig): BirrJSPlugin {
  return {
    id: "sms-afromessage",
    onEvent: {
      "subscription.activated": async (payload, ctx) => {
        const phone = await getPhone(payload.customerId, ctx);
        if (!phone) return;
        const message = formatMessage(config.messages?.paymentReceived, DEFAULT_PAYMENT_RECEIVED, {
          planName: payload.planName,
        });
        await sendSms(config, phone, message);
      },
      "subscription.cancelled": async (payload, ctx) => {
        const phone = await getPhone(payload.customerId, ctx);
        if (!phone) return;
        const message = formatMessage(config.messages?.paymentFailed, DEFAULT_PAYMENT_FAILED, {
          planName: payload.planName,
        });
        await sendSms(config, phone, message);
      },
      "subscription.expired": async (payload, ctx) => {
        const phone = await getPhone(payload.customerId, ctx);
        if (!phone) return;
        const message = formatMessage(
          config.messages?.subscriptionExpired,
          DEFAULT_SUBSCRIPTION_EXPIRED,
          { planName: payload.planName },
        );
        await sendSms(config, phone, message);
      },
      "subscription.reminder": async (payload, _ctx) => {
        if (!payload.customerPhone) return;
        const message = formatMessage(
          config.messages?.subscriptionReminder,
          DEFAULT_SUBSCRIPTION_REMINDER,
          { daysUntil: String(payload.daysUntilExpiry), planName: payload.planName },
        );
        await sendSms(config, payload.customerPhone, message);
      },
    },
  };
}

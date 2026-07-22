import type { BirrJSPlugin, BirrJSContext } from "@birrjs/core";

import type { ResendConfig } from "./types";

export type { ResendConfig };

const RESEND_API = "https://api.resend.com/emails";

async function sendEmail(
  config: ResendConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `HTTP ${response.status}`;
    throw new Error(`Resend API error: ${message}`);
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

async function getEmail(
  customerId: string,
  ctx: BirrJSContext,
): Promise<{ email: string; name: string | null } | undefined> {
  const customer = await ctx.queries.getCustomer(customerId);
  if (!customer?.email) return undefined;
  return { email: customer.email, name: customer.name };
}

const DEFAULT_SUBJECT_PAYMENT_RECEIVED = "Payment received";
const DEFAULT_SUBJECT_PAYMENT_FAILED = "Payment failed";
const DEFAULT_SUBJECT_EXPIRED = "Subscription expired";
const DEFAULT_SUBJECT_REMINDER = "Reminder: subscription expires soon";
const DEFAULT_SUBJECT_TRIAL_STARTED = "Trial started";
const DEFAULT_SUBJECT_TRIAL_ENDING = "Trial ending soon";

const DEFAULT_HTML_PAYMENT_RECEIVED = `<h1>Payment received</h1><p>Thank you, {name}. You are now subscribed to {planName}.</p>`;
const DEFAULT_HTML_PAYMENT_FAILED = `<h1>Payment failed</h1><p>{name}, your payment for {planName} could not be processed. Please update your payment method.</p>`;
const DEFAULT_HTML_EXPIRED = `<h1>Subscription expired</h1><p>{name}, your {planName} subscription has expired. Renew now to continue access.</p>`;
const DEFAULT_HTML_REMINDER = `<h1>Renewal reminder</h1><p>{name}, your {planName} subscription expires in {daysUntil} days. Renew now to avoid interruption.</p>`;
const DEFAULT_HTML_TRIAL_STARTED = `<h1>Trial started</h1><p>Welcome, {name}! Your {planName} trial is now active. Explore all features during your trial period.</p>`;
const DEFAULT_HTML_TRIAL_ENDING = `<h1>Trial ending soon</h1><p>{name}, your {planName} trial ends in {daysUntil} days. Subscribe now to keep access.</p>`;

export function resend(config: ResendConfig): BirrJSPlugin {
  return {
    id: "email-resend",
    onEvent: {
      "subscription.activated": async (payload, ctx) => {
        const customer = await getEmail(payload.customerId, ctx);
        if (!customer) return;
        const subject = config.subject?.paymentReceived ?? DEFAULT_SUBJECT_PAYMENT_RECEIVED;
        const html = formatMessage(
          config.messages?.paymentReceived,
          DEFAULT_HTML_PAYMENT_RECEIVED,
          { name: customer.name ?? "", planName: payload.planName },
        );
        await sendEmail(config, customer.email, subject, html);
      },
      "subscription.cancelled": async (payload, ctx) => {
        const customer = await getEmail(payload.customerId, ctx);
        if (!customer) return;
        const subject = config.subject?.paymentFailed ?? DEFAULT_SUBJECT_PAYMENT_FAILED;
        const html = formatMessage(config.messages?.paymentFailed, DEFAULT_HTML_PAYMENT_FAILED, {
          name: customer.name ?? "",
          planName: payload.planName,
        });
        await sendEmail(config, customer.email, subject, html);
      },
      "subscription.expired": async (payload, ctx) => {
        const customer = await getEmail(payload.customerId, ctx);
        if (!customer) return;
        const subject = config.subject?.subscriptionExpired ?? DEFAULT_SUBJECT_EXPIRED;
        const html = formatMessage(config.messages?.subscriptionExpired, DEFAULT_HTML_EXPIRED, {
          name: customer.name ?? "",
          planName: payload.planName,
        });
        await sendEmail(config, customer.email, subject, html);
      },
      "subscription.trial_started": async (payload, ctx) => {
        if (!payload.customerEmail) return;
        const customer = await getEmail(payload.customerId, ctx);
        const subject = config.subject?.trialStarted ?? DEFAULT_SUBJECT_TRIAL_STARTED;
        const html = formatMessage(config.messages?.trialStarted, DEFAULT_HTML_TRIAL_STARTED, {
          planName: payload.planName,
          name: customer?.name ?? "",
        });
        await sendEmail(config, payload.customerEmail, subject, html);
      },
      "subscription.reminder": async (payload, ctx) => {
        if (!payload.customerEmail) return;
        const customer = await getEmail(payload.customerId, ctx);
        const subject = config.subject?.subscriptionReminder ?? DEFAULT_SUBJECT_REMINDER;
        const html = formatMessage(config.messages?.subscriptionReminder, DEFAULT_HTML_REMINDER, {
          daysUntil: String(payload.daysUntilExpiry),
          planName: payload.planName,
          name: customer?.name ?? "",
        });
        await sendEmail(config, payload.customerEmail, subject, html);
      },
      "subscription.trial_ending": async (payload, ctx) => {
        if (!payload.customerEmail) return;
        const customer = await getEmail(payload.customerId, ctx);
        const subject = config.subject?.trialEnding ?? DEFAULT_SUBJECT_TRIAL_ENDING;
        const html = formatMessage(config.messages?.trialEnding, DEFAULT_HTML_TRIAL_ENDING, {
          daysUntil: String(payload.daysUntilTrialEnd),
          planName: payload.planName,
          name: customer?.name ?? "",
        });
        await sendEmail(config, payload.customerEmail, subject, html);
      },
    },
  };
}

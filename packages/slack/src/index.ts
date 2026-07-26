import type { BirrJSPlugin, BirrJSContext } from "@birrjs/core";

import type { SlackConfig } from "./types";

export type { SlackConfig };

type SlackBlock = Record<string, unknown>;

function buildPayload(text: string, blocks: SlackBlock[]): Record<string, unknown> {
  return { text, blocks };
}

async function sendSlack(config: SlackConfig, text: string, blocks: SlackBlock[]): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(text, blocks)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => null);
      throw new Error(`Slack webhook error: HTTP ${response.status}${body ? ` — ${body}` : ""}`);
    }
  } finally {
    clearTimeout(timeout);
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

async function getCustomerName(
  customerId: string,
  ctx: BirrJSContext,
): Promise<string | undefined> {
  const customer = await ctx.queries.getCustomer(customerId);
  return customer?.name ?? undefined;
}

function headerBlock(text: string): SlackBlock {
  return { type: "header", text: { type: "plain_text", text } };
}

function sectionBlock(mrkdwn: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text: mrkdwn } };
}

function fieldsBlock(fields: string[]): SlackBlock {
  return {
    type: "section",
    fields: fields.map((f) => ({ type: "mrkdwn", text: f })),
  };
}

const TEXT_PAYMENT_RECEIVED = "Payment received from {name} for {planName}";
const TEXT_PAYMENT_FAILED = "Payment cancelled for {name} — {planName}";
const TEXT_SUBSCRIPTION_EXPIRED = "Subscription expired for {name} — {planName}";

function addEmailBlock(blocks: SlackBlock[], email: string | null): void {
  if (email) blocks.push(sectionBlock(`*Email:* ${email}`));
}

const BLOCKS_SUBSCRIPTION_EXPIRED = (
  name: string,
  planName: string,
  customerEmail: string | null,
  expiredAt: string,
): SlackBlock[] => {
  const blocks: SlackBlock[] = [
    headerBlock("Subscription expired"),
    fieldsBlock([`*Customer:*\n${name}`, `*Plan:*\n${planName}`]),
  ];
  addEmailBlock(blocks, customerEmail);
  blocks.push(sectionBlock(`*Expired:* ${expiredAt}`));
  return blocks;
};

const BLOCKS_PAYMENT_RECEIVED = (
  name: string,
  planName: string,
  customerEmail: string | null,
  startedAt: string | null,
  expiresAt: string | null,
): SlackBlock[] => {
  const blocks: SlackBlock[] = [
    headerBlock("Payment received"),
    fieldsBlock([`*Customer:*\n${name}`, `*Plan:*\n${planName}`]),
  ];
  addEmailBlock(blocks, customerEmail);
  blocks.push(fieldsBlock([`*Started:*\n${startedAt ?? "—"}`, `*Expires:*\n${expiresAt ?? "—"}`]));
  return blocks;
};

const BLOCKS_PAYMENT_FAILED = (
  name: string,
  planName: string,
  customerEmail: string | null,
): SlackBlock[] => {
  const blocks: SlackBlock[] = [
    headerBlock("Payment failed"),
    fieldsBlock([`*Customer:*\n${name}`, `*Plan:*\n${planName}`]),
  ];
  addEmailBlock(blocks, customerEmail);
  return blocks;
};

export function slack(config: SlackConfig): BirrJSPlugin {
  return {
    id: "slack",
    onEvent: {
      "subscription.activated": async (payload, ctx) => {
        const name = await getCustomerName(payload.customerId, ctx);
        const displayName = name ?? payload.customerEmail ?? "Unknown";
        const text = formatMessage(config.messages?.paymentReceived, TEXT_PAYMENT_RECEIVED, {
          name: displayName,
          planName: payload.planName,
        });
        const blocks = BLOCKS_PAYMENT_RECEIVED(
          displayName,
          payload.planName,
          payload.customerEmail,
          payload.startedAt?.toISOString() ?? null,
          payload.expiresAt?.toISOString() ?? null,
        );
        await sendSlack(config, text, blocks);
      },
      "subscription.cancelled": async (payload, ctx) => {
        const name = await getCustomerName(payload.customerId, ctx);
        const displayName = name ?? payload.customerEmail ?? "Unknown";
        const text = formatMessage(config.messages?.paymentFailed, TEXT_PAYMENT_FAILED, {
          name: displayName,
          planName: payload.planName,
        });
        await sendSlack(
          config,
          text,
          BLOCKS_PAYMENT_FAILED(displayName, payload.planName, payload.customerEmail),
        );
      },
      "subscription.expired": async (payload, ctx) => {
        const name = await getCustomerName(payload.customerId, ctx);
        const displayName = name ?? payload.customerEmail ?? "Unknown";
        const text = formatMessage(
          config.messages?.subscriptionExpired,
          TEXT_SUBSCRIPTION_EXPIRED,
          {
            name: displayName,
            planName: payload.planName,
          },
        );
        await sendSlack(
          config,
          text,
          BLOCKS_SUBSCRIPTION_EXPIRED(
            displayName,
            payload.planName,
            payload.customerEmail,
            payload.expiredAt.toISOString(),
          ),
        );
      },
    },
  };
}

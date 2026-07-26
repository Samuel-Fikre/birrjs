import type {
  BirrJSContext,
  BirrJSOptions,
  PaymentProviderConfig,
  PaymentProvider,
  BirrJSInternalLogger,
} from "@birrjs/core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { slack } from "../index";

type SlackBlock = Record<string, unknown>;

let mockFetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
});

afterEach(() => {
  mockFetch.mockRestore();
});

function createMockCtx(overrides?: Partial<BirrJSContext>): BirrJSContext {
  return {
    options: undefined as unknown as BirrJSOptions,
    database: {} as Record<string, never>,
    queries: {
      getCustomer: async () => null,
      getSubscription: async () => null,
      countRedemptions: async () => 0,
    },
    provider: undefined as unknown as PaymentProviderConfig,
    runtime: undefined as unknown as PaymentProvider,
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as unknown as BirrJSInternalLogger,
    destroy: vi.fn(),
    ...overrides,
  } as BirrJSContext;
}

function getCallPayload(): { text: string; blocks: SlackBlock[] } {
  const call = mockFetch.mock.calls[0]! as [string, RequestInit];
  return JSON.parse(call[1]!.body as string);
}

function getCallUrl(): string {
  return mockFetch.mock.calls[0]![0] as string;
}

describe("slack plugin", () => {
  describe("subscription.activated", () => {
    const WEBHOOK_URL = "https://hooks.slack.com/services/T1/B1/xxx";

    it("sends correct payload with header, customer, plan, dates", async () => {
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: "Alice", phone: null }),
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: "alice@example.com",
          startedAt: new Date("2026-07-01"),
          expiresAt: new Date("2026-08-01"),
        },
        ctx,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getCallUrl()).toBe(WEBHOOK_URL);
      expect(mockFetch.mock.calls[0]![1]!.method).toBe("POST");
      expect(mockFetch.mock.calls[0]![1]!.headers).toEqual({ "Content-Type": "application/json" });

      const payload = getCallPayload();
      expect(payload.text).toBe("Payment received from Alice for Pro");

      const [header, fields, emailBlock, datesBlock] = payload.blocks;
      expect(header).toStrictEqual({
        type: "header",
        text: { type: "plain_text", text: "Payment received" },
      });
      expect(fields).toStrictEqual({
        type: "section",
        fields: [
          { type: "mrkdwn", text: "*Customer:*\nAlice" },
          { type: "mrkdwn", text: "*Plan:*\nPro" },
        ],
      });
      expect(emailBlock).toStrictEqual({
        type: "section",
        text: { type: "mrkdwn", text: "*Email:* alice@example.com" },
      });
      expect(datesBlock).toStrictEqual({
        type: "section",
        fields: [
          { type: "mrkdwn", text: "*Started:*\n2026-07-01T00:00:00.000Z" },
          { type: "mrkdwn", text: "*Expires:*\n2026-08-01T00:00:00.000Z" },
        ],
      });
    });

    it("omits email block when customerEmail is null", async () => {
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: "Bob", phone: null }),
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: null,
          startedAt: null,
          expiresAt: null,
        },
        ctx,
      );

      const blocks = getCallPayload().blocks;
      expect(blocks).toHaveLength(3);
      const emailBlock = blocks.find((b) => {
        const t = b as { text?: { text?: string } };
        return t.text?.text?.includes("@");
      });
      expect(emailBlock).toBeUndefined();
    });

    it("uses 'Unknown' when customer name and email are both unavailable", async () => {
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => null,
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: null,
          startedAt: null,
          expiresAt: null,
        },
        ctx,
      );
      expect(getCallPayload().text).toContain("Unknown");
    });

    it("uses custom message template when configured", async () => {
      const plugin = slack({
        webhookUrl: WEBHOOK_URL,
        messages: { paymentReceived: "{name} subscribed to {planName}" },
      });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: "Bob", phone: null }),
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: null,
          startedAt: null,
          expiresAt: null,
        },
        ctx,
      );
      expect(getCallPayload().text).toBe("Bob subscribed to Pro");
    });

    it("throws on fetch failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: null, phone: null }),
          getSubscription: async () => null,
        },
      });
      await expect(
        plugin.onEvent!["subscription.activated"]!(
          {
            customerId: "c1",
            subscriptionId: "s1",
            planId: "p1",
            planName: "Pro",
            customerEmail: null,
            startedAt: null,
            expiresAt: null,
          },
          ctx,
        ),
      ).rejects.toThrow("Network error");
    });
  });

  describe("subscription.cancelled", () => {
    const WEBHOOK_URL = "https://hooks.slack.com/services/T1/B1/xxx";

    it("sends correct payload with header, customer, plan", async () => {
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: "Charlie", phone: null }),
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.cancelled"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: "charlie@example.com",
          canceledAt: null,
          endedAt: new Date("2026-07-15"),
        },
        ctx,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getCallUrl()).toBe(WEBHOOK_URL);
      expect(mockFetch.mock.calls[0]![1]!.method).toBe("POST");

      const payload = getCallPayload();
      expect(payload.text).toBe("Payment cancelled for Charlie — Pro");

      const [header, fields, emailBlock] = payload.blocks;
      expect(header).toStrictEqual({
        type: "header",
        text: { type: "plain_text", text: "Payment failed" },
      });
      expect(fields).toStrictEqual({
        type: "section",
        fields: [
          { type: "mrkdwn", text: "*Customer:*\nCharlie" },
          { type: "mrkdwn", text: "*Plan:*\nPro" },
        ],
      });
      expect(emailBlock).toStrictEqual({
        type: "section",
        text: { type: "mrkdwn", text: "*Email:* charlie@example.com" },
      });
    });

    it("omits email block when customerEmail is null", async () => {
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: "Charlie", phone: null }),
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.cancelled"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: null,
          canceledAt: null,
          endedAt: null,
        },
        ctx,
      );

      const blocks = getCallPayload().blocks;
      expect(blocks).toHaveLength(2);
    });
  });

  describe("subscription.expired", () => {
    const WEBHOOK_URL = "https://hooks.slack.com/services/T1/B1/xxx";

    it("sends correct payload with header, customer, plan, expiry date", async () => {
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: "Diana", phone: null }),
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.expired"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: "diana@example.com",
          expiredAt: new Date("2026-07-15"),
        },
        ctx,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getCallUrl()).toBe(WEBHOOK_URL);
      expect(mockFetch.mock.calls[0]![1]!.method).toBe("POST");

      const payload = getCallPayload();
      expect(payload.text).toBe("Subscription expired for Diana — Pro");

      const [header, fields, emailBlock, dateBlock] = payload.blocks;
      expect(header).toStrictEqual({
        type: "header",
        text: { type: "plain_text", text: "Subscription expired" },
      });
      expect(fields).toStrictEqual({
        type: "section",
        fields: [
          { type: "mrkdwn", text: "*Customer:*\nDiana" },
          { type: "mrkdwn", text: "*Plan:*\nPro" },
        ],
      });
      expect(emailBlock).toStrictEqual({
        type: "section",
        text: { type: "mrkdwn", text: "*Email:* diana@example.com" },
      });
      expect(dateBlock).toStrictEqual({
        type: "section",
        text: { type: "mrkdwn", text: "*Expired:* 2026-07-15T00:00:00.000Z" },
      });
    });

    it("omits email when customerEmail is null and shows date", async () => {
      const plugin = slack({ webhookUrl: WEBHOOK_URL });
      const ctx = createMockCtx({
        queries: {
          countRedemptions: async () => 0,
          getCustomer: async () => ({ id: "c1", email: "u@e.com", name: "Diana", phone: null }),
          getSubscription: async () => null,
        },
      });
      await plugin.onEvent!["subscription.expired"]!(
        {
          customerId: "c1",
          subscriptionId: "s1",
          planId: "p1",
          planName: "Pro",
          customerEmail: null,
          expiredAt: new Date("2026-07-15"),
        },
        ctx,
      );

      const blocks = getCallPayload().blocks;
      expect(blocks).toHaveLength(3);
      const emailBlock = blocks.find((b) => {
        const t = b as { text?: { text?: string } };
        return t.text?.text?.includes("@");
      });
      expect(emailBlock).toBeUndefined();
    });
  });
});

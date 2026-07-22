import type {
  BirrJSContext,
  BirrJSOptions,
  PaymentProviderConfig,
  PaymentProvider,
  BirrJSInternalLogger,
} from "@birrjs/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { resend } from "../index";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function createMockCtx(overrides?: Partial<BirrJSContext>): BirrJSContext {
  return {
    options: undefined as unknown as BirrJSOptions,
    database: undefined as unknown as Record<string, never>,
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
  } as unknown as BirrJSContext;
}

describe("resend plugin", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email_123" }),
    });
  });

  it("skips sending when customer has no email", async () => {
    const plugin = resend({ apiKey: "re_xxx", from: "test@example.com" });
    const ctx = createMockCtx();
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends email on subscription.activated when email found", async () => {
    const plugin = resend({ apiKey: "re_xxx", from: "BirrJS <noreply@birrjs.dev>" });
    const ctx = createMockCtx({
      queries: {
        countRedemptions: async () => 0,
        getCustomer: async () => ({
          id: "c1",
          email: "user@example.com",
          name: "Test User",
          phone: null,
        }),
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(call[0]).toBe("https://api.resend.com/emails");
    expect(call[1]!.method).toBe("POST");
    const body = JSON.parse(call[1]!.body as string);
    expect(body.from).toBe("BirrJS <noreply@birrjs.dev>");
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.subject).toBe("Payment received");
    expect(body.html).toContain("Thank you");
    expect(call[1]!.headers).toEqual({
      Authorization: "Bearer re_xxx",
      "Content-Type": "application/json",
    });
  });

  it("uses custom subject and template", async () => {
    const plugin = resend({
      apiKey: "re_xxx",
      from: "test@example.com",
      subject: { paymentReceived: "Thanks {{name}}!" },
      messages: { paymentReceived: "<h1>Hey {name}</h1>" },
    });
    const ctx = createMockCtx({
      queries: {
        countRedemptions: async () => 0,
        getCustomer: async () => ({
          id: "c1",
          email: "user@example.com",
          name: "Alice",
          phone: null,
        }),
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
    const call = mockFetch.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.subject).toBe("Thanks {{name}}!");
    expect(body.html).toBe("<h1>Hey Alice</h1>");
  });

  it("sends reminder email with daysUntil", async () => {
    const plugin = resend({ apiKey: "re_xxx", from: "test@example.com" });
    const ctx = createMockCtx({
      queries: {
        countRedemptions: async () => 0,
        getCustomer: async () => ({
          id: "c1",
          email: "user@example.com",
          name: "Test User",
          phone: null,
        }),
        getSubscription: async () => null,
      },
    });
    await plugin.onEvent!["subscription.reminder"]!(
      {
        customerId: "c1",
        subscriptionId: "s1",
        planId: "p1",
        planName: "Premium",
        customerEmail: "user@example.com",
        customerPhone: null,
        expiresAt: new Date("2026-07-01"),
        daysUntilExpiry: 3,
      },
      ctx,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.html).toContain("3 days");
  });

  it("throws on API failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const plugin = resend({ apiKey: "re_xxx", from: "test@example.com" });
    const ctx = createMockCtx({
      queries: {
        countRedemptions: async () => 0,
        getCustomer: async () => ({
          id: "c1",
          email: "user@example.com",
          name: null,
          phone: null,
        }),
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

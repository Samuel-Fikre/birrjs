import type {
  BirrJSContext,
  BirrJSOptions,
  PaymentProviderConfig,
  PaymentProvider,
  BirrJSInternalLogger,
} from "@birrjs/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { afromessage } from "../index";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function createMockCtx(overrides?: Partial<BirrJSContext>): BirrJSContext {
  return {
    options: undefined as unknown as BirrJSOptions,
    database: undefined as unknown as Record<string, never>,
    queries: {
      getCustomer: async () => null,
      getSubscription: async () => null,
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

describe("createAfromessagePlugin", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ acknowledge: "success", response: {} }),
    });
  });

  it("returns a valid BirrJSPlugin with correct id", () => {
    const plugin = afromessage({ apiKey: "sk-test", sender: "BirrJS" });
    expect(plugin.id).toBe("sms-afromessage");
    expect(plugin.onEvent).toBeDefined();
  });

  it("skips sending when customer has no phone in metadata", async () => {
    const plugin = afromessage({ apiKey: "sk-test", sender: "BirrJS" });
    const ctx = createMockCtx();
    await plugin.onEvent!["subscription.activated"]!(
      { customerId: "c1", subscriptionId: "s1", planId: "p1", startedAt: null, expiresAt: null },
      ctx,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends SMS on subscription.activated when phone found", async () => {
    const plugin = afromessage({ apiKey: "sk-test", from: "ID_1", sender: "BirrJS" });
    const ctx = createMockCtx({
      queries: {
        getCustomer: async () => ({
          id: "c1",
          email: null,
          name: "Test User",
          phone: "+251911111111",
        }),
        getSubscription: async () => null,
      },
    });
    await plugin.onEvent!["subscription.activated"]!(
      { customerId: "c1", subscriptionId: "s1", planId: "p1", startedAt: null, expiresAt: null },
      ctx,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(call[0]).toBe("https://api.afromessage.com/api/send");
    expect(call[1]!.method).toBe("POST");
    expect(call[1]!.headers).toEqual({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(call[1]!.body as string);
    expect(body.from).toBe("ID_1");
    expect(body.sender).toBe("BirrJS");
    expect(body.to).toBe("+251911111111");
    expect(body.message).toContain("Thank you");
  });

  it("sends payment failed message on subscription.cancelled", async () => {
    const plugin = afromessage({
      apiKey: "sk-test",
      sender: "BirrJS",
      messages: { paymentFailed: "Oops {name}, payment failed!" },
    });
    const ctx = createMockCtx({
      queries: {
        getCustomer: async () => ({ id: "c1", email: null, name: "Test", phone: "+251911111111" }),
        getSubscription: async () => null,
      },
    });
    await plugin.onEvent!["subscription.cancelled"]!(
      { customerId: "c1", subscriptionId: "s1", planId: "p1", canceledAt: null, endedAt: null },
      ctx,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.message).toBe("Oops {name}, payment failed!");
  });

  it("throws on api failure when called directly", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const plugin = afromessage({ apiKey: "sk-test", sender: "BirrJS" });
    const ctx = createMockCtx({
      queries: {
        getCustomer: async () => ({ id: "c1", email: null, name: null, phone: "+251911111111" }),
        getSubscription: async () => null,
      },
    });
    await expect(
      plugin.onEvent!["subscription.activated"]!(
        { customerId: "c1", subscriptionId: "s1", planId: "p1", startedAt: null, expiresAt: null },
        ctx,
      ),
    ).rejects.toThrow("Network error");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BirrJSInternalLogger } from "../../core/logger";
import type { BirrJSEventHandlers, BirrJSEventMap } from "../../types/events";
import type { BeforeSubscribeHookCtx, BirrJSPlugin } from "../../types/plugin";
import { runBeforeHooks, runAfterHooks, runEventHandlers } from "../hooks";

const mockErrorFn = vi.fn();
const mockLogger = {
  error: mockErrorFn,
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as Parameters<typeof runEventHandlers>[3];

function createPlugin(id: string, hooks?: Partial<BirrJSPlugin>): BirrJSPlugin {
  return { id, ...hooks };
}

const defaultBeforeCtx = {
  customerId: "cust_123",
  plan: {
    id: "pro-monthly",
    name: "Pro Monthly",
    group: null,
    includes: [],
    isDefault: false,
    priceAmount: 2999,
    priceInterval: "monthly" as const,
    trialDays: null,
    resetOnTrialConversion: false,
    currency: "ETB",
    hash: "abc123",
  },
  customerEmail: "user@example.com",
  ip: "192.168.1.1",
  queries: {} as BeforeSubscribeHookCtx["queries"],
};

const defaultAfterCtx = {
  customerId: "cust_123",
  plan: {
    id: "pro-monthly",
    name: "Pro Monthly",
    group: null,
    includes: [],
    isDefault: false,
    trialDays: 0,
    resetOnTrialConversion: false,
    priceAmount: 2900,
    priceInterval: "monthly" as const,
    currency: "ETB",
    hash: "",
  },
  planId: "pro-monthly",
  subscriptionId: "sub_456",
  checkoutUrl: "https://checkout.chapa.co/checkout/payment/abc123",
  txRef: "tx_random-uuid",
};

describe("runBeforeHooks", () => {
  it("swallows hook error and resolves undefined (fail-isolated)", async () => {
    const plugins = [
      createPlugin("p1", {
        onBeforeSubscribe: async () => {
          throw new Error("blocked");
        },
      }),
    ];
    await expect(runBeforeHooks(plugins, defaultBeforeCtx, 5000)).resolves.toBeUndefined();
  });

  it("swallows error from one hook, others still resolve", async () => {
    const plugins = [
      createPlugin("p1", { onBeforeSubscribe: async () => {} }),
      createPlugin("p2", {
        onBeforeSubscribe: async () => {
          throw new Error("no access");
        },
      }),
      createPlugin("p3", { onBeforeSubscribe: async () => {} }),
    ];
    await expect(runBeforeHooks(plugins, defaultBeforeCtx, 5000)).resolves.toBeUndefined();
  });

  it("catches synchronously thrown error (non-async throw)", async () => {
    const plugins = [
      createPlugin("p1", {
        onBeforeSubscribe: () => {
          throw new Error("sync crash");
        },
      }),
    ];
    await expect(runBeforeHooks(plugins, defaultBeforeCtx, 5000)).resolves.toBeUndefined();
  });

  it("applies timeout when hook takes too long", async () => {
    let resolveHook: () => void;
    const hookPromise = new Promise<void>((resolve) => {
      resolveHook = resolve;
    });
    const plugins = [
      createPlugin("p1", {
        onBeforeSubscribe: async () => {
          await hookPromise;
        },
      }),
    ];
    const start = Date.now();
    const result = runBeforeHooks(plugins, defaultBeforeCtx, 200);
    await expect(result).rejects.toThrow("timed out");
    expect(Date.now() - start).toBeLessThan(2000);
    resolveHook!();
  });
});

describe("runAfterHooks", () => {
  it("logs errors with allSettled (fail-open)", async () => {
    const errorFn = vi.fn();
    const logger = {
      error: errorFn,
      info: vi.fn(),
      warn: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as unknown as BirrJSInternalLogger;
    const plugins = [
      createPlugin("p1", {
        onCheckoutReady: async () => {
          throw new Error("log error");
        },
      }),
    ];
    await runAfterHooks(plugins, defaultAfterCtx, logger);
    expect(errorFn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Plugin onCheckoutReady hook error",
    );
  });
});

describe("runEventHandlers", () => {
  beforeEach(() => {
    mockErrorFn.mockClear();
  });

  it("calls the named handler with the payload", async () => {
    const handler = vi.fn();
    const on: BirrJSEventHandlers = { "subscription.activated": handler };
    const payload: BirrJSEventMap["subscription.activated"] = {
      customerId: "c1",
      subscriptionId: "s1",
      planId: "p1",
      planName: "Pro",
      customerEmail: null,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };
    await runEventHandlers(on, "subscription.activated", payload, mockLogger);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("calls the wildcard handler with wrapped event", async () => {
    const wildcard = vi.fn();
    const on: BirrJSEventHandlers = { "*": wildcard };
    const payload: BirrJSEventMap["subscription.cancelled"] = {
      customerId: "c1",
      subscriptionId: "s1",
      planId: "p1",
      planName: "Pro",
      customerEmail: null,
      canceledAt: new Date(),
      endedAt: null,
    };
    await runEventHandlers(on, "subscription.cancelled", payload, mockLogger);
    expect(wildcard).toHaveBeenCalledWith({ name: "subscription.cancelled", payload });
  });

  it("calls both named and wildcard handlers for the same event", async () => {
    const handler = vi.fn();
    const wildcard = vi.fn();
    const on: BirrJSEventHandlers = {
      "subscription.expired": handler,
      "*": wildcard,
    };
    const payload: BirrJSEventMap["subscription.expired"] = {
      customerId: "c1",
      subscriptionId: "s1",
      planId: "p1",
      planName: "Pro",
      customerEmail: null,
      expiredAt: new Date(),
    };
    await runEventHandlers(on, "subscription.expired", payload, mockLogger);
    expect(handler).toHaveBeenCalledWith(payload);
    expect(wildcard).toHaveBeenCalledWith({ name: "subscription.expired", payload });
  });

  it("catches and logs handler errors (fail-open)", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler failed"));
    const on: BirrJSEventHandlers = { "subscription.activated": handler };
    const payload: BirrJSEventMap["subscription.activated"] = {
      customerId: "c1",
      subscriptionId: "s1",
      planId: "p1",
      planName: "Pro",
      customerEmail: null,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };
    await expect(
      runEventHandlers(on, "subscription.activated", payload, mockLogger),
    ).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), eventName: "subscription.activated" }),
      "Event handler error",
    );
  });

  it("named handler error does not affect wildcard handler", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("fail"));
    const wildcard = vi.fn();
    const on: BirrJSEventHandlers = {
      "subscription.activated": handler,
      "*": wildcard,
    };
    const payload: BirrJSEventMap["subscription.activated"] = {
      customerId: "c1",
      subscriptionId: "s1",
      planId: "p1",
      planName: "Pro",
      customerEmail: null,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };
    await runEventHandlers(on, "subscription.activated", payload, mockLogger);
    expect(wildcard).toHaveBeenCalled();
  });

  it("does not call unrelated handlers", async () => {
    const activated = vi.fn();
    const expired = vi.fn();
    const on: BirrJSEventHandlers = {
      "subscription.activated": activated,
      "subscription.expired": expired,
    };
    const payload: BirrJSEventMap["subscription.cancelled"] = {
      customerId: "c1",
      subscriptionId: "s1",
      planId: "p1",
      planName: "Pro",
      customerEmail: null,
      canceledAt: null,
      endedAt: null,
    };
    await runEventHandlers(on, "subscription.cancelled", payload, mockLogger);
    expect(activated).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
  });
});

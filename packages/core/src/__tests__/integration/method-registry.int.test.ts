import { describe, it, expect, vi } from "vitest";

import { methods, getApi, wrapMethods } from "../../server";
import { createTestContext } from "../helpers/create-test-context";

describe("getApi", () => {
  it("returns a function for each method that delegates to the original", async () => {
    const api = getApi(async () => createTestContext());

    const names = Object.keys(methods);
    for (const name of names) {
      expect(api).toHaveProperty(name);
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("wrapped method calls the original method with context and input", async () => {
    const mockMethod = vi.fn().mockResolvedValue("result");
    const mockMethods = { testMethod: mockMethod } as unknown as Record<string, unknown>;
    const ctx = createTestContext();

    const api = wrapMethods(mockMethods, Promise.resolve(ctx)) as unknown as {
      testMethod: (input: unknown) => Promise<unknown>;
    };
    const result = await api.testMethod("input");

    expect(mockMethod).toHaveBeenCalledWith(ctx, "input");
    expect(result).toBe("result");
  });
});

describe("client: true metadata", () => {
  const clientMethods = [
    "subscribe",
    "listSubscriptions",
    "cancelSubscription",
    "getSubscription",
    "listPlans",
    "checkEntitlement",
    "reportEntitlement",
  ];

  for (const name of clientMethods) {
    it(`${name} is a client method`, () => {
      expect((methods as Record<string, unknown>)[name]).toHaveProperty("client", true);
    });
  }

  const allMethods = Object.keys(methods as Record<string, unknown>);
  const serverMethods = allMethods.filter((n) => !clientMethods.includes(n));

  for (const name of serverMethods) {
    it(`${name} is a server-only method`, () => {
      expect((methods as Record<string, unknown>)[name]).not.toHaveProperty("client", true);
    });
  }
});

describe("route path metadata", () => {
  const cases: Record<string, string> = {
    subscribe: "/subscribe",
    listSubscriptions: "/list-subscriptions",
    cancelSubscription: "/cancel-subscription",
    getSubscription: "/get-subscription",
    listPlans: "/list-plans",
    checkEntitlement: "/check-entitlement",
    reportEntitlement: "/report-entitlement",
    handleWebhook: "/handle-webhook",
    checkPendingSubscriptions: "/check-pending-subscriptions",
    checkExpiredSubscriptions: "/check-expired-subscriptions",
    checkSubscription: "/check-subscription",
    getCustomerWithDetails: "/get-customer-with-details",
    deleteCustomer: "/delete-customer",
  };

  for (const [name, expectedPath] of Object.entries(cases)) {
    it(`${name} maps to ${expectedPath}`, () => {
      expect((methods as Record<string, unknown>)[name]).toHaveProperty(
        "endpoint.path",
        expectedPath,
      );
    });
  }
});

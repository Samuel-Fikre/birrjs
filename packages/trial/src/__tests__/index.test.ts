import type { BeforeSubscribeHookCtx } from "@birrjs/core";
import { describe, it, expect } from "vitest";

import { trial } from "../index";

function createMockQueries(existingRedemptions: number) {
  return {
    getCustomer: async () => null,
    getSubscription: async () => null,
    countRedemptions: async () => existingRedemptions,
  } satisfies BeforeSubscribeHookCtx["queries"];
}

const baseCtx = {
  customerId: "cust_001",
  plan: {
    id: "pro",
    name: "Pro",
    trialDays: 14,
    group: "tier",
    isDefault: false,
    priceAmount: 1500,
    priceInterval: "monthly" as const,
    currency: "ETB",
    hash: "abc123",
    includes: [],
    resetOnTrialConversion: false,
  },
  customerEmail: "test@example.com",
} satisfies Omit<BeforeSubscribeHookCtx, "queries">;

function makeCtx(overrides: Partial<BeforeSubscribeHookCtx> = {}): BeforeSubscribeHookCtx {
  return {
    ...baseCtx,
    queries: createMockQueries(0),
    ...overrides,
  };
}

describe("trial plugin", () => {
  it("returns isTrialEligible when plan has trialDays and no redemptions", async () => {
    const plugin = trial();
    const result = await plugin.onBeforeSubscribe!(makeCtx({ queries: createMockQueries(0) }));
    expect(result).toEqual({ isTrialEligible: true });
  });

  it("returns void when plan has no trialDays", async () => {
    const plugin = trial();
    const result = await plugin.onBeforeSubscribe!(
      makeCtx({ plan: { ...baseCtx.plan, trialDays: null } }),
    );
    expect(result).toBeUndefined();
  });

  it("returns void when customer already used maxTrialsPerCustomer", async () => {
    const plugin = trial({ maxTrialsPerCustomer: 1 });
    const result = await plugin.onBeforeSubscribe!(makeCtx({ queries: createMockQueries(1) }));
    expect(result).toBeUndefined();
  });

  it("respects custom maxTrialsPerCustomer", async () => {
    const plugin = trial({ maxTrialsPerCustomer: 3 });
    const result = await plugin.onBeforeSubscribe!(makeCtx({ queries: createMockQueries(2) }));
    expect(result).toEqual({ isTrialEligible: true });
  });

  it("does not exceed custom maxTrialsPerCustomer", async () => {
    const plugin = trial({ maxTrialsPerCustomer: 3 });
    const result = await plugin.onBeforeSubscribe!(makeCtx({ queries: createMockQueries(3) }));
    expect(result).toBeUndefined();
  });

  it("defaults maxTrialsPerCustomer to 1", async () => {
    const plugin = trial();
    const result = await plugin.onBeforeSubscribe!(makeCtx({ queries: createMockQueries(1) }));
    expect(result).toBeUndefined();
  });
});

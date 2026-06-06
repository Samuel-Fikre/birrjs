import { describe, it, expect } from "vitest";

import type { BirrJSPlan } from "../../plans";
import { normalizePlan, computePlanHash } from "../../plans/schema";
import type { FeatureInclude } from "../../plans/schema";

function makePlan(
  overrides: Partial<{
    id: string;
    name: string;
    group: string;
    default: boolean;
    price: { amount: number; interval: string; currency?: string };
    includes: FeatureInclude[];
  }> = {},
): BirrJSPlan {
  return {
    id: "test_plan",
    name: "Test Plan",
    group: "base",
    default: false,
    includes: [],
    ...overrides,
  } as BirrJSPlan;
}

function makeMeteredFeature(
  featureId: string,
  limit: number,
  reset: "day" | "week" | "month" | "year" = "month",
): FeatureInclude {
  return {
    config: { limit, reset },
    feature: { id: featureId, type: "metered" },
  } as FeatureInclude;
}

function makeBooleanFeature(featureId: string): FeatureInclude {
  return {
    config: undefined,
    feature: { id: featureId, type: "boolean" },
  } as FeatureInclude;
}

describe("normalizePlan", () => {
  it("converts a BirrJSPlan to a NormalizedPlan with default currency", () => {
    const result = normalizePlan(makePlan({ price: { amount: 1000, interval: "monthly" } }), "ETB");

    expect(result).toEqual(
      expect.objectContaining({
        priceAmount: 100000,
        priceInterval: "monthly",
        currency: "ETB",
      }),
    );
  });

  it("normalizes price with explicit currency", () => {
    const result = normalizePlan(
      makePlan({ price: { amount: 500, interval: "monthly", currency: "USD" } }),
      "ETB",
    );

    expect(result.currency).toBe("USD");
  });

  it("defaults priceAmount to null when no price", () => {
    const result = normalizePlan(makePlan(), "ETB");
    expect(result.priceAmount).toBeNull();
  });

  it("sorts features by id", () => {
    const plan = makePlan({
      includes: [
        makeMeteredFeature("z_last", 10),
        makeMeteredFeature("a_first", 20),
        makeMeteredFeature("m_middle", 15),
      ],
    });

    const result = normalizePlan(plan, "ETB");

    const ids = result.includes.map((f) => f.id);
    expect(ids).toEqual(["a_first", "m_middle", "z_last"]);
  });

  it("sets isDefault from plan.default", () => {
    const defaultPlan = normalizePlan(makePlan({ default: true }), "ETB");
    expect(defaultPlan.isDefault).toBe(true);

    const normalPlan = normalizePlan(makePlan({ default: false }), "ETB");
    expect(normalPlan.isDefault).toBe(false);
  });

  it("defaults isDefault to false when plan.default is not set", () => {
    const result = normalizePlan(
      { id: "test", name: "Test", group: "base", includes: [] } as BirrJSPlan,
      "ETB",
    );
    expect(result.isDefault).toBe(false);
  });
});

describe("computePlanHash", () => {
  it("produces the same hash for identical plans", () => {
    const a = normalizePlan(makePlan({ price: { amount: 1000, interval: "monthly" } }), "ETB");
    const b = normalizePlan(makePlan({ price: { amount: 1000, interval: "monthly" } }), "ETB");

    expect(computePlanHash(a)).toBe(computePlanHash(b));
  });

  it("changes when price changes", () => {
    const free = normalizePlan(makePlan(), "ETB");
    const paid = normalizePlan(makePlan({ price: { amount: 1000, interval: "monthly" } }), "ETB");

    expect(computePlanHash(free)).not.toBe(computePlanHash(paid));
  });

  it("changes when features change", () => {
    const basic = normalizePlan(
      makePlan({ includes: [makeMeteredFeature("messages", 100)] }),
      "ETB",
    );
    const pro = normalizePlan(makePlan({ includes: [makeMeteredFeature("messages", 500)] }), "ETB");

    expect(computePlanHash(basic)).not.toBe(computePlanHash(pro));
  });

  it("is stable when features are reordered (sorted by normalizePlan)", () => {
    const planA = normalizePlan(
      makePlan({
        includes: [makeBooleanFeature("feature_b"), makeMeteredFeature("feature_a", 100)],
      }),
      "ETB",
    );
    const planB = normalizePlan(
      makePlan({
        includes: [makeMeteredFeature("feature_a", 100), makeBooleanFeature("feature_b")],
      }),
      "ETB",
    );

    expect(computePlanHash(planA)).toBe(computePlanHash(planB));
  });
});

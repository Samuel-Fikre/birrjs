import { describe, expect, it } from "vitest";

import { BirrJSError } from "../../core/error-codes";
import type { PlanInterval } from "../../types";
import { quotePlanChange, type PlanSnapshot, type SubscriptionAnchor } from "../plan-change";

const day = 24 * 60 * 60 * 1000;

function snapshot(input: {
  internalId: string;
  priceAmount: number;
  interval?: PlanInterval;
  hash?: string;
  currency?: string;
}): PlanSnapshot {
  return {
    internalId: input.internalId,
    planId: input.internalId,
    name: input.internalId,
    hash: input.hash ?? `hash-${input.internalId}`,
    priceAmount: input.priceAmount,
    interval: input.interval ?? "monthly",
    currency: input.currency ?? "ETB",
  };
}

function anchor(overrides: Partial<SubscriptionAnchor> = {}): SubscriptionAnchor {
  return {
    id: "sub_1",
    status: "active",
    planInternalId: "pro",
    planId: "pro",
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    expiresAt: new Date("2026-03-31T00:00:00.000Z"),
    ...overrides,
  };
}

const pro = snapshot({ internalId: "pro", priceAmount: 29000 });
const enterprise = snapshot({ internalId: "enterprise", priceAmount: 90000 });
const atDayTen = new Date("2026-03-11T00:00:00.000Z");

function expectErrorCode(run: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown, `expected a ${code} error`).toBeInstanceOf(BirrJSError);
  expect((thrown as BirrJSError).code).toBe(code);
}

describe("quotePlanChange", () => {
  it("prices an in-period upgrade against the time that is left", () => {
    const quote = quotePlanChange({
      subscription: anchor(),
      fromPlan: pro,
      toPlan: enterprise,
      now: atDayTen,
    });

    expect(quote).toMatchObject({
      direction: "upgrade",
      strategy: "keep_anchor",
      dueNowAmount: 40666,
      creditAmount: 0,
      requiresPayment: true,
    });
    expect(quote.cycleEndAt).toEqual(new Date("2026-03-31T00:00:00.000Z"));
  });

  it("produces no charge and banks the surplus when downgrading", () => {
    const quote = quotePlanChange({
      subscription: anchor({ planInternalId: "enterprise", planId: "enterprise" }),
      fromPlan: enterprise,
      toPlan: pro,
      now: atDayTen,
    });

    expect(quote.direction).toBe("downgrade");
    expect(quote.dueNowAmount).toBe(0);
    expect(quote.requiresPayment).toBe(false);
    // ceil of 61000 * 2/3 — the mirror of the debit case, which floors the same value.
    expect(quote.bankedCreditAmount).toBe(40667);
  });

  it("labels direction by cost per day, not by headline price", () => {
    const yearly = snapshot({
      internalId: "pro_yearly",
      priceAmount: 300000,
      interval: "yearly",
    });

    const quote = quotePlanChange({
      subscription: anchor(),
      fromPlan: pro,
      toPlan: yearly,
      now: atDayTen,
      nextPeriodEndAt: new Date("2027-03-11T00:00:00.000Z"),
    });

    // 3,000.00/year is cheaper per day than 290.00/month even though the ticket is bigger.
    expect(quote.direction).toBe("downgrade");
    expect(quote.strategy).toBe("rebase");
  });

  it("rebases without credit when the subscription has no stored anchor", () => {
    const quote = quotePlanChange({
      subscription: anchor({ periodStartAt: null }),
      fromPlan: pro,
      toPlan: enterprise,
      now: atDayTen,
      nextPeriodEndAt: new Date(atDayTen.getTime() + 30 * day),
    });

    expect(quote.strategy).toBe("rebase");
    expect(quote.creditAmount).toBe(0);
    expect(quote.dueNowAmount).toBe(90000);
  });

  it("suppresses a charge that is below the provider minimum", () => {
    const quote = quotePlanChange({
      subscription: anchor({ expiresAt: new Date("2026-03-30T00:00:00.000Z") }),
      fromPlan: pro,
      toPlan: snapshot({ internalId: "pro_plus", priceAmount: 29200 }),
      now: new Date("2026-03-29T00:00:00.000Z"),
      minimumChargeAmount: 100,
    });

    // A 200-cent difference across the last day of a 29-day period is 6 cents.
    expect(quote).toMatchObject({ dueNowAmount: 0, deferredAmount: 6, requiresPayment: false });
  });

  it.each(["canceled", "failed"])("refuses a change from a %s subscription", (status) => {
    expectErrorCode(
      () =>
        quotePlanChange({
          subscription: anchor({ status }),
          fromPlan: pro,
          toPlan: enterprise,
          now: atDayTen,
        }),
      "PLAN_CHANGE_NOT_ALLOWED",
    );
  });

  it("refuses a change that lands on the same plan version", () => {
    expectErrorCode(
      () =>
        quotePlanChange({
          subscription: anchor(),
          fromPlan: pro,
          toPlan: snapshot({ internalId: "pro", priceAmount: 29000 }),
          now: atDayTen,
        }),
      "PLAN_CHANGE_SAME_PLAN",
    );
  });

  it("refuses to convert between currencies", () => {
    expectErrorCode(
      () =>
        quotePlanChange({
          subscription: anchor(),
          fromPlan: pro,
          toPlan: snapshot({ internalId: "usd", priceAmount: 90000, currency: "USD" }),
          now: atDayTen,
        }),
      "PLAN_CURRENCY_MISMATCH",
    );
  });

  it("refuses a pending subscription, whose first charge is not yet priced", () => {
    expectErrorCode(
      () =>
        quotePlanChange({
          subscription: anchor({ status: "pending", periodStartAt: null, expiresAt: null }),
          fromPlan: pro,
          toPlan: enterprise,
          now: atDayTen,
        }),
      "PLAN_CHANGE_NOT_ALLOWED",
    );
  });

  it("invalidates the quote when either plan changes shape", () => {
    const before = quotePlanChange({
      subscription: anchor(),
      fromPlan: pro,
      toPlan: enterprise,
      now: atDayTen,
    });

    const after = quotePlanChange({
      subscription: anchor(),
      fromPlan: pro,
      toPlan: snapshot({ internalId: "enterprise", priceAmount: 90000, hash: "republished" }),
      now: atDayTen,
    });

    expect(before.quoteHash).toBe(
      quotePlanChange({
        subscription: anchor(),
        fromPlan: pro,
        toPlan: enterprise,
        now: atDayTen,
      }).quoteHash,
    );
    expect(after.quoteHash).not.toBe(before.quoteHash);
  });

  it("throws BirrJSError rather than a plain Error", () => {
    expect(() =>
      quotePlanChange({
        subscription: anchor({ status: "canceled" }),
        fromPlan: pro,
        toPlan: enterprise,
        now: atDayTen,
      }),
    ).toThrow(BirrJSError);
  });
});

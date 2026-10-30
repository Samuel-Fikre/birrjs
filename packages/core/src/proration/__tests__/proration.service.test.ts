import { describe, expect, it } from "vitest";

import { calculateProration, getRemainingRatio } from "../proration.service";

const day = 24 * 60 * 60 * 1000;

const monthlyStart = new Date("2026-03-01T00:00:00.000Z");
// A 30-day period keeps every expectation below exact instead of approximate.
const monthlyEnd = new Date("2026-03-31T00:00:00.000Z");

function base(input: Partial<Parameters<typeof calculateProration>[0]>) {
  return calculateProration({
    now: monthlyStart,
    currentPeriodStartAt: monthlyStart,
    currentPeriodEndAt: monthlyEnd,
    currentAmountMinor: 29000,
    currentInterval: "monthly",
    nextAmountMinor: 90000,
    nextInterval: "monthly",
    ...input,
  });
}

describe("getRemainingRatio", () => {
  it("returns the untouched period for a moment before the period starts", () => {
    expect(getRemainingRatio(new Date("2026-02-15"), monthlyStart, monthlyEnd)).toBe(1);
  });

  it("returns nothing for a period that already ended", () => {
    expect(getRemainingRatio(new Date("2026-04-01T00:00:00.000Z"), monthlyStart, monthlyEnd)).toBe(
      0,
    );
  });

  it("returns nothing for a zero-length period", () => {
    expect(getRemainingRatio(monthlyStart, monthlyStart, monthlyStart)).toBe(0);
  });

  it("is measured in elapsed time rather than calendar days", () => {
    const midpoint = new Date(monthlyStart.getTime() + 15 * day);
    expect(getRemainingRatio(midpoint, monthlyStart, monthlyEnd)).toBeCloseTo(0.5, 5);
  });
});

describe("calculateProration — keep_anchor", () => {
  const atDayTen = new Date(monthlyStart.getTime() + 10 * day);

  it("bills the remaining difference when upgrading inside a period", () => {
    const result = base({ now: atDayTen });

    expect(result.strategy).toBe("keep_anchor");
    // 30-day period, 20 days left: (90000 - 29000) * 2/3 = 40666.66…
    expect(result.dueNowMinor).toBe(40666);
    expect(result.bankedCreditMinor).toBe(0);
    expect(result.cycleStartAt).toEqual(monthlyStart);
    expect(result.cycleEndAt).toEqual(monthlyEnd);
    expect(result.lines).toEqual([{ kind: "plan_difference_prorated", amountMinor: 40666 }]);
  });

  it("rounds a charge down so the sub-cent residual is never taken twice", () => {
    const result = base({ now: new Date(monthlyStart.getTime() + 7 * day) });

    expect(result.dueNowMinor).toBe(Math.floor(61000 * (23 / 30)));
  });

  it("credits the unused difference upward when downgrading inside a period", () => {
    const result = base({ now: atDayTen, nextAmountMinor: 10000 });

    expect(result.dueNowMinor).toBe(0);
    // (29000 - 10000) * 2/3 = 12666.66…
    expect(result.bankedCreditMinor).toBe(12667);
    expect(result.lines).toEqual([{ kind: "plan_difference_prorated", amountMinor: -12667 }]);
  });

  it("charges nothing when the price is identical", () => {
    const result = base({ now: atDayTen, nextAmountMinor: 29000 });

    expect(result).toMatchObject({ dueNowMinor: 0, bankedCreditMinor: 0, debitMinor: 0 });
    expect(result.lines).toHaveLength(0);
  });

  it("never charges for time that is already consumed", () => {
    const late = base({ now: new Date(monthlyEnd.getTime() - 1000) });
    const early = base({ now: new Date(monthlyStart.getTime() + 1000) });

    expect(late.dueNowMinor).toBe(0);
    expect(early.dueNowMinor).toBe(60999);
    expect(late.dueNowMinor).toBeLessThan(early.dueNowMinor);
  });

  it("falls back to rebasing when the current period was never paid for", () => {
    const result = base({ currentAmountMinor: 0, nextPeriodEndAt: monthlyEnd });

    expect(result.strategy).toBe("rebase");
    expect(result.creditMinor).toBe(0);
    expect(result.dueNowMinor).toBe(90000);
  });
});

describe("calculateProration — rebase", () => {
  const atDayTen = new Date(monthlyStart.getTime() + 10 * day);
  const nextYearEnd = new Date("2027-03-10T00:00:00.000Z");

  it("charges a full new period and credits the unused old one when the interval changes", () => {
    const result = base({
      now: atDayTen,
      nextInterval: "yearly",
      nextAmountMinor: 900000,
      nextPeriodEndAt: nextYearEnd,
    });

    expect(result).toMatchObject({
      strategy: "rebase",
      intervalChanged: true,
      debitMinor: 900000,
      creditMinor: 19334,
      dueNowMinor: 880666,
      bankedCreditMinor: 0,
    });
    expect(result.cycleStartAt).toEqual(atDayTen);
    expect(result.cycleEndAt).toEqual(nextYearEnd);
    expect(result.lines).toEqual([
      { kind: "new_period_charged", amountMinor: 900000 },
      { kind: "unused_period_credited", amountMinor: -19334 },
    ]);
  });

  it("banks the surplus instead of issuing a negative charge when credit wins", () => {
    const result = base({
      now: atDayTen,
      nextInterval: "yearly",
      nextAmountMinor: 1,
      nextPeriodEndAt: nextYearEnd,
    });

    expect(result.dueNowMinor).toBe(0);
    expect(result.bankedCreditMinor).toBe(19333);
  });

  it("drops the cycle anchor when moving to a free plan", () => {
    const result = base({ now: atDayTen, nextAmountMinor: 0, nextInterval: "yearly" });

    expect(result.cycleEndAt).toBeNull();
    expect(result.dueNowMinor).toBe(0);
    expect(result.bankedCreditMinor).toBe(19334);
  });
});

describe("calculateProration — minimum charge", () => {
  it("defers a charge that is too small to send to a provider", () => {
    const nearPeriodEnd = new Date(monthlyEnd.getTime() - day);
    const result = base({ now: nearPeriodEnd, nextAmountMinor: 29100, minimumChargeMinor: 100 });

    // 100 cents of difference across the last day of a 30-day period.
    expect(result).toMatchObject({ dueNowMinor: 0, deferredMinor: 3 });
  });

  it("keeps the charge once it clears the threshold", () => {
    const nearPeriodEnd = new Date(monthlyEnd.getTime() - day);
    const result = base({ now: nearPeriodEnd, nextAmountMinor: 32500, minimumChargeMinor: 100 });

    expect(result).toMatchObject({ dueNowMinor: 116, deferredMinor: 0 });
  });
});

describe("calculateProration — invariants", () => {
  const cases = [
    { now: monthlyStart, nextAmountMinor: 90000 },
    { now: new Date(monthlyStart.getTime() + 10 * day), nextAmountMinor: 90000 },
    { now: new Date(monthlyStart.getTime() + 10 * day), nextAmountMinor: 10000 },
    { now: new Date(monthlyStart.getTime() + 10 * day), nextAmountMinor: 0 },
    { now: new Date(monthlyStart.getTime() + 15 * day), nextAmountMinor: 900000 },
  ];

  it.each(cases)("conserves value: debit - credit === dueNow - banked", (input) => {
    const result = base({ ...input, nextPeriodEndAt: new Date("2027-03-10") });

    expect(result.dueNowMinor - result.bankedCreditMinor).toBe(
      result.debitMinor - result.creditMinor,
    );
  });

  it.each(cases)("stays in integer minor units", (input) => {
    const result = base({ ...input, nextPeriodEndAt: new Date("2027-03-10") });

    for (const line of result.lines) {
      expect(Number.isInteger(line.amountMinor)).toBe(true);
    }
  });

  it("handles a leap February period without producing a fractional credit", () => {
    const febStart = new Date("2028-02-01T00:00:00.000Z");
    const febEnd = new Date("2028-03-01T00:00:00.000Z");
    const result = base({
      currentPeriodStartAt: febStart,
      currentPeriodEndAt: febEnd,
      now: new Date("2028-02-29T00:00:00.000Z"),
      // A 29-day period with a 29-cent difference divides exactly.
      nextAmountMinor: 29029,
    });

    expect(result.dueNowMinor).toBe(1);
  });
});

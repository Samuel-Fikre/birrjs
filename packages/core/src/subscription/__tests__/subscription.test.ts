import { describe, it, expect } from "vitest";

import type { SubscriptionStatus } from "../../types";
import type { PlanInterval } from "../../types";
import {
  calculateExpiresAt,
  canTransitionStatus,
  transitionStatus,
  createSubscription,
  renewSubscription,
  cancelSubscription,
} from "../index";

describe("calculateExpiresAt", () => {
  it("throws for invalid interval", () => {
    const start = new Date();
    expect(() => calculateExpiresAt(start, "invalid" as PlanInterval)).toThrow("Invalid interval");
  });
});

describe("canTransitionStatus", () => {
  const cases: [SubscriptionStatus, SubscriptionStatus, boolean][] = [
    ["active", "expired", true],
    ["active", "canceled", true],
    ["active", "pending", false],
    ["active", "active", false],
    ["expired", "active", true],
    ["expired", "canceled", false],
    ["canceled", "active", false],
    ["canceled", "expired", false],
    ["canceled", "canceled", false],
    ["pending", "active", true],
    ["pending", "canceled", true],
    ["pending", "expired", true],
    ["pending", "pending", false],
  ];

  it.each(cases)("from %s to %s returns %s", (from, to, expected) => {
    expect(canTransitionStatus(from, to)).toBe(expected);
  });
});

describe("transitionStatus", () => {
  it("returns new status for valid transition", () => {
    expect(transitionStatus("active", "canceled")).toBe("canceled");
  });

  it("throws for invalid transition", () => {
    expect(() => transitionStatus("canceled", "active")).toThrow("Invalid status transition");
  });
});

describe("createSubscription", () => {
  it("creates a subscription with pending status", () => {
    const result = createSubscription({
      id: "sub_123",
      customerId: "cust_123",
      planId: "plan_123",
      interval: "monthly",
    });

    expect(result.status).toBe("pending");
    expect(result.startedAt).toBeNull();
    expect(result.expiresAt).toBeNull();
  });
});

describe("renewSubscription", () => {
  const NOW = new Date("2026-01-15T00:00:00Z");

  it("renews his monthly plan 3 days before expiry — new expiry shifts from Feb 15 to Mar 15", () => {
    const expiresFeb15 = new Date("2026-02-15T00:00:00Z");
    const result = renewSubscription({
      currentExpiresAt: expiresFeb15,
      interval: "monthly",
      _now: NOW,
    });
    const expected = new Date("2026-03-15T00:00:00Z");
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("renews a day late — new expiry counts from today, not the past date", () => {
    const expiredYesterday = new Date("2026-01-14T00:00:00Z");
    const result = renewSubscription({
      currentExpiresAt: expiredYesterday,
      interval: "daily",
      _now: NOW,
    });
    const expected = new Date("2026-01-16T00:00:00Z");
    expect(result.getTime()).toBe(expected.getTime());
  });
});

describe("cancelSubscription", () => {
  it("cancels at period end — keeps access until current expiry", () => {
    const periodEnd = new Date("2026-02-15T00:00:00Z");
    const result = cancelSubscription({
      currentStatus: "active",
      currentPeriodEndAt: periodEnd,
    });

    expect(result.status).toBe("active");
    expect(result.canceledAt).toBeInstanceOf(Date);
    expect(result.endedAt).toBe(periodEnd);
  });

  it("throws when canceling from invalid status", () => {
    expect(() =>
      cancelSubscription({
        currentStatus: "canceled",
        currentPeriodEndAt: null,
      }),
    ).toThrow("Cannot cancel subscription with status: canceled");
  });
});

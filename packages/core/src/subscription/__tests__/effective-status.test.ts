import { describe, it, expect } from "vitest";

import type { Subscription } from "../../types/models";
import { getEffectiveStatus } from "../effective-status";
import type { GetEffectiveStatusOptions } from "../effective-status";

const NOW = 1_700_000_000_000;

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_123",
    status: "active",
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    expiresAt: null,
    canceledAt: null,
    endedAt: null,
    startedAt: null,
    customerId: "cust_123",
    planId: "plan_123",
    metadata: null,
    deletedAt: null,
    ...overrides,
  } as Subscription;
}

const ACTIVE_OPTS: GetEffectiveStatusOptions = { _now: NOW };

describe("getEffectiveStatus", () => {
  it("returns stored status when active and not expired", () => {
    const sub = makeSub({
      status: "active",
      expiresAt: new Date(NOW + 86_400_000),
    });
    expect(getEffectiveStatus(sub, ACTIVE_OPTS)).toBe("active");
  });

  it("returns stored status when pending and within timeout", () => {
    const sub = makeSub({
      status: "pending",
    });
    expect(getEffectiveStatus(sub, ACTIVE_OPTS)).toBe("pending");
  });

  it("returns failed when pending longer than 60 min", () => {
    const sub = makeSub({
      status: "pending",
      createdAt: new Date(NOW - 61 * 60 * 1000),
    });
    expect(getEffectiveStatus(sub, ACTIVE_OPTS)).toBe("failed");
  });

  it("returns failed when pending longer than custom timeout", () => {
    const sub = makeSub({
      status: "pending",
      createdAt: new Date(NOW - 11 * 60 * 1000),
    });
    expect(getEffectiveStatus(sub, { ...ACTIVE_OPTS, pendingTimeoutMinutes: 10 })).toBe("failed");
  });

  it("returns expired when active and past expiresAt", () => {
    const sub = makeSub({
      status: "active",
      expiresAt: new Date(NOW - 1000),
    });
    expect(getEffectiveStatus(sub, ACTIVE_OPTS)).toBe("expired");
  });

  it("returns active when active and exactly at expiresAt boundary", () => {
    const sub = makeSub({
      status: "active",
      expiresAt: new Date(NOW + 1),
    });
    expect(getEffectiveStatus(sub, ACTIVE_OPTS)).toBe("active");
  });

  it("returns canceled for canceled status", () => {
    const sub = makeSub({ status: "canceled" as const });
    expect(getEffectiveStatus(sub, ACTIVE_OPTS)).toBe("canceled");
  });

  it("returns failed when pending exactly at the timeout boundary (<=)", () => {
    const sub = makeSub({
      status: "pending",
      createdAt: new Date(NOW - 60 * 60 * 1000),
    });
    expect(getEffectiveStatus(sub, ACTIVE_OPTS)).toBe("failed");
  });
});

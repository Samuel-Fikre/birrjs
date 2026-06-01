import { describe, it, expect } from "vitest";

import { addResetInterval, aggregateBalance } from "../entitlement.service";
import type { ActiveEntitlementRow } from "../entitlement.types";

function row(overrides: Partial<ActiveEntitlementRow> = {}): ActiveEntitlementRow {
  return {
    id: "ent_1",
    balance: 100,
    nextResetAt: null,
    originalLimit: 100,
    resetInterval: null,
    ...overrides,
  };
}

describe("addResetInterval", () => {
  it("clamps to last day of month for month interval overflow", () => {
    const date = new Date("2026-01-31T00:00:00Z");
    const result = addResetInterval(date, "month");
    expect(result.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});

describe("aggregateBalance", () => {
  it("returns null for empty rows", () => {
    expect(aggregateBalance([])).toBeNull();
  });

  it("returns unlimited when any row has null originalLimit", () => {
    const rows = [row({ originalLimit: null })];
    const result = aggregateBalance(rows);
    expect(result!.unlimited).toBe(true);
  });

  it("sums remaining and limit across stacked rows", () => {
    const rows = [
      row({ id: "ent_1", balance: 50, originalLimit: 50 }),
      row({ id: "ent_2", balance: 50, originalLimit: 50 }),
    ];
    const result = aggregateBalance(rows);
    expect(result!.remaining).toBe(100);
    expect(result!.limit).toBe(100);
    expect(result!.unlimited).toBe(false);
  });
});

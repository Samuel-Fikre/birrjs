import { describe, expect, it, vi } from "vitest";

import { createMockDb } from "../../__tests__/helpers/create-mock-db";
import type { BirrJSInternalLogger } from "../../core/logger";
import { invoice, subscription, subscriptionPlanChange } from "../../database/schema";
import { quotePlanChange, type PlanChangeQuote, type PlanSnapshot } from "../plan-change";
import {
  activatePlanChangeByTxRef,
  applyScheduledChangeAtRenewal,
  failPlanChangeByTxRef,
  settlePlanChange,
} from "../plan-change-activation";

const cycleStart = new Date("2026-03-01T00:00:00.000Z");
const cycleEnd = new Date("2026-03-31T00:00:00.000Z");
const paidAt = new Date("2026-03-11T00:00:00.000Z");

const pro: PlanSnapshot = {
  internalId: "pro_int_1",
  planId: "pro",
  name: "Pro",
  hash: "hash-pro",
  priceAmount: 29000,
  interval: "monthly",
  currency: "ETB",
};

const enterprise: PlanSnapshot = {
  internalId: "ent_int_1",
  planId: "enterprise",
  name: "Enterprise",
  hash: "hash-ent",
  priceAmount: 90000,
  interval: "monthly",
  currency: "ETB",
};

function planRow(plan: PlanSnapshot): Record<string, unknown> {
  return {
    internalId: plan.internalId,
    planId: plan.planId,
    name: plan.name,
    hash: plan.hash,
    priceAmount: plan.priceAmount,
    priceInterval: plan.interval,
    currency: plan.currency,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_1",
    customerId: "cus_1",
    planId: "pro_int_1",
    status: "active",
    interval: "monthly",
    periodStartAt: cycleStart,
    expiresAt: cycleEnd,
    pendingChangeId: "pch_1",
    lastPaymentAt: cycleStart,
    ...overrides,
  };
}

function upgradeQuote(): PlanChangeQuote {
  return quotePlanChange({
    subscription: {
      id: "sub_1",
      status: "active",
      planInternalId: pro.internalId,
      planId: pro.planId,
      periodStartAt: cycleStart,
      expiresAt: cycleEnd,
    },
    fromPlan: pro,
    toPlan: enterprise,
    now: paidAt,
  });
}

function changeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const q = upgradeQuote();
  return {
    id: "pch_1",
    subscriptionId: "sub_1",
    customerId: "cus_1",
    fromPlanInternalId: pro.internalId,
    toPlanInternalId: enterprise.internalId,
    direction: q.direction,
    strategy: q.strategy,
    debitAmount: q.debitAmount,
    creditAmount: q.creditAmount,
    dueNowAmount: q.dueNowAmount,
    bankedCreditAmount: q.bankedCreditAmount,
    deferredAmount: q.deferredAmount,
    currency: "ETB",
    cycleStartAt: q.cycleStartAt,
    cycleEndAt: q.cycleEndAt,
    status: "pending",
    providerTxRef: "pch_tx_1",
    quoteHash: q.quoteHash,
    carryOverUsage: true,
    reason: null,
    settledAt: null,
    ...overrides,
  };
}

function logger(): BirrJSInternalLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as BirrJSInternalLogger;
}

/**
 * Queue for a settle: the change lookup, then the four reads `settle` fans out
 * (locked subscription, target plan, both feature sets), then nothing left.
 */
function settleQueue(change: Record<string, unknown> | null) {
  return [
    change ? [change] : [],
    [subscriptionRow()],
    [planRow(enterprise)],
    [{ featureId: "seats", limit: 10, resetInterval: "month" }],
    [{ featureId: "seats", limit: 50, resetInterval: "month" }],
    [],
  ];
}

describe("activatePlanChangeByTxRef", () => {
  it("swaps the plan and writes the invoice when the change's own payment lands", async () => {
    const { db, updatesFor, insertsFor } = createMockDb(settleQueue(changeRow()));

    const result = await activatePlanChangeByTxRef(db, logger(), "pch_tx_1", paidAt);

    expect(result).toMatchObject({ handled: true, subscriptionId: "sub_1", changeId: "pch_1" });
    expect(updatesFor(subscription)[0]).toMatchObject({
      planId: enterprise.internalId,
      pendingChangeId: null,
      lastPaymentAt: paidAt,
    });
    expect(insertsFor(invoice)[0]).toMatchObject({ kind: "proration", status: "paid" });
    expect(updatesFor(subscriptionPlanChange)[0]).toMatchObject({ status: "applied" });
  });

  it("keeps the quoted cycle instead of restarting it", async () => {
    const { db, updatesFor } = createMockDb(settleQueue(changeRow()));

    await activatePlanChangeByTxRef(db, logger(), "pch_tx_1", paidAt);

    expect(updatesFor(subscription)[0]).toMatchObject({
      periodStartAt: cycleStart,
      expiresAt: cycleEnd,
    });
  });

  it("hands an unknown txRef back to the caller so the subscription path can run", async () => {
    const { db, updatesFor } = createMockDb([[]]);

    const result = await activatePlanChangeByTxRef(db, logger(), "sub_tx_1", paidAt);

    expect(result).toEqual({ handled: false });
    expect(updatesFor(subscription)).toHaveLength(0);
  });
});

describe("failPlanChangeByTxRef", () => {
  it("voids the change and leaves the subscription byte-identical", async () => {
    const { db, updatesFor, insertsFor, locksFor } = createMockDb([
      [changeRow()], // the change owned by this txRef
    ]);

    const failed = await failPlanChangeByTxRef(db, logger(), "pch_tx_1", paidAt);

    expect(failed).toMatchObject({ id: "pch_1" });
    expect(updatesFor(subscriptionPlanChange)[0]).toMatchObject({ status: "voided" });
    expect(updatesFor(subscription)[0]).toMatchObject({ pendingChangeId: null });
    expect(insertsFor(invoice)).toHaveLength(0);
    // The plan, the cycle and the entitlements are never read, let alone written.
    expect(locksFor(subscription)).toBe(0);
  });

  it("returns null for a txRef that is not an open change", async () => {
    const { db } = createMockDb([[]]);
    expect(await failPlanChangeByTxRef(db, logger(), "pch_tx_gone", paidAt)).toBeNull();
  });
});

describe("settlePlanChange", () => {
  it("voids a payment that lands after the customer cancelled", async () => {
    // The change is handed in, so the queue opens with the row lock.
    const { db, updatesFor, insertsFor } = createMockDb([
      [subscriptionRow({ status: "canceled" })],
      [planRow(enterprise)],
      [],
      [{ featureId: "seats", limit: 50, resetInterval: "month" }],
    ]);

    const settled = await settlePlanChange(db, logger(), changeRow() as never, true, paidAt);

    expect(settled).toBeNull();
    expect(updatesFor(subscriptionPlanChange)[0]).toMatchObject({ status: "voided" });
    expect(updatesFor(subscription)).toEqual([expect.objectContaining({ pendingChangeId: null })]);
    expect(updatesFor(subscription)).not.toContainEqual(
      expect.objectContaining({ planId: enterprise.internalId }),
    );
    expect(insertsFor(invoice)).toHaveLength(0);
  });
});

describe("applyScheduledChangeAtRenewal", () => {
  it("lands a period-end downgrade without raising a second charge", async () => {
    const scheduled = changeRow({
      strategy: "rebase",
      providerTxRef: null,
      dueNowAmount: 0,
      direction: "downgrade",
      toPlanInternalId: pro.internalId,
      fromPlanInternalId: enterprise.internalId,
    });
    const { db, updatesFor, insertsFor } = createMockDb([
      [scheduled],
      [subscriptionRow({ planId: enterprise.internalId })],
      [planRow(pro)],
      [{ featureId: "seats", limit: 50, resetInterval: "month" }],
      [{ featureId: "seats", limit: 10, resetInterval: "month" }],
    ]);

    const applied = await applyScheduledChangeAtRenewal(db, logger(), "sub_1", paidAt);

    expect(applied).toMatchObject({ changeId: "pch_1", toPlanName: "Pro" });
    expect(updatesFor(subscription)[0]).toMatchObject({ planId: pro.internalId });
    expect(insertsFor(invoice)).toHaveLength(0);
    expect(updatesFor(subscriptionPlanChange)[0]).toMatchObject({ status: "applied" });
  });

  it("does nothing when no change is waiting on this renewal", async () => {
    const { db, updatesFor } = createMockDb([[]]);

    expect(await applyScheduledChangeAtRenewal(db, logger(), "sub_1", paidAt)).toBeNull();
    expect(updatesFor(subscription)).toHaveLength(0);
  });
});

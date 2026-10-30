import { describe, expect, it } from "vitest";

import type { QueryResult } from "../../__tests__/helpers/create-mock-db";
import { createMockDb } from "../../__tests__/helpers/create-mock-db";
import { BirrJSError } from "../../core/error-codes";
import { entitlement, invoice, subscription, subscriptionPlanChange } from "../../database/schema";
import type { PlanChangeQuote } from "../plan-change";
import {
  applyPlanChange,
  createPlanChange,
  failPlanChange,
  findPendingChangeByTxRef,
  findScheduledChangeForRenewal,
  loadPlanChangeSummary,
  loadPlanSnapshot,
  lockSubscription,
  markChangeVoided,
  reconcileEntitlements,
  type PlanFeatureRow,
} from "../plan-change.service";

const cycleStart = new Date("2026-03-01T00:00:00.000Z");
const cycleEnd = new Date("2026-03-31T00:00:00.000Z");

function planRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    internalId: "ent_int_1",
    planId: "enterprise",
    name: "Enterprise",
    hash: "hash-ent",
    priceAmount: 90000,
    priceInterval: "monthly",
    currency: "ETB",
    ...overrides,
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
    trialStart: null,
    trialEndsAt: null,
    ...overrides,
  };
}

function quote(overrides: Partial<PlanChangeQuote> = {}): PlanChangeQuote {
  return {
    direction: "upgrade",
    strategy: "keep_anchor",
    cycleStartAt: cycleStart,
    cycleEndAt: cycleEnd,
    debitAmount: 40666,
    creditAmount: 0,
    dueNowAmount: 40666,
    bankedCreditAmount: 0,
    deferredAmount: 0,
    lines: [],
    requiresPayment: true,
    quoteHash: "abc123def456ab12",
    ...overrides,
  };
}

function changeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pch_1",
    subscriptionId: "sub_1",
    customerId: "cus_1",
    fromPlanInternalId: "pro_int_1",
    toPlanInternalId: "ent_int_1",
    direction: "upgrade",
    strategy: "keep_anchor",
    debitAmount: 40666,
    creditAmount: 0,
    dueNowAmount: 40666,
    bankedCreditAmount: 0,
    deferredAmount: 0,
    currency: "ETB",
    cycleStartAt: cycleStart,
    cycleEndAt: cycleEnd,
    status: "pending",
    providerTxRef: "pch_tx_1",
    quoteHash: "abc123def456ab12",
    carryOverUsage: true,
    reason: null,
    settledAt: null,
    ...overrides,
  };
}

function feature(
  featureId: string,
  limit: number | null,
  resetInterval: PlanFeatureRow["resetInterval"] = "month",
): PlanFeatureRow {
  return { featureId, limit, resetInterval };
}

const enterprisePlan = {
  internalId: "ent_int_1",
  planId: "enterprise",
  name: "Enterprise",
  hash: "hash-ent",
  priceAmount: 90000,
  interval: "monthly" as const,
  currency: "ETB",
};

function expectErrorCode(run: () => Promise<unknown>, code: string) {
  return run().then(
    () => expect.unreachable(`expected a ${code} error`),
    (error: unknown) => {
      expect(error).toBeInstanceOf(BirrJSError);
      expect((error as BirrJSError).code).toBe(code);
    },
  );
}

describe("loadPlanSnapshot", () => {
  it("throws PLAN_NOT_FOUND when the version is gone", () => {
    const { db } = createMockDb([[]]);
    return expectErrorCode(() => loadPlanSnapshot(db, "pro_int_1"), "PLAN_NOT_FOUND");
  });

  it("normalises a missing price interval rather than leaving it undefined", async () => {
    const { db } = createMockDb([[planRow({ priceInterval: null })]]);
    expect(await loadPlanSnapshot(db, "ent_int_1")).toMatchObject({ interval: "monthly" });
  });
});

describe("lockSubscription", () => {
  it("takes a row lock so two changes cannot quote the same subscription", async () => {
    const { db, locksFor } = createMockDb([[subscriptionRow()]]);
    await lockSubscription(db, "sub_1", "cus_1");
    expect(locksFor(subscription)).toBe(1);
  });

  it("reports SUBSCRIPTION_NOT_FOUND for a row the customer cannot see", () => {
    const { db } = createMockDb([[]]);
    return expectErrorCode(
      () => lockSubscription(db, "sub_1", "cus_other"),
      "SUBSCRIPTION_NOT_FOUND",
    );
  });
});

describe("createPlanChange", () => {
  it("stores the quoted amounts and points the subscription at the change", async () => {
    const { db, insertsFor, updatesFor } = createMockDb([], {
      insert: [[{ id: "pch_new" }]],
    });

    const changeId = await createPlanChange(db, {
      subscriptionId: "sub_1",
      customerId: "cus_1",
      fromPlanInternalId: "pro_int_1",
      toPlanInternalId: "ent_int_1",
      quote: quote(),
      currency: "ETB",
      carryOverUsage: false,
      providerTxRef: "pch_tx_1",
    });

    expect(changeId).toEqual(expect.stringMatching(/^pch_/));
    expect(insertsFor(subscriptionPlanChange)[0]).toMatchObject({
      id: changeId,
      dueNowAmount: 40666,
      strategy: "keep_anchor",
      status: "pending",
      providerTxRef: "pch_tx_1",
      carryOverUsage: false,
    });
    expect(updatesFor(subscription)).toEqual([
      expect.objectContaining({ pendingChangeId: changeId }),
    ]);
  });

  it("turns a rejected insert into PLAN_CHANGE_IN_PROGRESS and leaves the pointer alone", async () => {
    const { db, updatesFor } = createMockDb([], { insert: [[]] });

    await expectErrorCode(
      () =>
        createPlanChange(db, {
          subscriptionId: "sub_1",
          customerId: "cus_1",
          fromPlanInternalId: "pro_int_1",
          toPlanInternalId: "ent_int_1",
          quote: quote(),
          currency: "ETB",
          carryOverUsage: true,
        }),
      "PLAN_CHANGE_IN_PROGRESS",
    );

    expect(updatesFor(subscription)).toHaveLength(0);
  });
});

describe("findScheduledChangeForRenewal", () => {
  it("skips a change that carries its own payment", async () => {
    const { db } = createMockDb([[changeRow({ providerTxRef: "pch_tx_1" })]]);
    expect(await findScheduledChangeForRenewal(db, "sub_1")).toBeNull();
  });

  it("returns the unpaid change a renewal should land", async () => {
    const { db } = createMockDb([[changeRow({ providerTxRef: null })]]);
    expect(await findScheduledChangeForRenewal(db, "sub_1")).toMatchObject({ id: "pch_1" });
  });
});

describe("findPendingChangeByTxRef", () => {
  it("returns null when the txRef belongs to something else", async () => {
    const { db } = createMockDb([[]]);
    expect(await findPendingChangeByTxRef(db, "sub_tx_1")).toBeNull();
  });
});

describe("applyPlanChange", () => {
  const now = new Date("2026-03-11T00:00:00.000Z");

  interface ApplyCase {
    change?: Record<string, unknown>;
    subscription?: Record<string, unknown>;
    toPlan?: typeof enterprisePlan;
    paidNow?: boolean;
    rows?: QueryResult;
  }

  function apply(caseInput: ApplyCase = {}) {
    const { db, updatesFor, insertsFor } = createMockDb([caseInput.rows ?? []]);
    const result = applyPlanChange({
      tx: db,
      change: changeRow(caseInput.change) as never,
      subscription: subscriptionRow(caseInput.subscription) as never,
      toPlan: caseInput.toPlan ?? enterprisePlan,
      fromFeatures: [feature("seats", 10)],
      toFeatures: [feature("seats", 50)],
      now,
      paidNow: caseInput.paidNow ?? false,
    });

    return { result, updatesFor, insertsFor };
  }

  it("keeps the period the customer already paid for on a keep-anchor change", async () => {
    const { result, updatesFor } = apply();

    expect(await result).toEqual({ cycleStartAt: cycleStart, cycleEndAt: cycleEnd });
    expect(updatesFor(subscription)[0]).toMatchObject({
      planId: "ent_int_1",
      interval: "monthly",
      periodStartAt: cycleStart,
      expiresAt: cycleEnd,
      pendingChangeId: null,
    });
  });

  it("restarts the cycle at settlement time when the change rebases", async () => {
    const { result, updatesFor } = apply({
      change: changeRow({ strategy: "rebase", cycleStartAt: cycleStart, cycleEndAt: null }),
    });

    const settled = await result;
    expect(settled.cycleStartAt).toEqual(now);
    expect(updatesFor(subscription)[0]).toMatchObject({ periodStartAt: now });
    expect(updatesFor(subscription)[0]!.expiresAt as Date).toBeInstanceOf(Date);
  });

  it("moves onto a free plan with no expiry to chase", async () => {
    const { result, updatesFor } = apply({
      change: changeRow({ strategy: "rebase" }),
      toPlan: { ...enterprisePlan, internalId: "free_int_1", priceAmount: 0 },
    });

    const settled = await result;
    expect(settled.cycleEndAt).toBeNull();
    expect(updatesFor(subscription)[0]!.expiresAt).toBeNull();
  });

  it.each(["expired", "trialing"])(
    "moves a %s subscription onto the new plan as active",
    async (status) => {
      const { result, updatesFor } = apply({ subscription: subscriptionRow({ status }) });
      await result;
      expect(updatesFor(subscription)[0]).toMatchObject({ status: "active" });
      expect(updatesFor(subscription)[0]).toMatchObject({ trialStart: null, trialEndsAt: null });
    },
  );

  it("records the proration invoice only when the payment landed", async () => {
    const paid = apply({ paidNow: true });
    await paid.result;
    expect(paid.insertsFor(invoice)[0]).toMatchObject({
      kind: "proration",
      planChangeId: "pch_1",
      amount: 40666,
      status: "paid",
      providerTxRef: "pch_tx_1",
    });

    const belowMinimum = apply({ paidNow: true, change: changeRow({ dueNowAmount: 0 }) });
    await belowMinimum.result;
    expect(belowMinimum.insertsFor(invoice)).toHaveLength(0);

    const scheduled = apply({ paidNow: false });
    await scheduled.result;
    expect(scheduled.insertsFor(invoice)).toHaveLength(0);
  });

  it("marks the change applied with the cycle it actually landed on", async () => {
    const { result, updatesFor } = apply({ paidNow: true });
    await result;
    expect(updatesFor(subscriptionPlanChange)[0]).toMatchObject({
      status: "applied",
      cycleStartAt: cycleStart,
      cycleEndAt: cycleEnd,
    });
    expect(updatesFor(subscriptionPlanChange)[0]!.settledAt as Date).toBeInstanceOf(Date);
  });
});

describe("reconcileEntitlements", () => {
  function reconcile(input: {
    rows: QueryResult;
    fromFeatures: PlanFeatureRow[];
    toFeatures: PlanFeatureRow[];
    carryOverUsage?: boolean;
    now?: Date;
  }) {
    const { db, updatesFor, insertsFor, deletesFor } = createMockDb([input.rows]);
    return reconcileEntitlements({
      tx: db,
      subscriptionId: "sub_1",
      customerId: "cus_1",
      fromFeatures: input.fromFeatures,
      toFeatures: input.toFeatures,
      carryOverUsage: input.carryOverUsage ?? true,
      now: input.now ?? new Date("2026-03-11T00:00:00.000Z"),
    }).then(() => ({ db, updatesFor, insertsFor, deletesFor }));
  }

  it("deletes usage for features the target plan does not sell", async () => {
    const { deletesFor } = await reconcile({
      rows: [{ id: "ent_1", featureId: "legacy_api", limit: 5, balance: 2, nextResetAt: null }],
      fromFeatures: [feature("legacy_api", 5)],
      toFeatures: [],
    });
    expect(deletesFor(entitlement)).toBe(1);
  });

  it("grants a full allowance for a feature the customer has never had", async () => {
    const { insertsFor } = await reconcile({
      rows: [],
      fromFeatures: [],
      toFeatures: [feature("seats", 50)],
    });
    expect(insertsFor(entitlement)[0]).toMatchObject({
      featureId: "seats",
      limit: 50,
      balance: 50,
    });
  });

  it("carries usage across when the plan grows", async () => {
    const { updatesFor } = await reconcile({
      rows: [{ id: "ent_1", featureId: "seats", limit: 10, balance: 3, nextResetAt: null }],
      fromFeatures: [feature("seats", 10)],
      toFeatures: [feature("seats", 50)],
    });
    // 7 seats already used, so 50 - 7 remain.
    expect(updatesFor(entitlement)[0]).toMatchObject({ limit: 50, balance: 43 });
  });

  it("starts the meter fresh when usage does not carry over", async () => {
    const { updatesFor } = await reconcile({
      rows: [{ id: "ent_1", featureId: "seats", limit: 10, balance: 3, nextResetAt: null }],
      fromFeatures: [feature("seats", 10)],
      toFeatures: [feature("seats", 50)],
      carryOverUsage: false,
    });
    expect(updatesFor(entitlement)[0]).toMatchObject({ limit: 50, balance: 50 });
  });

  it("keeps the existing reset date while the cadence is unchanged", async () => {
    const nextReset = new Date("2026-04-01T00:00:00.000Z");
    const now = new Date("2026-03-11T00:00:00.000Z");
    const { updatesFor } = await reconcile({
      rows: [{ id: "ent_1", featureId: "seats", limit: 10, balance: 3, nextResetAt: nextReset }],
      fromFeatures: [feature("seats", 10, "month")],
      toFeatures: [feature("seats", 50, "month")],
      now,
    });
    expect(updatesFor(entitlement)[0]!.nextResetAt).toBe(nextReset);
  });

  it("re-times the meter when the new plan resets on a different cadence", async () => {
    const previous = new Date("2026-04-01T00:00:00.000Z");
    const now = new Date("2026-03-11T00:00:00.000Z");
    const { updatesFor } = await reconcile({
      rows: [{ id: "ent_1", featureId: "seats", limit: 10, balance: 3, nextResetAt: previous }],
      fromFeatures: [feature("seats", 10, "month")],
      toFeatures: [feature("seats", 50, "week")],
      now,
    });
    const reset = updatesFor(entitlement)[0]!.nextResetAt as Date;
    expect(reset).toBeInstanceOf(Date);
    expect(reset.getTime()).toBeLessThan(previous.getTime());
  });

  it("clears the reset date for an unmetered feature", async () => {
    const { updatesFor } = await reconcile({
      rows: [
        {
          id: "ent_1",
          featureId: "seats",
          limit: 10,
          balance: 3,
          nextResetAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      ],
      fromFeatures: [feature("seats", 10)],
      toFeatures: [feature("seats", null, "month")],
    });
    expect(updatesFor(entitlement)[0]).toMatchObject({
      limit: null,
      balance: null,
      nextResetAt: null,
    });
  });
});

describe("voiding and failing a change", () => {
  it("clears the subscription pointer so the customer can try again", async () => {
    const { db, updatesFor } = createMockDb();
    await markChangeVoided(db, "pch_1", "sub_1", new Date());

    expect(updatesFor(subscriptionPlanChange)[0]).toMatchObject({ status: "voided" });
    expect(updatesFor(subscription)[0]).toMatchObject({ pendingChangeId: null });
  });

  it("marks a change that will never be paid as failed", async () => {
    const { db, updatesFor } = createMockDb();
    await failPlanChange(db, "pch_1", "sub_1", new Date());

    expect(updatesFor(subscriptionPlanChange)[0]).toMatchObject({ status: "failed" });
    expect(updatesFor(subscription)[0]).toMatchObject({ pendingChangeId: null });
  });
});

describe("loadPlanChangeSummary", () => {
  it("joins the plan name and customer email for event payloads", async () => {
    const { db } = createMockDb([
      [
        {
          changeId: "pch_1",
          subscriptionId: "sub_1",
          customerId: "cus_1",
          customerEmail: "a@b.c",
          direction: "upgrade",
          fromPlanId: "pro_int_1",
          toPlanId: "ent_int_1",
          toPlanName: "Enterprise",
          amountCharged: 40666,
          creditedAmount: 0,
          cycleStartAt: cycleStart,
          cycleEndAt: cycleEnd,
          reason: null,
        },
      ],
    ]);

    expect(await loadPlanChangeSummary(db, "pch_1")).toMatchObject({
      changeId: "pch_1",
      toPlanName: "Enterprise",
      customerEmail: "a@b.c",
      direction: "upgrade",
    });
  });

  it("returns null rather than throwing when the change is gone", async () => {
    const { db } = createMockDb([[]]);
    expect(await loadPlanChangeSummary(db, "pch_missing")).toBeNull();
  });
});

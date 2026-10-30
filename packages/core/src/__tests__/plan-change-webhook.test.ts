import { describe, expect, it, vi } from "vitest";

import { invoice, subscription, subscriptionPlanChange, webhookEvent } from "../database/schema";
import { settlePlanChangeWebhook } from "../server/webhook/plan-change-webhook";
import type { BirrJSOptions } from "../types";
import { createMockDb, type QueryResult } from "./helpers/create-mock-db";
import { createTestContext } from "./helpers/create-test-context";

const cycleStart = new Date("2026-03-01T00:00:00.000Z");
const cycleEnd = new Date("2026-03-31T00:00:00.000Z");

const openChange: QueryResult = [
  {
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
  },
];

const lockedSubscription: QueryResult = [
  {
    id: "sub_1",
    customerId: "cus_1",
    planId: "pro_int_1",
    status: "active",
    interval: "monthly",
    periodStartAt: cycleStart,
    expiresAt: cycleEnd,
    providerTxRef: "tx_renewal_1",
    pendingChangeId: "pch_1",
  },
];

const enterprisePlan: QueryResult = [
  {
    internalId: "ent_int_1",
    planId: "enterprise",
    name: "Enterprise",
    hash: "hash-ent",
    priceAmount: 90000,
    priceInterval: "monthly",
    currency: "ETB",
  },
];

const eventSummary: QueryResult = [
  {
    changeId: "pch_1",
    subscriptionId: "sub_1",
    customerId: "cus_1",
    customerEmail: "sam@example.com",
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
];

const seats = (limit: number): QueryResult => [
  { featureId: "seats", limit, resetInterval: "month" },
];

/** Every page a settled upgrade reads, in the order the code asks for it. */
const upgradePages: QueryResult[] = [
  openChange,
  lockedSubscription,
  enterprisePlan,
  seats(10),
  seats(50),
  [], // existing entitlement rows
  eventSummary,
];

function setup(onEvent = vi.fn()) {
  const mock = createMockDb(upgradePages);
  const ctx = createTestContext({
    database: mock.db,
    options: {
      database: mock.db,
      provider: { callbackUrl: "https://cb.example" },
      planChanges: { enabled: true },
      on: {
        "subscription.plan_changed": onEvent,
        "subscription.plan_change_failed": onEvent,
      },
    } as unknown as BirrJSOptions,
  });
  return { ctx, mock, onEvent };
}

describe("settlePlanChangeWebhook", () => {
  it("applies the change the payment was raised for and closes the event row", async () => {
    const { ctx, mock, onEvent } = setup();

    const message = await settlePlanChangeWebhook(ctx, "pch_tx_1", "charge.success", "wh_1");

    expect(message).toBe("Plan change applied");
    expect(mock.updatesFor(subscription)[0]).toMatchObject({
      planId: "ent_int_1",
      pendingChangeId: null,
    });
    expect(mock.updatesFor(subscription)[0]!.lastPaymentAt).toBeInstanceOf(Date);
    expect(mock.updatesFor(subscriptionPlanChange)).toEqual([
      expect.objectContaining({ status: "applied" }),
    ]);
    expect(mock.insertsFor(invoice)).toEqual([expect.objectContaining({ kind: "proration" })]);
    expect(mock.updatesFor(webhookEvent)).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ toPlanName: "Enterprise" }));
  });

  it("never writes the change's reference onto the subscription", async () => {
    const { ctx, mock } = setup();

    await settlePlanChangeWebhook(ctx, "pch_tx_1", "charge.success", "wh_1");

    // Repointing provider_tx_ref would hijack the next renewal and, because
    // activation returns early for an already-active plan, leave the customer
    // paying for Enterprise while still using Pro.
    expect(mock.updatesFor(subscription)).not.toContainEqual(
      expect.objectContaining({ providerTxRef: expect.anything() }),
    );
  });

  it("hands a subscription txRef back so renewal still runs", async () => {
    const mock = createMockDb([[]]); // no change owns this reference
    const ctx = createTestContext({ database: mock.db });

    expect(await settlePlanChangeWebhook(ctx, "tx_renewal_1", "charge.success", "wh_1")).toBeNull();
    expect(mock.updatesFor(subscription)).toHaveLength(0);
  });

  it("treats a webhook that repeats after settlement as someone else's problem", async () => {
    // The `status = pending` filter is what makes a retried delivery harmless:
    // once applied, the lookup comes back empty and no second charge is booked.
    const mock = createMockDb([[]]);
    const ctx = createTestContext({ database: mock.db });

    await settlePlanChangeWebhook(ctx, "pch_tx_1", "charge.success", "wh_2");

    expect(mock.insertsFor(invoice)).toHaveLength(0);
    expect(mock.updatesFor(subscriptionPlanChange)).toHaveLength(0);
  });

  it("voids the change when the charge fails and leaves the plan alone", async () => {
    const { ctx, mock, onEvent } = setup();

    const message = await settlePlanChangeWebhook(
      ctx,
      "pch_tx_1",
      "charge.failed/cancelled",
      "wh_1",
    );

    expect(message).toBe("Plan change voided");
    expect(mock.updatesFor(subscriptionPlanChange)).toEqual([
      expect.objectContaining({ status: "voided" }),
    ]);
    expect(mock.updatesFor(subscription)).toEqual([
      expect.objectContaining({ pendingChangeId: null }),
    ]);
    expect(mock.insertsFor(invoice)).toHaveLength(0);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "charge.failed/cancelled" }),
    );
  });

  it("keeps the change open on a pending event and marks the row ignored", async () => {
    const mock = createMockDb([openChange]);
    await settlePlanChangeWebhook(
      createTestContext({ database: mock.db }),
      "pch_tx_1",
      "charge.pending",
      "wh_1",
    );

    expect(mock.updatesFor(webhookEvent)).toEqual([expect.objectContaining({ status: "ignored" })]);
    expect(mock.updatesFor(subscriptionPlanChange)).toHaveLength(0);
  });

  it("announces nothing when the settled change cannot be read back", async () => {
    const onEvent = vi.fn();
    const mock = createMockDb([
      openChange,
      lockedSubscription,
      enterprisePlan,
      seats(10),
      seats(50),
      [],
    ]);
    const ctx = createTestContext({
      database: mock.db,
      options: {
        database: mock.db,
        provider: {},
        on: { "subscription.plan_changed": onEvent },
      } as unknown as BirrJSOptions,
    });

    const message = await settlePlanChangeWebhook(ctx, "pch_tx_1", "charge.success", "wh_1");

    expect(message).toBe("Plan change applied");
    expect(onEvent).not.toHaveBeenCalled();
  });
});

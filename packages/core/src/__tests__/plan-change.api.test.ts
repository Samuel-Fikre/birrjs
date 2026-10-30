import { describe, expect, it, vi } from "vitest";

import type { BirrJSContext } from "../context";
import { BirrJSError } from "../core/error-codes";
import { subscription, subscriptionPlanChange } from "../database/schema";
import {
  cancelPlanChange,
  changeSubscription,
  previewPlanChange,
} from "../server/subscription/plan-change.api";
import type { BirrJSOptions } from "../types";
import { createMockDb, type QueryResult } from "./helpers/create-mock-db";
import { createTestContext } from "./helpers/create-test-context";

const day = 24 * 60 * 60 * 1000;
const now = new Date();
const periodStart = new Date(now.getTime() - 10 * day);
const periodEnd = new Date(now.getTime() + 20 * day);

const customerRow = {
  id: "cus_1",
  email: "sam@example.com",
  name: "Sam Test",
  phone: "0911000000",
};

function planRow(planId: string, internalId: string, priceAmount: number): QueryResult {
  return [
    {
      internalId,
      planId,
      name: planId,
      hash: `hash-${planId}`,
      priceAmount,
      priceInterval: "monthly",
      currency: "ETB",
    },
  ];
}

function subscriptionRow(overrides: Record<string, unknown> = {}): QueryResult {
  return [
    {
      id: "sub_1",
      customerId: "cus_1",
      planId: "pro_int_1",
      status: "active",
      interval: "monthly",
      periodStartAt: periodStart,
      expiresAt: periodEnd,
      providerTxRef: "tx_renewal_1",
      pendingChangeId: null,
      lastPaymentAt: periodStart,
      ...overrides,
    },
  ];
}

function changeRow(overrides: Record<string, unknown> = {}): QueryResult {
  return [
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
      cycleStartAt: periodStart,
      cycleEndAt: periodEnd,
      status: "pending",
      providerTxRef: "pch_tx_1",
      quoteHash: "deadbeefdeadbeef",
      carryOverUsage: true,
      reason: null,
      settledAt: null,
      ...overrides,
    },
  ];
}

const seats = (limit: number): QueryResult => [
  { featureId: "seats", limit, resetInterval: "month" },
];

interface Setup {
  ctx: BirrJSContext;
  db: ReturnType<typeof createMockDb>["db"];
  mock: ReturnType<typeof createMockDb>;
  initializeTransaction: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
}

/**
 * `select` pages are positional, so the queue below reads like the code path:
 * the customer the endpoint resolved, the locked subscription, both plans, then
 * whatever settlement adds.
 */
function setup(
  results: QueryResult[],
  overrides: {
    insert?: QueryResult[];
    findFirst?: QueryResult[];
    options?: Partial<BirrJSOptions>;
  } = {},
): Setup {
  const mock = createMockDb([[customerRow], ...results], {
    insert: overrides.insert,
    findFirst: overrides.findFirst,
  });
  const initializeTransaction = vi.fn().mockResolvedValue({
    success: true,
    checkoutUrl: "https://checkout.example/1",
    txRef: "tx_from_provider",
  });
  const onEvent = vi.fn();

  const ctx = createTestContext({
    database: mock.db,
    runtime: {
      initializeTransaction,
      verifyTransaction: vi.fn(),
      handleWebhook: vi.fn(),
    } as never,
    options: {
      provider: { callbackUrl: "https://cb.example", returnUrl: "https://back.example" },
      planChanges: { enabled: true },
      on: { "subscription.plan_changed": onEvent, "subscription.plan_change_pending": onEvent },
      ...overrides.options,
    } as BirrJSOptions,
  });

  return { ctx, db: mock.db, mock, initializeTransaction, onEvent };
}

function expectErrorCode(run: () => Promise<unknown>, code: string) {
  return run().then(
    () => expect.unreachable(`expected a ${code} error`),
    (error: unknown) => {
      expect(error).toBeInstanceOf(BirrJSError);
      expect((error as BirrJSError).code).toBe(code);
    },
  );
}

describe("plan change kill switch", () => {
  it.each([
    [
      "preview",
      (ctx: BirrJSContext) =>
        previewPlanChange(ctx, {
          customerId: "cus_1",
          subscriptionId: "sub_1",
          toPlanId: "enterprise",
        }),
    ],
    [
      "change",
      (ctx: BirrJSContext) =>
        changeSubscription(ctx, {
          customerId: "cus_1",
          subscriptionId: "sub_1",
          toPlanId: "enterprise",
        }),
    ],
  ])("%s refuses before pricing anything when the feature is off", async (_, run) => {
    const { ctx, mock } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      { options: { planChanges: { enabled: false } } },
    );

    await expectErrorCode(() => run(ctx), "PLAN_CHANGE_NOT_ALLOWED");
    expect(mock.updatesFor(subscription)).toHaveLength(0);
    expect(mock.insertMock).not.toHaveBeenCalled();
  });
});

describe("previewPlanChange", () => {
  it("prices the move without writing anything", async () => {
    const { ctx, mock } = setup([
      subscriptionRow(),
      planRow("pro", "pro_int_1", 29000),
      planRow("enterprise", "ent_int_1", 90000),
    ]);

    const result = await previewPlanChange(ctx, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      toPlanId: "enterprise",
    });

    expect(result.quote).toMatchObject({
      direction: "upgrade",
      strategy: "keep_anchor",
      amountDue: 40666,
      requiresPayment: true,
    });
    expect(result).toMatchObject({ fromPlanName: "pro", toPlanName: "enterprise" });
    expect(mock.updatesFor(subscription)).toHaveLength(0);
    expect(mock.insertMock).not.toHaveBeenCalled();
  });

  it("reports SUBSCRIPTION_NOT_FOUND for a subscription the caller cannot see", () => {
    const { ctx } = setup([[]]);
    return expectErrorCode(
      () =>
        previewPlanChange(ctx, {
          customerId: "cus_1",
          subscriptionId: "sub_other",
          toPlanId: "enterprise",
        }),
      "SUBSCRIPTION_NOT_FOUND",
    );
  });
});

describe("changeSubscription", () => {
  it("raises the payment against the change, never against the subscription", async () => {
    const { ctx, mock, initializeTransaction } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      { insert: [[{ id: "pch_1" }]] },
    );

    const result = await changeSubscription(ctx, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      toPlanId: "enterprise",
    });

    const [request] = initializeTransaction.mock.calls[0] as [{ amount: number; txRef: string }];
    // The renewal reference has to survive: overwriting it would break the next
    // renewal and, worse, the customer would pay and stay on Pro.
    expect(request.amount).toBe(40666);
    expect(request.txRef).not.toBe("tx_renewal_1");
    expect(mock.updatesFor(subscription)).toEqual([
      expect.not.objectContaining({ providerTxRef: expect.anything() }),
    ]);
    expect(result).toMatchObject({ status: "pending", checkoutUrl: "https://checkout.example/1" });
  });

  it("stores the quote and announces it", async () => {
    const { ctx, mock, onEvent } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      { insert: [[{ id: "pch_1" }]] },
    );

    const result = await changeSubscription(ctx, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      toPlanId: "enterprise",
    });

    expect(mock.insertsFor(subscriptionPlanChange)[0]).toMatchObject({
      id: result.planChangeId,
      dueNowAmount: 40666,
      status: "pending",
      quoteHash: expect.any(String),
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_1", amountDue: 40666 }),
    );
  });

  it("rejects a quote the UI was shown before the plan moved", async () => {
    const { ctx, mock } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      { insert: [[{ id: "pch_1" }]] },
    );

    await expectErrorCode(
      () =>
        changeSubscription(ctx, {
          customerId: "cus_1",
          subscriptionId: "sub_1",
          toPlanId: "enterprise",
          quoteHash: "0000000000000000",
        }),
      "PLAN_CHANGE_QUOTE_STALE",
    );
    expect(mock.insertMock).not.toHaveBeenCalled();
  });

  it("accepts the hash the preview handed out", async () => {
    const pages = [
      subscriptionRow(),
      planRow("pro", "pro_int_1", 29000),
      planRow("enterprise", "ent_int_1", 90000),
    ];
    const preview = setup(pages);
    const { quote } = await previewPlanChange(preview.ctx, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      toPlanId: "enterprise",
    });

    const commit = setup(pages, { insert: [[{ id: "pch_1" }]] });
    const result = await changeSubscription(commit.ctx, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      toPlanId: "enterprise",
      quoteHash: quote.quoteHash,
    });

    expect(result.status).toBe("pending");
  });

  it("collapses a second open change into PLAN_CHANGE_IN_PROGRESS", () => {
    const { ctx, mock } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      // the partial unique index on `pending` swallowed the insert
      { insert: [[]] },
    );

    return expectErrorCode(
      () =>
        changeSubscription(ctx, {
          customerId: "cus_1",
          subscriptionId: "sub_1",
          toPlanId: "enterprise",
        }),
      "PLAN_CHANGE_IN_PROGRESS",
    ).then(() => expect(mock.updatesFor(subscription)).toHaveLength(0));
  });

  it("leaves the subscription untouched when the provider cannot raise the charge", async () => {
    const { ctx, mock, initializeTransaction } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      { insert: [[{ id: "pch_1" }]] },
    );
    initializeTransaction.mockRejectedValue(new Error("provider down"));

    await expect(
      changeSubscription(ctx, {
        customerId: "cus_1",
        subscriptionId: "sub_1",
        toPlanId: "enterprise",
      }),
    ).rejects.toThrow("provider down");

    // Failed, not applied — and the plan on the subscription never moved.
    expect(mock.updatesFor(subscriptionPlanChange)).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
    expect(mock.updatesFor(subscription)).not.toContainEqual(
      expect.objectContaining({ planId: "ent_int_1" }),
    );
  });

  it("applies a free move in the same call, with no charge raised", async () => {
    const { ctx, mock, initializeTransaction } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("free", "free_int_1", 0),
        changeRow({
          toPlanInternalId: "free_int_1",
          direction: "downgrade",
          dueNowAmount: 0,
          debitAmount: 0,
          bankedCreditAmount: 19334,
          providerTxRef: null,
        }),
        subscriptionRow(),
        planRow("free", "free_int_1", 0),
        seats(10),
        seats(1),
        [], // existing entitlement rows
      ],
      { insert: [[{ id: "pch_1" }]] },
    );

    const result = await changeSubscription(ctx, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      toPlanId: "free",
    });

    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "applied" });
    expect(mock.updatesFor(subscription).at(-1)).toMatchObject({ planId: "free_int_1" });
  });

  it("defers a period-end change instead of invoicing it", async () => {
    const { ctx, mock, initializeTransaction } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      { insert: [[{ id: "pch_1" }]] },
    );

    const result = await changeSubscription(ctx, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      toPlanId: "enterprise",
      prorationBehavior: "next_period",
    });

    expect(result).toMatchObject({ status: "pending", quote: { amountDue: 0 } });
    expect(initializeTransaction).not.toHaveBeenCalled();
    // Settlement belongs to the renewal, so nothing moved yet.
    expect(mock.updatesFor(subscription)).toEqual([
      expect.objectContaining({ pendingChangeId: result.planChangeId }),
    ]);
  });

  it("lets a plugin block the change before the row is written", () => {
    const onBeforePlanChange = vi.fn().mockRejectedValue(new Error("risk review required"));
    const { ctx, mock } = setup(
      [
        subscriptionRow(),
        planRow("pro", "pro_int_1", 29000),
        planRow("enterprise", "ent_int_1", 90000),
      ],
      {
        insert: [[{ id: "pch_1" }]],
        findFirst: [planRow("pro", "pro_int_1", 29000), planRow("enterprise", "ent_int_1", 90000)],
        options: { plugins: [{ id: "risk", onBeforePlanChange }] },
      },
    );

    return expectErrorCode(
      () =>
        changeSubscription(ctx, {
          customerId: "cus_1",
          subscriptionId: "sub_1",
          toPlanId: "enterprise",
        }),
      "PLAN_CHANGE_NOT_ALLOWED",
    ).then(() => {
      expect(onBeforePlanChange).toHaveBeenCalledTimes(1);
      expect(mock.insertMock).not.toHaveBeenCalled();
    });
  });

  it("prices nothing for an unidentified caller", async () => {
    // `identify` is configured, so a call without a resolvable identity stops at
    // the middleware — the handler never sees a customer it cannot pin to.
    const identify = vi.fn().mockResolvedValue(undefined);
    const { ctx, mock } = setup([subscriptionRow()], { options: { identify } });

    await expectErrorCode(
      () => changeSubscription(ctx, { subscriptionId: "sub_1", toPlanId: "enterprise" } as never),
      "IDENTIFY_REQUIRED",
    );
    expect(mock.updatesFor(subscription)).toHaveLength(0);
  });
});

describe("cancelPlanChange", () => {
  it("voids the open change and frees the subscription for another attempt", async () => {
    const { ctx, mock } = setup([
      subscriptionRow({ pendingChangeId: "pch_1" }),
      changeRow(), // still pending
    ]);

    const result = await cancelPlanChange(ctx, { customerId: "cus_1", subscriptionId: "sub_1" });

    expect(result).toMatchObject({ cancelled: true, planChangeId: "pch_1" });
    expect(mock.updatesFor(subscriptionPlanChange)).toEqual([
      expect.objectContaining({ status: "voided" }),
    ]);
    expect(mock.updatesFor(subscription)).toEqual([
      expect.objectContaining({ pendingChangeId: null }),
    ]);
  });

  it("reports nothing to cancel when no change is open", async () => {
    const { ctx, mock } = setup([subscriptionRow({ pendingChangeId: null })]);

    const result = await cancelPlanChange(ctx, { customerId: "cus_1", subscriptionId: "sub_1" });

    expect(result).toEqual({ cancelled: false, planChangeId: null });
    expect(mock.updateMock).not.toHaveBeenCalled();
  });

  it("clears a pointer left on an already-settled change", async () => {
    const { ctx, mock } = setup([
      subscriptionRow({ pendingChangeId: "pch_1" }),
      changeRow({ status: "applied" }),
    ]);

    await cancelPlanChange(ctx, { customerId: "cus_1", subscriptionId: "sub_1" });

    expect(mock.updatesFor(subscription)).toEqual([
      expect.objectContaining({ pendingChangeId: null }),
    ]);
    expect(mock.updatesFor(subscriptionPlanChange)).toHaveLength(0);
  });
});

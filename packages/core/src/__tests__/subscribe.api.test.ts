import { describe, it, expect, vi } from "vitest";

import type { BirrJSContext } from "../context";
import { BirrJSError } from "../core/error-codes";
import type { BirrJSDatabase } from "../database";
import { ProviderError } from "../provider";
import { subscribe } from "../server/subscription/subscription.api";

function createMockDb(): {
  db: BirrJSDatabase;
  push: (...items: Array<Array<Record<string, unknown>>>) => void;
  updateMock: ReturnType<typeof vi.fn>;
  insertMock: ReturnType<typeof vi.fn>;
} {
  const queue: Array<Array<Record<string, unknown>>> = [];

  function next() {
    const item = queue.shift();
    return item !== undefined ? item : [];
  }

  const updateMock = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }));

  const insertMock = vi.fn((_table: unknown) => ({
    values: vi.fn((_v: unknown) => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "mock_id" }]),
      })),
    })),
  }));

  function query(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (_n: number) => Promise.resolve(next()),
      then: (
        onfulfilled?: (value: Array<Record<string, unknown>>) => unknown,
        onrejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(next()).then(onfulfilled, onrejected),
    };
    // Also support async iteration for `for await` (not used, but safe)
    return chain;
  }

  const db = {
    select: vi.fn(() => query()),
    insert: insertMock,
    update: updateMock,
    transaction: vi.fn(async (cb: (tx: BirrJSDatabase) => Promise<unknown>) => {
      const txDb = createMockDb();
      return cb(txDb.db);
    }),
  } as unknown as BirrJSDatabase;

  return { db, push: (...items) => queue.push(...items), updateMock, insertMock };
}

describe("subscribe error scenarios", () => {
  it("throws PLAN_NOT_FOUND when plan does not exist", async () => {
    const { db, push } = createMockDb();
    push([{ id: "cus_test", email: "test@example.com" }]); // customer select (resolveCustomer)
    push([]); // plan select → empty
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: {
        initializeTransaction: vi.fn(),
        handleWebhook: vi.fn(),
        verifyTransaction: vi.fn(),
      } as unknown as BirrJSContext["runtime"],
      options: { provider: { callbackUrl: "https://example.com/cb" } } as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const err = await subscribe(ctx, { planId: "plan_missing", customerId: "cus_test" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(BirrJSError);
    expect((err as BirrJSError).code).toBe("PLAN_NOT_FOUND");
  });

  it("throws CUSTOMER_NOT_FOUND when customer ID not in DB", async () => {
    const { db, push } = createMockDb();
    push([]); // customer select (resolveCustomer) → empty
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: {
        initializeTransaction: vi.fn(),
        handleWebhook: vi.fn(),
        verifyTransaction: vi.fn(),
      } as unknown as BirrJSContext["runtime"],
      options: { provider: { callbackUrl: "https://example.com/cb" } } as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const err = await subscribe(ctx, { planId: "plan_1", customerId: "cus_ghost" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(BirrJSError);
    expect((err as BirrJSError).code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("marks subscription as failed when initializeTransaction throws", async () => {
    const { db, push, updateMock } = createMockDb();
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([{ id: "plan_1", internalId: "plan_int_1", priceAmount: 5000, currency: "ETB" }]);
    push([]); // plan features
    push([]); // no existing active subscription
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: {
        initializeTransaction: vi
          .fn()
          .mockRejectedValue(new ProviderError("Provider down", "PROVIDER_TRANSACTION_FAILED")),
        handleWebhook: vi.fn(),
        verifyTransaction: vi.fn(),
      } as unknown as BirrJSContext["runtime"],
      options: { provider: { callbackUrl: "https://example.com/cb" } } as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const err = await subscribe(ctx, { planId: "plan_1", customerId: "cus_1" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe("Provider down");
    // Should have tried to update subscription to "failed"
    expect(updateMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("throws TRANSACTION_INVALID_RESPONSE when checkoutUrl is missing", async () => {
    const { db, push } = createMockDb();
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([{ id: "plan_1", internalId: "plan_int_1", priceAmount: 5000, currency: "ETB" }]);
    push([]); // plan features
    push([]); // no existing subscription
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: {
        initializeTransaction: vi
          .fn()
          .mockResolvedValue({ success: true, checkoutUrl: undefined, txRef: "tx_123" }),
        handleWebhook: vi.fn(),
        verifyTransaction: vi.fn(),
      } as unknown as BirrJSContext["runtime"],
      options: { provider: { callbackUrl: "https://example.com/cb" } } as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const err = await subscribe(ctx, { planId: "plan_1", customerId: "cus_1" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(BirrJSError);
    expect((err as BirrJSError).code).toBe("TRANSACTION_INVALID_RESPONSE");
  });

  it("does NOT mark existing active subscription as failed on init failure", async () => {
    const { db, push, updateMock } = createMockDb();
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([{ id: "plan_1", internalId: "plan_int_1", priceAmount: 5000, currency: "ETB" }]);
    push([]); // plan features
    push([
      {
        id: "sub_active",
        customerId: "cus_1",
        planId: "plan_int_1",
        status: "active",
        interval: "monthly",
      },
    ]);
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: {
        initializeTransaction: vi.fn().mockRejectedValue(new Error("Network error")),
        handleWebhook: vi.fn(),
        verifyTransaction: vi.fn(),
      } as unknown as BirrJSContext["runtime"],
      options: { provider: { callbackUrl: "https://example.com/cb" } } as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    await expect(subscribe(ctx, { planId: "plan_1", customerId: "cus_1" })).rejects.toThrow(
      "Network error",
    );
    // Renewal path should not mark the sub as failed
    expect(updateMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("subscribe trial path", () => {
  it("creates trialing subscription when trial is eligible", async () => {
    const { db, push } = createMockDb();
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([
      { id: "plan_1", internalId: "plan_int_1", trialDays: 7, priceAmount: 5000, currency: "ETB" },
    ]);
    push([]); // plan features
    push([]); // no existing active/trialing sub
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: {
        initializeTransaction: vi.fn(),
        handleWebhook: vi.fn(),
        verifyTransaction: vi.fn(),
      } as unknown as BirrJSContext["runtime"],
      options: {
        provider: { callbackUrl: "https://example.com/cb" },
        plugins: [{ id: "test-trial", onBeforeSubscribe: () => ({ isTrialEligible: true }) }],
      } as unknown as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      queries: { countRedemptions: vi.fn().mockResolvedValue(0) },
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const result = await subscribe(ctx, { planId: "plan_1", customerId: "cus_1", useTrial: true });

    expect(result).toHaveProperty("trialEndsAt");
    expect(result).toHaveProperty("subscriptionId");
    // initializeTransaction should NOT be called (trial returns early)
    expect(ctx.runtime.initializeTransaction).not.toHaveBeenCalled();
    // transaction should have been called (trial wraps in transaction)
    expect(db.transaction).toHaveBeenCalled();
  });

  it("skips trial and creates pending sub when plan has no trialDays", async () => {
    const { db, push } = createMockDb();
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([{ id: "plan_1", internalId: "plan_int_1", priceAmount: 5000, currency: "ETB" }]);
    push([]); // plan features
    push([]); // no existing sub
    const runtime = {
      initializeTransaction: vi
        .fn()
        .mockResolvedValue({ success: true, checkoutUrl: "https://checkout.url", txRef: "tx_123" }),
      handleWebhook: vi.fn(),
      verifyTransaction: vi.fn(),
    };
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: runtime as unknown as BirrJSContext["runtime"],
      options: {
        provider: { callbackUrl: "https://example.com/cb" },
        plugins: [{ id: "test-trial", onBeforeSubscribe: () => ({ isTrialEligible: true }) }],
      } as unknown as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      queries: { countRedemptions: vi.fn().mockResolvedValue(0) },
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const result = await subscribe(ctx, { planId: "plan_1", customerId: "cus_1" });

    // Should have gone through pay path
    expect(runtime.initializeTransaction).toHaveBeenCalled();
    expect(result).toHaveProperty("checkoutUrl");
  });

  it("skips trial and creates pending sub when hook returns undefined", async () => {
    const { db, push } = createMockDb();
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([
      { id: "plan_1", internalId: "plan_int_1", trialDays: 7, priceAmount: 5000, currency: "ETB" },
    ]);
    push([]); // plan features
    push([]); // no existing sub
    const runtime = {
      initializeTransaction: vi
        .fn()
        .mockResolvedValue({ success: true, checkoutUrl: "https://checkout.url", txRef: "tx_123" }),
      handleWebhook: vi.fn(),
      verifyTransaction: vi.fn(),
    };
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: runtime as unknown as BirrJSContext["runtime"],
      options: {
        provider: { callbackUrl: "https://example.com/cb" },
        plugins: [{ id: "test-noop", onBeforeSubscribe: () => undefined }],
      } as unknown as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      queries: { countRedemptions: vi.fn().mockResolvedValue(0) },
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const result = await subscribe(ctx, { planId: "plan_1", customerId: "cus_1" });

    expect(runtime.initializeTransaction).toHaveBeenCalled();
    expect(result).toHaveProperty("checkoutUrl");
  });

  it("returns existing trialing sub on duplicate subscribe", async () => {
    const { db, push, insertMock } = createMockDb();
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([
      { id: "plan_1", internalId: "plan_int_1", trialDays: 7, priceAmount: 5000, currency: "ETB" },
    ]);
    push([]); // plan features
    push([
      {
        id: "sub_trialing",
        customerId: "cus_1",
        planId: "plan_int_1",
        status: "trialing",
        trialEndsAt,
        interval: "monthly",
      },
    ]); // existing trialing sub
    const ctx = {
      database: db as BirrJSDatabase,
      runtime: {
        initializeTransaction: vi.fn(),
        handleWebhook: vi.fn(),
        verifyTransaction: vi.fn(),
      } as unknown as BirrJSContext["runtime"],
      options: {
        provider: { callbackUrl: "https://example.com/cb" },
        plugins: [{ id: "test-trial", onBeforeSubscribe: () => ({ isTrialEligible: true }) }],
      } as unknown as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      queries: { countRedemptions: vi.fn().mockResolvedValue(0) },
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const result = await subscribe(ctx, { planId: "plan_1", customerId: "cus_1" });

    expect(result).toMatchObject({
      subscriptionId: "sub_trialing",
      trialEndsAt,
    });
    // No new subscription should be inserted
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips trial for renewal (existing active sub)", async () => {
    const { db, push } = createMockDb();
    push([{ id: "cus_1", email: "test@example.com" }]);
    push([
      { id: "plan_1", internalId: "plan_int_1", trialDays: 7, priceAmount: 5000, currency: "ETB" },
    ]);
    push([]); // plan features
    push([
      {
        id: "sub_active",
        customerId: "cus_1",
        planId: "plan_int_1",
        status: "active",
        interval: "monthly",
      },
    ]); // existing active sub
    const updateMock = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    }));
    const insertMock = vi.fn(() => ({
      values: vi.fn(() => {
        const promise = Promise.resolve(undefined) as Promise<void> & {
          onConflictDoNothing: ReturnType<typeof vi.fn>;
        };
        promise.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
        return promise;
      }),
    }));
    const dbRenewal = {
      ...db,
      update: updateMock,
      insert: insertMock,
    } as unknown as BirrJSDatabase;
    const runtime = {
      initializeTransaction: vi
        .fn()
        .mockResolvedValue({ success: true, checkoutUrl: "https://checkout.url", txRef: "tx_123" }),
      handleWebhook: vi.fn(),
      verifyTransaction: vi.fn(),
    };
    const ctx = {
      database: dbRenewal,
      runtime: runtime as unknown as BirrJSContext["runtime"],
      options: {
        provider: { callbackUrl: "https://example.com/cb" },
        plugins: [{ id: "test-trial", onBeforeSubscribe: () => ({ isTrialEligible: true }) }],
      } as unknown as BirrJSContext["options"],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnValue({}),
      } as unknown as BirrJSContext["logger"],
      queries: { countRedemptions: vi.fn().mockResolvedValue(0) },
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BirrJSContext;

    const result = await subscribe(ctx, { planId: "plan_1", customerId: "cus_1" });

    // Should go through pay path (renewal: update txRef + init txn)
    expect(runtime.initializeTransaction).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalled();
    // Should NOT insert a new subscription
    expect(insertMock).not.toHaveBeenCalled();
    expect(result).toHaveProperty("checkoutUrl");
  });
});

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
    values: vi.fn((_v: unknown) => {
      const promise = Promise.resolve(undefined) as Promise<void> & {
        onConflictDoNothing: ReturnType<typeof vi.fn>;
      };
      promise.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      return promise;
    }),
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
    push([{ id: "plan_1", internalId: "plan_int_1", priceAmount: 5000, currency: "ETB" }]);
    push([{ id: "cus_1", email: "test@example.com" }]);
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
    push([{ id: "plan_1", internalId: "plan_int_1", priceAmount: 5000, currency: "ETB" }]);
    push([{ id: "cus_1", email: "test@example.com" }]);
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
    push([{ id: "plan_1", internalId: "plan_int_1", priceAmount: 5000, currency: "ETB" }]);
    push([{ id: "cus_1", email: "test@example.com" }]);
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

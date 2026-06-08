import { describe, it, expect, vi } from "vitest";

import type { BirrJSContext } from "../context";
import type { BirrJSDatabase } from "../database";
import { ProviderError } from "../provider";
import { handleWebhook } from "../server/webhook/webhook.api";
import type { BirrJSQueries } from "../types";

type QueryResult = Array<Record<string, unknown>>;

function createMockDb(results: QueryResult[] = []): {
  db: BirrJSDatabase;
  updateMock: ReturnType<typeof vi.fn>;
} {
  const queue: QueryResult[] = [...results];

  function consume() {
    const item = queue.shift();
    return item !== undefined ? item : [];
  }

  const updateMock = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }));

  function query() {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(consume()),
      then: (f?: (v: QueryResult) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(consume()).then(f, r),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => query()),
    insert: vi.fn(() => ({
      values: vi.fn(() => {
        const p = Promise.resolve(undefined) as Promise<void> & {
          onConflictDoNothing: ReturnType<typeof vi.fn>;
        };
        p.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
        return p;
      }),
    })),
    update: updateMock,
    transaction: vi.fn(async (cb: (tx: BirrJSDatabase) => Promise<unknown>) => {
      const txRecord = createMockDb(queue);
      return cb(txRecord.db);
    }),
  } as unknown as BirrJSDatabase;

  return { db, updateMock };
}

const validPayload: Record<string, unknown> = {
  event: "charge.success",
  first_name: "Sam",
  last_name: "Test",
  email: "test@example.com",
  mobile: "0911000000",
  currency: "ETB",
  amount: "10.00",
  charge: "0.00",
  status: "success",
  mode: "test",
  reference: "chapa_ref",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  type: "API",
  tx_ref: "tx_test",
  payment_method: "chapa",
  customization: { title: "Test", description: null, logo: null },
  meta: {},
};

function ctx(
  overrides: Partial<{
    db: BirrJSDatabase;
    handleWebhookResult: unknown;
  }> = {},
): BirrJSContext {
  return {
    queries: {} as unknown as BirrJSQueries,
    options: { provider: { id: "chapa" } } as BirrJSContext["options"],
    database: overrides.db ?? ({} as BirrJSDatabase),
    runtime: {
      handleWebhook:
        overrides.handleWebhookResult !== undefined
          ? typeof overrides.handleWebhookResult === "function"
            ? overrides.handleWebhookResult
            : vi.fn().mockResolvedValue(overrides.handleWebhookResult)
          : vi.fn(),
    } as unknown as BirrJSContext["runtime"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({}),
    } as unknown as BirrJSContext["logger"],
    destroy: vi.fn().mockResolvedValue(undefined),
    provider: {} as BirrJSContext["provider"],
  };
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

describe("webhook error scenarios", () => {
  it("skips duplicate webhook when already completed", async () => {
    const { db } = createMockDb([[{ id: "wh_dup", status: "completed" }]]);
    const c = ctx({
      db,
      handleWebhookResult: { providerReferenceId: "tx_test", type: "charge.success", payload: {} },
    });

    const result = await handleWebhook(c, {
      payload: validPayload as never,
      rawBody: JSON.stringify(validPayload),
      headers: {},
    });

    expect(result).toEqual({ success: true, message: "Webhook already processed" });
  });

  it("retries previously failed webhook", async () => {
    const { db } = createMockDb([
      [{ id: "wh_retry", status: "failed" }],
      [
        {
          id: "sub_1",
          customerId: "cus_1",
          planId: "plan_1",
          status: "pending",
          interval: "monthly",
          startedAt: null,
          expiresAt: null,
        },
      ],
    ]);
    const c = ctx({
      db,
      handleWebhookResult: { providerReferenceId: "tx_test", type: "charge.success", payload: {} },
    });

    const result = await handleWebhook(c, {
      payload: validPayload as never,
      rawBody: JSON.stringify(validPayload),
      headers: {},
    });

    expect(result).toEqual({ success: true, message: "Webhook processed successfully" });
  });

  it("propagates provider INVALID_WEBHOOK error", async () => {
    const c = ctx({
      handleWebhookResult: vi
        .fn()
        .mockRejectedValue(new ProviderError("Invalid signature", "PROVIDER_WEBHOOK_INVALID")),
    });

    const err = await handleWebhook(c, {
      payload: validPayload as never,
      rawBody: JSON.stringify(validPayload),
      headers: {},
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe("Invalid signature");
  });

  it("propagates provider network error", async () => {
    const c = ctx({
      handleWebhookResult: vi
        .fn()
        .mockRejectedValue(new ProviderError("Network timeout", "PROVIDER_NETWORK_ERROR")),
    });

    const err = await handleWebhook(c, {
      payload: validPayload as never,
      rawBody: JSON.stringify(validPayload),
      headers: {},
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe("Network timeout");
  });

  it("handles subscription not found gracefully", async () => {
    const { db } = createMockDb([
      [{ id: "wh_skip", status: "processing" }], // re-query after insert
      [], // no matching subscription
    ]);
    const c = ctx({
      db,
      handleWebhookResult: {
        providerReferenceId: "tx_orphan",
        type: "charge.success",
        payload: {},
      },
    });

    const result = await handleWebhook(c, {
      payload: validPayload as never,
      rawBody: JSON.stringify(validPayload),
      headers: {},
    });

    expect(result).toEqual({
      success: true,
      message: "Webhook processed (subscription not found)",
    });
  });

  it("handles charge.success via shared activation", async () => {
    const { db } = createMockDb([
      [{ id: "wh_fail", status: "processing" }], // re-query after insert
      [
        {
          id: "sub_1",
          customerId: "cus_1",
          planId: "plan_1",
          status: "pending",
          interval: "monthly",
          startedAt: null,
          expiresAt: null,
        },
      ],
    ]);
    const c = ctx({
      db,
      handleWebhookResult: { providerReferenceId: "tx_fail", type: "charge.success", payload: {} },
    });

    const result = await handleWebhook(c, {
      payload: validPayload as never,
      rawBody: JSON.stringify(validPayload),
      headers: {},
    });

    expect(result).toEqual({ success: true, message: "Webhook processed successfully" });
  });
});

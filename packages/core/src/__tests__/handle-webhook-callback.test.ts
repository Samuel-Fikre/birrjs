import { createRouter, type Endpoint } from "better-call";
import { describe, it, expect, vi } from "vitest";

import type { PaymentProvider } from "../provider";
import {
  handleWebhookCallback,
  parseCallbackQuery,
} from "../server/webhook/handle-webhook-callback";
import type { BirrJSOptions } from "../types";
import { createMockDb, type QueryResult } from "./helpers/create-mock-db";
import { createTestContext } from "./helpers/create-test-context";

function url(query: string): URL {
  return new URL(`https://example.com/handle-webhook?${query}`);
}

describe("parseCallbackQuery", () => {
  it("passes through Chapa format (trx_ref + status)", () => {
    const result = parseCallbackQuery(url("trx_ref=tx_123&status=success&ref_id=ref_1"));

    expect(result).toEqual({ trx_ref: "tx_123", ref_id: "ref_1", status: "success" });
  });

  it("maps Telebirr format (merch_order_id + trade_status=PAY_SUCCESS) to success", () => {
    const result = parseCallbackQuery(
      url("merch_order_id=order123&trade_status=PAY_SUCCESS&total_amount=100.00"),
    );

    expect(result.trx_ref).toBe("order123");
    expect(result.status).toBe("success");
  });

  it("maps trade_status=Completed to success", () => {
    const result = parseCallbackQuery(url("merch_order_id=order456&trade_status=Completed"));

    expect(result.trx_ref).toBe("order456");
    expect(result.status).toBe("success");
  });

  it("does not treat PAY_FAILED as success", () => {
    const result = parseCallbackQuery(url("merch_order_id=order789&trade_status=PAY_FAILED"));

    expect(result.trx_ref).toBe("order789");
    expect(result.status).toBe("PAY_FAILED");
  });

  it("returns null trx_ref when no id param is present", () => {
    const result = parseCallbackQuery(url("status=success"));

    expect(result.trx_ref).toBeNull();
  });

  it("prefers trx_ref when both formats are present", () => {
    const result = parseCallbackQuery(url("trx_ref=tx_1&merch_order_id=order1"));

    expect(result.trx_ref).toBe("tx_1");
  });
});

const pendingSub: QueryResult = [
  {
    id: "sub_1",
    customerId: "cus_1",
    planId: "plan_1",
    status: "pending",
    interval: "monthly",
    startedAt: null,
    expiresAt: new Date("2026-10-01T00:00:00Z"),
  },
];

const joinedSubRow: QueryResult = [
  {
    customerId: "cus_1",
    planId: "plan_1",
    startedAt: null,
    expiresAt: new Date("2026-11-01T00:00:00Z"),
    planName: "Pro",
    customerEmail: "a@b.c",
  },
];

async function runCallback(
  query: string,
  opts: {
    results?: QueryResult[];
    verifyResult?: unknown;
    plugins?: BirrJSOptions["plugins"];
    on?: BirrJSOptions["on"];
  } = {},
): Promise<{
  status: number;
  body: unknown;
  verifyTransaction: ReturnType<typeof vi.fn>;
  selectMock: ReturnType<typeof vi.fn>;
  updateMock: ReturnType<typeof vi.fn>;
  setMock: ReturnType<typeof vi.fn>;
  deleteMock: ReturnType<typeof vi.fn>;
  ctx: ReturnType<typeof createTestContext>;
}> {
  const { db, selectMock, updateMock, setMock, deleteMock } = createMockDb(opts.results ?? []);
  const verifyTransaction = vi
    .fn()
    .mockResolvedValue(
      opts.verifyResult !== undefined ? opts.verifyResult : { success: true, status: "success" },
    );
  const ctx = createTestContext({
    database: db,
    runtime: { verifyTransaction } as unknown as PaymentProvider,
    options: {
      provider: { id: "chapa" },
      ...(opts.plugins ? { plugins: opts.plugins } : {}),
      ...(opts.on ? { on: opts.on } : {}),
    } as BirrJSOptions,
  });
  const router = createRouter(
    { callback: handleWebhookCallback.endpoint as unknown as Endpoint },
    { routerContext: ctx },
  );

  const res = await router.handler(new Request(`https://example.com/handle-webhook?${query}`));
  const body = await res.json();

  return {
    status: res.status,
    body,
    verifyTransaction,
    selectMock,
    updateMock,
    setMock,
    deleteMock,
    ctx,
  };
}

describe("handleWebhookCallback handler", () => {
  it("activates subscription on Chapa success callback", async () => {
    const { status, body, verifyTransaction, selectMock, updateMock, setMock, deleteMock } =
      await runCallback("trx_ref=tx_1&status=success&ref_id=ref_1", {
        results: [pendingSub, joinedSubRow],
      });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, message: "Callback processed successfully" });
    expect(verifyTransaction).toHaveBeenCalledWith("tx_1");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it("skips verification and activation when status is not success", async () => {
    const { status, body, verifyTransaction, selectMock, updateMock, deleteMock } =
      await runCallback("trx_ref=tx_1&status=failed");

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, message: "Callback received" });
    expect(verifyTransaction).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("does not activate when provider verification fails", async () => {
    const { status, body, verifyTransaction, selectMock, updateMock, deleteMock } =
      await runCallback("trx_ref=tx_1&status=success", {
        verifyResult: { success: false, status: "failed" },
      });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, message: "Callback processed (verification failed)" });
    expect(verifyTransaction).toHaveBeenCalledWith("tx_1");
    expect(selectMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("does not update an already active subscription", async () => {
    const activeSub: QueryResult = [{ ...pendingSub[0]!, status: "active" }];
    const { status, body, updateMock, deleteMock } = await runCallback(
      "trx_ref=tx_1&status=success",
      {
        results: [activeSub],
      },
    );

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, message: "Callback processed successfully" });
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("activates subscription on Telebirr success callback (trade_status dialect)", async () => {
    const { status, body, verifyTransaction, updateMock } = await runCallback(
      "merch_order_id=order1&trade_status=PAY_SUCCESS",
      { results: [pendingSub, joinedSubRow] },
    );

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, message: "Callback processed successfully" });
    expect(verifyTransaction).toHaveBeenCalledWith("order1");
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("rejects callback when no order id is present", async () => {
    const { status, body, selectMock } = await runCallback("status=success");

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("Missing trx_ref or merch_order_id");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("fires plugin subscription.activated event after activation", async () => {
    const onEvent = vi.fn();
    const { status, ctx } = await runCallback("trx_ref=tx_1&status=success", {
      results: [pendingSub, joinedSubRow],
      plugins: [{ id: "test-plugin", onEvent: { "subscription.activated": onEvent } }],
    });

    expect(status).toBe(200);
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    const [payload, eventCtx] = onEvent.mock.calls[0]!;
    expect(payload).toEqual(
      expect.objectContaining({
        customerId: "cus_1",
        subscriptionId: "sub_1",
        planName: "Pro",
        customerEmail: "a@b.c",
      }),
    );
    expect(eventCtx).toBe(ctx);
  });
});

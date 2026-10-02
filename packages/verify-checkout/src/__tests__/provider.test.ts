import { createHmac } from "node:crypto";

import type { PaymentProviderConfig, TransactionRequest } from "@birrjs/core";
import { describe, it, expect, vi } from "vitest";

import type { VerifyCheckoutClient } from "../client";
import {
  VerifyCheckoutApiError,
  VerifyCheckoutError,
  VERIFY_CHECKOUT_ERROR_CODES,
} from "../errors";
import { verifyCheckout } from "../index";
import { createVerifyCheckoutProvider } from "../provider";
import type { VerifyCheckoutDeposit } from "../types";

const WEBHOOK_SECRET = "whsec_test_secret";
const RETURN_URL = "https://shop.example.com/return";

function createMockClient(overrides: Partial<VerifyCheckoutClient> = {}): VerifyCheckoutClient {
  return {
    createDeposit: vi.fn(),
    getDeposit: vi.fn(),
    listDeposits: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const runtimeOptions = { returnUrl: RETURN_URL, webhookSecret: WEBHOOK_SECRET };

const txReq: TransactionRequest = {
  amount: 25000,
  currency: "ETB",
  email: "test@example.com",
  txRef: "txabc123",
  callbackUrl: "https://shop.example.com/handle-webhook",
};

const createdDeposit: VerifyCheckoutDeposit = {
  id: "dep_abc123",
  merchant_customer_id: "txabc123",
  status: "awaiting_transfer",
  currency: "ETB",
  amount: "250.00",
  checkout_url: "https://checkout.verify.et/c/token",
};

function succeededDeposit(overrides: Partial<VerifyCheckoutDeposit> = {}): VerifyCheckoutDeposit {
  return {
    ...createdDeposit,
    status: "succeeded",
    verification: { verified: true },
    ...overrides,
  };
}

function webhookEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt_1",
    type: "deposit.succeeded",
    api_version: "2026-06-01",
    sequence: 5,
    created_at: "2026-10-01T10:04:12.000Z",
    data: {
      object: {
        id: "dep_abc123",
        merchant_order_id: "vc_order_1",
        merchant_customer_id: "txabc123",
        environment: "live",
        status: "succeeded",
        amount: "250.00",
        currency: "ETB",
        metadata: {},
        created_at: "2026-10-01T10:00:00.000Z",
      },
    },
    ...overrides,
  };
}

function deliver(
  event: Record<string, unknown>,
  secret = WEBHOOK_SECRET,
): {
  rawBody: string;
  headers: Record<string, string>;
} {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return {
    rawBody,
    headers: {
      "VerifyCheckout-Timestamp": timestamp,
      "VerifyCheckout-Signature": `v1=${signature}`,
    },
  };
}

async function catchError<T>(fn: () => Promise<T>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("VerifyCheckoutProvider - initializeTransaction", () => {
  it("creates a hosted deposit and returns checkoutUrl", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockResolvedValue(createdDeposit),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.initializeTransaction(txReq);

    expect(result.success).toBe(true);
    expect(result.checkoutUrl).toBe("https://checkout.verify.et/c/token");
    expect(result.txRef).toBe("txabc123");
    expect(client.createDeposit).toHaveBeenCalledWith(
      {
        merchantCustomerId: "txabc123",
        amount: "250.00",
        currency: "ETB",
        returnUrl: RETURN_URL,
      },
      "txabc123",
    );
  });

  it("prefers request.returnUrl over the runtime fallback", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockResolvedValue(createdDeposit),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    await provider.initializeTransaction({
      ...txReq,
      returnUrl: "https://other.example.com/return",
    });

    expect(client.createDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: "https://other.example.com/return" }),
      "txabc123",
    );
  });

  it("rejects non-ETB currencies before calling the API", async () => {
    const client = createMockClient();
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const error = await catchError(() =>
      provider.initializeTransaction({ ...txReq, currency: "USD" }),
    );

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.INVALID_CONFIG);
    expect(client.createDeposit).not.toHaveBeenCalled();
  });

  it("throws MALFORMED_RESPONSE when checkout_url is missing", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockResolvedValue({ id: "dep_x", status: "created" }),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(
      VERIFY_CHECKOUT_ERROR_CODES.MALFORMED_RESPONSE,
    );
  });

  it("maps API 401 to UNAUTHORIZED", async () => {
    const client = createMockClient({
      createDeposit: vi
        .fn()
        .mockRejectedValue(
          new VerifyCheckoutApiError("bad key", 401, { errorCode: "invalid_api_key" }),
        ),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.UNAUTHORIZED);
  });

  it("maps API 500 to SERVER_ERROR", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockRejectedValue(new VerifyCheckoutApiError("boom", 500)),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.SERVER_ERROR);
  });

  it("maps fetch TypeError to NETWORK_ERROR", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.NETWORK_ERROR);
  });

  it("maps generic errors to INITIALIZATION_FAILED", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockRejectedValue(new Error("something broke")),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(
      VERIFY_CHECKOUT_ERROR_CODES.INITIALIZATION_FAILED,
    );
    expect((error as VerifyCheckoutError).message).toContain("something broke");
  });
});

describe("VerifyCheckoutProvider - verifyTransaction", () => {
  it("re-queries the cached deposit and reports success", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockResolvedValue(createdDeposit),
      getDeposit: vi.fn().mockResolvedValue(succeededDeposit()),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    await provider.initializeTransaction(txReq);

    const result = await provider.verifyTransaction("txabc123");

    expect(client.getDeposit).toHaveBeenCalledWith("dep_abc123");
    expect(client.listDeposits).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      status: "success",
      amount: 25000,
      currency: "ETB",
      txRef: "txabc123",
      providerTxRef: "dep_abc123",
    });
  });

  it("falls back to a list scan when the cache is cold", async () => {
    const client = createMockClient({
      listDeposits: vi.fn().mockResolvedValue([succeededDeposit()]),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("txabc123");

    expect(client.listDeposits).toHaveBeenCalledWith({ limit: 100 });
    expect(client.getDeposit).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
  });

  it("accepts a deposit id (dep_…) directly", async () => {
    const client = createMockClient({
      getDeposit: vi.fn().mockResolvedValue(succeededDeposit()),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("dep_abc123");

    expect(client.getDeposit).toHaveBeenCalledWith("dep_abc123");
    expect(result.success).toBe(true);
    expect(result.providerTxRef).toBe("dep_abc123");
  });

  it("returns failed when nothing matches the reference", async () => {
    const client = createMockClient();
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("txunknown");

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("not found");
  });

  it("returns failed when a dep_ id 404s instead of throwing", async () => {
    const client = createMockClient({
      getDeposit: vi.fn().mockRejectedValue(new VerifyCheckoutApiError("nope", 404)),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("dep_gone");

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("maps terminal failed statuses to failed", async () => {
    const client = createMockClient({
      listDeposits: vi.fn().mockResolvedValue([succeededDeposit({ status: "failed" })]),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("txabc123");

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("failed verification");
  });

  it("maps expired to failed with an expiry message", async () => {
    const client = createMockClient({
      listDeposits: vi.fn().mockResolvedValue([succeededDeposit({ status: "expired" })]),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("txabc123");

    expect(result.success).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("maps review_required to pending (hold, do not fail)", async () => {
    const client = createMockClient({
      listDeposits: vi.fn().mockResolvedValue([succeededDeposit({ status: "review_required" })]),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("txabc123");

    expect(result.success).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.error).toContain("under review");
  });

  it("maps intermediate statuses to pending", async () => {
    const client = createMockClient({
      listDeposits: vi
        .fn()
        .mockResolvedValue([
          succeededDeposit({ status: "awaiting_transfer", verification: undefined }),
        ]),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("txabc123");

    expect(result.success).toBe(false);
    expect(result.status).toBe("pending");
  });

  it("rejects a succeeded deposit whose amount_match is false", async () => {
    const client = createMockClient({
      listDeposits: vi.fn().mockResolvedValue([
        succeededDeposit({
          verification: { verified: true, amount_match: false },
        }),
      ]),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const result = await provider.verifyTransaction("txabc123");

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("amount");
  });

  it("maps getDeposit 500 to SERVER_ERROR", async () => {
    const client = createMockClient({
      createDeposit: vi.fn().mockResolvedValue(createdDeposit),
      getDeposit: vi.fn().mockRejectedValue(new VerifyCheckoutApiError("boom", 500)),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    await provider.initializeTransaction(txReq);

    const error = await catchError(() => provider.verifyTransaction("txabc123"));

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.SERVER_ERROR);
  });
});

describe("VerifyCheckoutProvider - handleWebhook", () => {
  it("verifies the signature, re-queries, and emits charge.success", async () => {
    const client = createMockClient({
      getDeposit: vi.fn().mockResolvedValue(succeededDeposit()),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = webhookEvent();
    const { rawBody, headers } = deliver(event);

    const result = await provider.handleWebhook(event, rawBody, headers);

    expect(result.providerReferenceId).toBe("txabc123");
    expect(result.type).toBe("charge.success");
    expect(client.getDeposit).toHaveBeenCalledWith("dep_abc123");
    expect(result.payload).toMatchObject({ id: "dep_abc123", status: "succeeded" });
  });

  it("rejects an invalid signature without calling the API", async () => {
    const client = createMockClient();
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = webhookEvent();
    const { rawBody, headers } = deliver(event, "whsec_wrong_secret");

    const error = await catchError(() => provider.handleWebhook(event, rawBody, headers));

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.INVALID_WEBHOOK);
    expect(client.getDeposit).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (replay protection)", async () => {
    const client = createMockClient();
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = webhookEvent();
    const { rawBody } = deliver(event);
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const signature = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${staleTimestamp}.${rawBody}`)
      .digest("hex");

    const error = await catchError(() =>
      provider.handleWebhook(event, rawBody, {
        "VerifyCheckout-Timestamp": staleTimestamp,
        "VerifyCheckout-Signature": `v1=${signature}`,
      }),
    );

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.INVALID_WEBHOOK);
    expect(client.getDeposit).not.toHaveBeenCalled();
  });

  it("never trusts the delivery: spoofed succeeded falls back to re-query state", async () => {
    const client = createMockClient({
      getDeposit: vi.fn().mockResolvedValue(succeededDeposit({ status: "verification_pending" })),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = webhookEvent(); // claims deposit.succeeded
    const { rawBody, headers } = deliver(event);

    const result = await provider.handleWebhook(event, rawBody, headers);

    expect(result.type).toBe("charge.pending");
    expect(result.providerReferenceId).toBe("txabc123");
  });

  it.each(["failed", "expired", "cancelled"] as const)(
    "maps %s to charge.failed/cancelled",
    async (status) => {
      const client = createMockClient({
        getDeposit: vi.fn().mockResolvedValue(succeededDeposit({ status })),
      });
      const provider = createVerifyCheckoutProvider(client, runtimeOptions);
      const event = webhookEvent();
      const { rawBody, headers } = deliver(event);

      const result = await provider.handleWebhook(event, rawBody, headers);

      expect(result.type).toBe("charge.failed/cancelled");
      expect(result.providerReferenceId).toBe("txabc123");
    },
  );

  it("maps review_required to charge.pending (hold)", async () => {
    const client = createMockClient({
      getDeposit: vi.fn().mockResolvedValue(succeededDeposit({ status: "review_required" })),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = webhookEvent();
    const { rawBody, headers } = deliver(event);

    const result = await provider.handleWebhook(event, rawBody, headers);

    expect(result.type).toBe("charge.pending");
  });

  it("maps succeeded with unverified flag to charge.pending", async () => {
    const client = createMockClient({
      getDeposit: vi.fn().mockResolvedValue(
        succeededDeposit({
          verification: { verified: false },
        }),
      ),
    });
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = webhookEvent();
    const { rawBody, headers } = deliver(event);

    const result = await provider.handleWebhook(event, rawBody, headers);

    expect(result.type).toBe("charge.pending");
  });

  it("handles webhook.test deliveries without touching the deposits API", async () => {
    const client = createMockClient();
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = { id: "evt_test", type: "webhook.test", api_version: "2026-06-01" };
    const { rawBody, headers } = deliver(event);

    const result = await provider.handleWebhook(event, rawBody, headers);

    expect(result.type).toBe("charge.pending");
    expect(result.providerReferenceId).toBe("evt_test");
    expect(client.getDeposit).not.toHaveBeenCalled();
  });

  it("treats a deposit without merchant_customer_id as uncorrelatable", async () => {
    const client = createMockClient();
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);
    const event = webhookEvent();
    delete (event.data as { object: Record<string, unknown> }).object.merchant_customer_id;
    const { rawBody, headers } = deliver(event);

    const result = await provider.handleWebhook(event, rawBody, headers);

    expect(result.type).toBe("charge.pending");
    expect(result.providerReferenceId).toBe("evt_1");
    expect(client.getDeposit).not.toHaveBeenCalled();
  });

  it("does not require a signature when no webhookSecret is configured", async () => {
    const client = createMockClient({
      getDeposit: vi.fn().mockResolvedValue(succeededDeposit()),
    });
    const provider = createVerifyCheckoutProvider(client, {
      returnUrl: RETURN_URL,
    });
    const event = webhookEvent();

    const result = await provider.handleWebhook(event, JSON.stringify(event), {});

    expect(result.type).toBe("charge.success");
    expect(result.providerReferenceId).toBe("txabc123");
  });

  it("rejects non-object payloads", async () => {
    const client = createMockClient();
    const provider = createVerifyCheckoutProvider(client, runtimeOptions);

    const error = await catchError(() =>
      provider.handleWebhook("not-an-object", "not-an-object", {}),
    );

    expect(error).toBeInstanceOf(VerifyCheckoutError);
    expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.INVALID_WEBHOOK);
  });
});

describe("verifyCheckout factory", () => {
  it("throws INVALID_CONFIG when apiKey is missing", () => {
    expect(() => verifyCheckout({ apiKey: "", returnUrl: RETURN_URL })).toThrowError(
      VerifyCheckoutError,
    );
    try {
      verifyCheckout({ apiKey: "", returnUrl: RETURN_URL });
    } catch (error) {
      expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.INVALID_CONFIG);
    }
  });

  it("throws INVALID_CONFIG when returnUrl is missing", () => {
    try {
      verifyCheckout({ apiKey: "vchk_key", returnUrl: "" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(VerifyCheckoutError);
      expect((error as VerifyCheckoutError).code).toBe(VERIFY_CHECKOUT_ERROR_CODES.INVALID_CONFIG);
    }
  });

  it("builds a PaymentProviderConfig with runtime and returnUrl fallback", () => {
    const config: PaymentProviderConfig = verifyCheckout({
      apiKey: "vchk_key",
      webhookSecret: WEBHOOK_SECRET,
      returnUrl: RETURN_URL,
      baseUrl: "https://api.verify.test",
    });

    expect(config.id).toBe("verify-checkout");
    expect(config.kind).toBe("verify-checkout");
    expect(config.secretKey).toBe("vchk_key");
    expect(config.webhookSecret).toBe(WEBHOOK_SECRET);
    expect(config.callbackUrl).toBe(RETURN_URL);
    expect(config.returnUrl).toBe(RETURN_URL);
    expect(config.runtime).toBeDefined();
    expect(config.runtime?.initializeTransaction).toBeTypeOf("function");
    expect(config.runtime?.verifyTransaction).toBeTypeOf("function");
    expect(config.runtime?.handleWebhook).toBeTypeOf("function");
  });

  it("keeps an explicit callbackUrl over the returnUrl fallback", () => {
    const config = verifyCheckout({
      apiKey: "vchk_key",
      returnUrl: RETURN_URL,
      callbackUrl: "https://shop.example.com/handle-webhook",
    });

    expect(config.callbackUrl).toBe("https://shop.example.com/handle-webhook");
    expect(config.baseUrl).toBeUndefined();
    expect(config.runtime).toBeDefined();
  });
});

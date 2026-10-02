import { describe, it, expect, vi, afterEach } from "vitest";

import { createVerifyCheckoutClient } from "../client";
import { VerifyCheckoutApiError } from "../errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const deposit = {
  id: "dep_abc123",
  merchant_order_id: "vc_order_1",
  merchant_customer_id: "tx_abc123",
  status: "awaiting_transfer",
  currency: "ETB",
  amount: "250.00",
  checkout_url: "https://checkout.verify.et/c/token",
  created_at: "2026-10-01T10:00:00.000Z",
  expires_at: "2026-10-01T11:00:00.000Z",
};

function setupClient() {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const client = createVerifyCheckoutClient({
    apiKey: "vchk_test_key",
    baseUrl: "https://api.verify.test",
  });
  return { fetchSpy, client };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createVerifyCheckoutClient - createDeposit", () => {
  it("sends POST with auth, version, and idempotency headers", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse({ data: deposit }));

    await client.createDeposit(
      {
        merchantCustomerId: "tx_abc123",
        amount: "250.00",
        currency: "ETB",
        returnUrl: "https://shop.example.com/return",
      },
      "tx_abc123",
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.verify.test/v1/deposits");
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer vchk_test_key");
    expect(headers["VerifyCheckout-Version"]).toBe("2026-06-01");
    expect(headers["Idempotency-Key"]).toBe("tx_abc123");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      merchant_customer_id: "tx_abc123",
      currency: "ETB",
      return_url: "https://shop.example.com/return",
      amount: "250.00",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits amount for a variable checkout", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse({ data: deposit }));

    await client.createDeposit(
      { merchantCustomerId: "tx_abc123", returnUrl: "https://shop.example.com/return" },
      "tx_abc123",
    );

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("payment_method");
  });

  it("maps 401 error envelope to a typed ApiError", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          data: null,
          error: { code: "invalid_api_key", message: "The API key is invalid or expired." },
          meta: { requestId: "req_1" },
        },
        401,
      ),
    );

    const error = await client
      .createDeposit(
        { merchantCustomerId: "tx_abc123", returnUrl: "https://shop.example.com/return" },
        "tx_abc123",
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerifyCheckoutApiError);
    expect((error as VerifyCheckoutApiError).statusCode).toBe(401);
    expect((error as VerifyCheckoutApiError).errorCode).toBe("invalid_api_key");
    expect((error as VerifyCheckoutApiError).requestId).toBe("req_1");
    expect((error as VerifyCheckoutApiError).message).toContain("invalid");
  });

  it("maps 409 idempotency conflict with retryable flag", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          data: null,
          error: { code: "idempotency_conflict", message: "Key reused with a different body." },
          meta: { requestId: "req_2" },
        },
        409,
      ),
    );

    const error = await client
      .createDeposit(
        { merchantCustomerId: "tx_abc123", returnUrl: "https://shop.example.com/return" },
        "tx_abc123",
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerifyCheckoutApiError);
    expect((error as VerifyCheckoutApiError).errorCode).toBe("idempotency_conflict");
    expect((error as VerifyCheckoutApiError).statusCode).toBe(409);
  });

  it("rejects non-JSON error bodies", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(new Response("<html>gateway error</html>", { status: 502 }));

    const error = await client
      .createDeposit(
        { merchantCustomerId: "tx_abc123", returnUrl: "https://shop.example.com/return" },
        "tx_abc123",
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerifyCheckoutApiError);
    expect((error as VerifyCheckoutApiError).statusCode).toBe(502);
    expect((error as VerifyCheckoutApiError).message).toContain("non-JSON");
  });
});

describe("createVerifyCheckoutClient - getDeposit", () => {
  it("GETs the deposit by id", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse({ data: deposit }));

    const result = await client.getDeposit("dep_abc123");

    expect(result.id).toBe("dep_abc123");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.verify.test/v1/deposits/dep_abc123");
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer vchk_test_key");
    expect(headers["Idempotency-Key"]).toBeUndefined();
  });

  it("surfaces 404 as a typed ApiError", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { data: null, error: { code: "resource_not_found", message: "Deposit not found." } },
        404,
      ),
    );

    const error = await client.getDeposit("dep_missing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerifyCheckoutApiError);
    expect((error as VerifyCheckoutApiError).statusCode).toBe(404);
  });
});

describe("createVerifyCheckoutClient - listDeposits", () => {
  it("passes documented filters as query params", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse({ data: [deposit] }));

    const result = await client.listDeposits({
      merchantOrderId: "vc_order_1",
      status: "succeeded",
      limit: 100,
    });

    expect(result).toHaveLength(1);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("/v1/deposits?");
    expect(url).toContain("merchant_order_id=vc_order_1");
    expect(url).toContain("status=succeeded");
    expect(url).toContain("limit=100");
  });

  it("rejects a non-array list payload", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse({ data: { not: "an array" } }));

    const error = await client.listDeposits().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerifyCheckoutApiError);
    expect((error as VerifyCheckoutApiError).message).toContain("not an array");
  });
});

describe("createVerifyCheckoutClient - envelope handling", () => {
  it("rejects a success envelope with missing data", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse({ meta: { requestId: "req_3" } }));

    const error = await client.getDeposit("dep_abc123").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VerifyCheckoutApiError);
    expect((error as VerifyCheckoutApiError).message).toContain("did not include data");
  });
});

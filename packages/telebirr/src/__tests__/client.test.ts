import { generateKeyPairSync } from "node:crypto";

import { describe, it, expect, vi, afterEach } from "vitest";

import { createTelebirrClient } from "../client";
import { TelebirrApiError } from "../errors";
import type { TelebirrConfig } from "../types";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const config: TelebirrConfig = {
  gatewayUrl: "https://api.example.com",
  checkoutUrl: "https://checkout.example.com/",
  fabricAppId: "fabric-app",
  appSecret: "app-secret",
  merchantAppId: "merchant-app",
  merchantCode: "123456",
  privateKeyPem: privateKey,
  notifyUrl: "https://example.com/notify",
  redirectUrl: "https://example.com/return",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const tokenBody = { token: "tok_1", expirationDate: "20991231235959" };

const queryBody = {
  result: "SUCCESS",
  biz_content: { order_status: "PAY_SUCCESS", total_amount: "100.00" },
};

function setupClient() {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  return { fetchSpy, client: createTelebirrClient(config) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createTelebirrClient - token single-flight", () => {
  it("shares one token fetch across concurrent callers", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse(tokenBody));

    const tokens = await Promise.all([
      client.getFabricToken(),
      client.getFabricToken(),
      client.getFabricToken(),
    ]);

    expect(tokens).toEqual(["tok_1", "tok_1", "tok_1"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reuses cached token without refetching", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockResolvedValue(jsonResponse(tokenBody));

    await client.getFabricToken();
    await client.getFabricToken();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("clears in-flight state on failure so the next call retries", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse({ msg: "boom" }, 500)));

    await expect(client.getFabricToken()).rejects.toBeInstanceOf(TelebirrApiError);

    fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse(tokenBody)));
    await expect(client.getFabricToken()).resolves.toBe("tok_1");
  });
});

describe("createTelebirrClient - transient retry (B5)", () => {
  it("retries queryOrder once on 502 and succeeds", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse({ msg: "bad gateway" }, 502))
      .mockResolvedValueOnce(jsonResponse(queryBody));

    const result = await client.queryOrder("order123");

    expect(result.result).toBe("SUCCESS");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 400", async () => {
    const { fetchSpy, client } = setupClient();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse({ msg: "bad request" }, 400));

    await expect(client.queryOrder("order400")).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("createTelebirrClient - queryOrder dedupe cache (C6)", () => {
  it("does not cache a pending response", async () => {
    const { fetchSpy, client } = setupClient();

    const pendingBody = {
      result: "SUCCESS",
      biz_content: { order_status: "PAY_PENDING", total_amount: "100.00" },
    };

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse(pendingBody));
    const first = await client.queryOrder("order_pending");
    expect(first.biz_content?.order_status).toBe("PAY_PENDING");

    // Second call must re-query Telebirr — pending must never go stale
    fetchSpy.mockResolvedValueOnce(jsonResponse(pendingBody));
    const second = await client.queryOrder("order_pending");
    expect(second.biz_content?.order_status).toBe("PAY_PENDING");

    // token + query + query (no cache hit for pending)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("caches the success that follows a pending query", async () => {
    const { fetchSpy, client } = setupClient();

    const pendingBody = {
      result: "SUCCESS",
      biz_content: { order_status: "PAY_PENDING" },
    };

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse(pendingBody));
    await client.queryOrder("order_race");

    fetchSpy.mockResolvedValueOnce(jsonResponse(queryBody));
    await client.queryOrder("order_race");

    fetchSpy.mockResolvedValueOnce(jsonResponse(queryBody));
    const third = await client.queryOrder("order_race");

    expect(third.biz_content?.order_status).toBe("PAY_SUCCESS");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("queries Telebirr for a different order id", async () => {
    const { fetchSpy, client } = setupClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse(queryBody));
    await client.queryOrder("order_a");

    fetchSpy.mockResolvedValueOnce(jsonResponse(queryBody));
    await client.queryOrder("order_b");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("createTelebirrClient - 401 clears dead token", () => {
  it("fetches a fresh token after a 401 invalidates the cached one", async () => {
    const { fetchSpy, client } = setupClient();
    const tokenCalls = () =>
      fetchSpy.mock.calls.filter(([input]) => String(input).includes("/payment/v1/token")).length;

    let queryFails = true;
    let tokenCounter = 0;
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/payment/v1/token")) {
        tokenCounter += 1;
        return Promise.resolve(
          jsonResponse({
            token: `tok_${String(tokenCounter)}`,
            expirationDate: "20991231235959",
          }),
        );
      }
      if (queryFails) {
        return Promise.resolve(jsonResponse({ msg: "token invalid" }, 401));
      }
      return Promise.resolve(jsonResponse(queryBody));
    });

    // 1) token fetched and cached (tok_1)
    await expect(client.getFabricToken()).resolves.toBe("tok_1");
    expect(tokenCalls()).toBe(1);

    // 2) query hits 401 → error thrown AND dead token dropped
    await expect(client.queryOrder("order_401")).rejects.toMatchObject({ statusCode: 401 });

    // 3) next call must re-fetch a token (tok_2), not reuse the dead one
    queryFails = false;
    const result = await client.queryOrder("order_401");

    expect(result.result).toBe("SUCCESS");
    expect(tokenCalls()).toBe(2);
    expect(
      fetchSpy.mock.calls.filter(([input]) => String(input).includes("queryOrder")),
    ).toHaveLength(2);
  });
});

describe("createTelebirrClient - createPayment order id (server ^[A-Za-z0-9]+$ contract)", () => {
  const preOrderBody = { result: "SUCCESS", biz_content: { prepay_id: "prep_1" } };

  it("accepts BirrJS core txRef format (tx + alnum) as merchantOrderId", async () => {
    const { fetchSpy, client } = setupClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse(preOrderBody));

    const txRef = "txA1b2C3d4E5f6G7h8I9j0K1l2";
    const result = await client.createPayment({
      amount: "100",
      title: "Subscription",
      merchantOrderId: txRef,
    });

    expect(result.checkoutUrl).toContain("prepay_id=prep_1");

    const preorderCall = fetchSpy.mock.calls.find(([input]) => String(input).includes("preOrder"));
    expect(preorderCall).toBeDefined();
    const body = JSON.parse(String(preorderCall?.[1]?.body)) as {
      biz_content: { merch_order_id: string };
    };
    expect(body.biz_content.merch_order_id).toBe(txRef);
  });

  it.each([
    ["tx_abc123", "underscore"],
    ["tx-abc123", "hyphen"],
  ])("rejects %s (%s) — live Telebirr returns 400 for it", async (merchantOrderId) => {
    const { fetchSpy, client } = setupClient();

    await expect(
      client.createPayment({ amount: "100", title: "Subscription", merchantOrderId }),
    ).rejects.toThrow(TypeError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("generates a safe order id when none is provided", async () => {
    const { fetchSpy, client } = setupClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse(preOrderBody));

    const result = await client.createPayment({ amount: "100", title: "Subscription" });

    expect(result.merchantOrderId).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("still rejects characters that break signing or URLs", async () => {
    const { fetchSpy, client } = setupClient();

    await expect(
      client.createPayment({ amount: "100", title: "Subscription", merchantOrderId: "bad&id" }),
    ).rejects.toThrow(TypeError);

    // Fails locally — no network call happens
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid amount before sending", async () => {
    const { fetchSpy, client } = setupClient();

    await expect(client.createPayment({ amount: "10.999", title: "Subscription" })).rejects.toThrow(
      TypeError,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createTelebirrClient - nonce charset", () => {
  it("sends a 32-char uppercase hex nonce with no special characters", async () => {
    const { fetchSpy, client } = setupClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse(queryBody));

    await client.queryOrder("order_nonce");

    const queryCall = fetchSpy.mock.calls.find(([input]) => String(input).includes("queryOrder"));
    expect(queryCall).toBeDefined();
    const body = JSON.parse(String(queryCall?.[1]?.body)) as { nonce_str: string };

    expect(body.nonce_str).toMatch(/^[0-9A-F]{32}$/);
  });
});

describe("createTelebirrClient - prepay_id guard", () => {
  it("throws when the pre-order response omits prepay_id", async () => {
    const { fetchSpy, client } = setupClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse({ result: "SUCCESS", biz_content: {} }));

    await expect(
      client.createPayment({ amount: "100", title: "Subscription" }),
    ).rejects.toMatchObject({
      name: "TelebirrApiError",
      message: expect.stringContaining("prepay_id"),
    });
  });

  it("throws when prepay_id is an empty string", async () => {
    const { fetchSpy, client } = setupClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse({ result: "SUCCESS", biz_content: { prepay_id: "" } }));

    await expect(
      client.createPayment({ amount: "100", title: "Subscription" }),
    ).rejects.toMatchObject({
      name: "TelebirrApiError",
      message: expect.stringContaining("prepay_id"),
    });
  });
});

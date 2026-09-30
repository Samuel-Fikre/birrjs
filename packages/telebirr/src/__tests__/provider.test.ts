import { generateKeyPairSync } from "node:crypto";

import type { PaymentProviderConfig } from "@birrjs/core";
import { describe, it, expect, vi } from "vitest";

import type { TelebirrClient } from "../client";
import { isSuccessfulPayment } from "../client";
import { TelebirrApiError, TelebirrError, TELEBIRR_ERROR_CODES } from "../errors";
import { normalizePrivateKey } from "../private-key";
import { createTelebirrProvider, telebirr } from "../provider";
import { signRequest } from "../signing";

function createMockClient(overrides: Partial<TelebirrClient> = {}): TelebirrClient {
  return {
    getFabricToken: vi.fn().mockResolvedValue("mock-token"),
    createPayment: vi.fn(),
    queryOrder: vi.fn(),
    ...overrides,
  };
}

const mockConfig: PaymentProviderConfig = {
  id: "telebirr",
  kind: "telebirr",
  secretKey: "test_app_secret",
  callbackUrl: "https://example.com/notify",
};

const txReq = {
  amount: 10000,
  currency: "ETB" as const,
  email: "test@example.com",
  txRef: "tx_test123",
  callbackUrl: "https://example.com/cb",
};

async function catchError<T>(fn: () => Promise<T>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("TelebirrProvider - initializeTransaction", () => {
  it("returns checkoutUrl on success", async () => {
    const client = createMockClient({
      createPayment: vi.fn().mockResolvedValue({
        merchantOrderId: "tx_test123",
        prepayId: "prepay_abc",
        checkoutUrl: "https://checkout.ethiomobilemoney.et/?appid=xxx&prepay_id=prepay_abc",
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.initializeTransaction(txReq);

    expect(result.success).toBe(true);
    expect(result.checkoutUrl).toContain("checkout.ethiomobilemoney.et");
    expect(result.txRef).toBe("tx_test123");
  });

  it("handles TelebirrApiError with 401 as UNAUTHORIZED", async () => {
    const client = createMockClient({
      createPayment: vi.fn().mockRejectedValue(new TelebirrApiError("Unauthorized", 401)),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.UNAUTHORIZED);
  });

  it("handles TelebirrApiError with 500 as SERVER_ERROR", async () => {
    const client = createMockClient({
      createPayment: vi.fn().mockRejectedValue(new TelebirrApiError("Server error", 500)),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.SERVER_ERROR);
  });

  it("handles non-TelebirrApiError (network failure)", async () => {
    const client = createMockClient({
      createPayment: vi.fn().mockRejectedValue(new Error("Network timeout")),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.INITIALIZATION_FAILED);
    expect((error as TelebirrError).message).toContain("Network timeout");
  });
});

describe("TelebirrProvider - verifyTransaction", () => {
  it("returns success for PAY_SUCCESS status", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: {
          order_status: "PAY_SUCCESS",
          total_amount: "100.00",
          trans_currency: "ETB",
          payment_order_id: "telebirr_ref_1",
        },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.verifyTransaction("tx_test123");

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.amount).toBe(10000);
    expect(result.currency).toBe("ETB");
    expect(result.txRef).toBe("tx_test123");
    expect(result.providerTxRef).toBe("telebirr_ref_1");
  });

  it("returns success for Completed status (webhook)", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: {
          trade_status: "Completed",
          total_amount: "50.00",
          trans_currency: "ETB",
        },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.verifyTransaction("tx_test456");

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.amount).toBe(5000);
  });

  it("returns failure for non-success status", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: {
          order_status: "PAY_PENDING",
          total_amount: "100.00",
        },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.verifyTransaction("tx_pending");

    expect(result.success).toBe(false);
    expect(result.status).toBe("PAY_PENDING");
  });

  it("handles TelebirrApiError with 401 as UNAUTHORIZED", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockRejectedValue(new TelebirrApiError("Unauthorized", 401)),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const error = await catchError(() => provider.verifyTransaction("tx_fail"));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.UNAUTHORIZED);
  });

  it("handles network error", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const error = await catchError(() => provider.verifyTransaction("tx_net"));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.VERIFICATION_FAILED);
  });
});

describe("TelebirrProvider - handleWebhook", () => {
  it("queries provider and returns charge.success on PAY_SUCCESS", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: {
          order_status: "PAY_SUCCESS",
          total_amount: "100.00",
        },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.handleWebhook(
      { merch_order_id: "order123", trade_status: "Completed" },
      "",
      {},
    );

    expect(result.type).toBe("charge.success");
    expect(result.providerReferenceId).toBe("order123");
    expect(client.queryOrder).toHaveBeenCalledWith("order123");
  });

  it("returns charge.failed/cancelled for non-success verification", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: {
          order_status: "PAY_FAILED",
        },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.handleWebhook({ merch_order_id: "order_fail" }, "", {});

    expect(result.type).toBe("charge.failed/cancelled");
    expect(result.providerReferenceId).toBe("order_fail");
  });

  it("returns charge.failed/cancelled when result is missing even if status says PAY_SUCCESS", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        biz_content: { order_status: "PAY_SUCCESS" },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.handleWebhook({ merch_order_id: "no_result" }, "", {});

    expect(result.type).toBe("charge.failed/cancelled");
    expect(client.queryOrder).toHaveBeenCalledWith("no_result");
  });

  it("unwraps data envelope if present", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: { order_status: "PAY_SUCCESS" },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.handleWebhook(
      { data: { merch_order_id: "wrapped_order" } },
      "",
      {},
    );

    expect(result.providerReferenceId).toBe("wrapped_order");
    expect(client.queryOrder).toHaveBeenCalledWith("wrapped_order");
  });

  it("throws on missing merch_order_id", async () => {
    const client = createMockClient();
    const provider = createTelebirrProvider(client, mockConfig);

    const error = await catchError(() => provider.handleWebhook({ random_field: "value" }, "", {}));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.INVALID_WEBHOOK);
  });

  it("throws on null payload", async () => {
    const client = createMockClient();
    const provider = createTelebirrProvider(client, mockConfig);

    const error = await catchError(() => provider.handleWebhook(null, "", {}));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.INVALID_WEBHOOK);
  });
});

describe("isSuccessfulPayment - single decision rule", () => {
  it("true for result=SUCCESS + order_status=PAY_SUCCESS", () => {
    expect(
      isSuccessfulPayment({ result: "SUCCESS", biz_content: { order_status: "PAY_SUCCESS" } }),
    ).toBe(true);
  });

  it("true for result=SUCCESS + trade_status=Completed", () => {
    expect(
      isSuccessfulPayment({ result: "SUCCESS", biz_content: { trade_status: "Completed" } }),
    ).toBe(true);
  });

  it("false for result=SUCCESS + PAY_PENDING", () => {
    expect(
      isSuccessfulPayment({ result: "SUCCESS", biz_content: { order_status: "PAY_PENDING" } }),
    ).toBe(false);
  });

  it("false when result is missing even if status is PAY_SUCCESS", () => {
    expect(isSuccessfulPayment({ biz_content: { order_status: "PAY_SUCCESS" } })).toBe(false);
  });
});

describe("handleWebhook signature verification (C7)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  function signedPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return {
      ...payload,
      sign: signRequest(payload, privateKey),
      sign_type: "SHA256WithRSA",
    };
  }

  it("accepts a validly signed notify payload", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: { order_status: "PAY_SUCCESS" },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig, publicKey);

    const result = await provider.handleWebhook(
      signedPayload({ merch_order_id: "order_signed" }),
      "",
      {},
    );

    expect(result.type).toBe("charge.success");
    expect(client.queryOrder).toHaveBeenCalledWith("order_signed");
  });

  it("rejects a tampered payload", async () => {
    const client = createMockClient();
    const provider = createTelebirrProvider(client, mockConfig, publicKey);

    const payload = signedPayload({ merch_order_id: "order_tampered" });
    payload.merch_order_id = "order_evil";

    const error = await catchError(() => provider.handleWebhook(payload, "", {}));

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.INVALID_WEBHOOK);
    expect(client.queryOrder).not.toHaveBeenCalled();
  });

  it("rejects a payload with no signature when public key is configured", async () => {
    const client = createMockClient();
    const provider = createTelebirrProvider(client, mockConfig, publicKey);

    const error = await catchError(() =>
      provider.handleWebhook({ merch_order_id: "order_unsigned" }, "", {}),
    );

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.INVALID_WEBHOOK);
    expect(client.queryOrder).not.toHaveBeenCalled();
  });

  it("skips verification when no public key is configured", async () => {
    const client = createMockClient({
      queryOrder: vi.fn().mockResolvedValue({
        result: "SUCCESS",
        biz_content: { order_status: "PAY_SUCCESS" },
      }),
    });
    const provider = createTelebirrProvider(client, mockConfig);

    const result = await provider.handleWebhook({ merch_order_id: "order_no_key" }, "", {});

    expect(result.type).toBe("charge.success");
  });
});

describe("telebirr() factory", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const validOptions = {
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

  it("returns a config assignable to PaymentProviderConfig", () => {
    const cfg: PaymentProviderConfig = telebirr(validOptions);

    expect(cfg.id).toBe("telebirr");
    expect(cfg.kind).toBe("telebirr");
    expect(cfg.secretKey).toBe("app-secret");
    expect(cfg.callbackUrl).toBe("https://example.com/notify");
    expect(cfg.runtime).toBeDefined();
  });

  it("keeps all Telebirr-specific fields on the returned config", () => {
    const cfg = telebirr(validOptions);

    expect(cfg.gatewayUrl).toBe("https://api.example.com");
    expect(cfg.checkoutUrl).toBe("https://checkout.example.com/");
    expect(cfg.fabricAppId).toBe("fabric-app");
    expect(cfg.appSecret).toBe("app-secret");
    expect(cfg.merchantAppId).toBe("merchant-app");
    expect(cfg.merchantCode).toBe("123456");
    expect(cfg.notifyUrl).toBe("https://example.com/notify");
    expect(cfg.redirectUrl).toBe("https://example.com/return");
    expect(cfg.privateKeyPem).toBe(normalizePrivateKey(privateKey));
  });

  it("passes timeoutMs through to the config", () => {
    const cfg = telebirr({ ...validOptions, timeoutMs: 45_000 });

    expect(cfg.timeoutMs).toBe(45_000);
  });

  it("throws TELEBIRR_INVALID_PRIVATE_KEY for a broken key", () => {
    let error: unknown;
    try {
      telebirr({ ...validOptions, privateKeyPem: "not-a-key" });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TelebirrError);
    expect((error as TelebirrError).code).toBe(TELEBIRR_ERROR_CODES.INVALID_PRIVATE_KEY);
  });
});

import type { PaymentProviderConfig } from "@birrjs/core";
import { describe, it, expect, vi } from "vitest";

import { createChapaProvider } from "../chapa-provider";
import type { ChapaClient } from "../client";
import { ChapaApiError, ChapaError, CHAPA_ERROR_CODES } from "../errors";

function createMockClient(overrides: Partial<ChapaClient> = {}): ChapaClient {
  return {
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    ...overrides,
  };
}

const mockConfig: PaymentProviderConfig = {
  id: "chapa",
  kind: "chapa",
  secretKey: "test_key",
  callbackUrl: "https://example.com/callback",
};

const txReq = {
  amount: 1000,
  currency: "ETB" as const,
  email: "test@example.com",
  txRef: "tx_test",
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

describe("ChapaProvider - initializeTransaction errors", () => {
  it("handles ChapaApiError with 400 status and includes error body", async () => {
    const client = createMockClient({
      initializeTransaction: vi
        .fn()
        .mockRejectedValue(new ChapaApiError("Bad request", 400, { email: ["validation.email"] })),
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() =>
      provider.initializeTransaction({ ...txReq, email: "bad@example.com" }),
    );

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.CLIENT_ERROR);
    expect((error as ChapaError).message).toContain("400");
    expect((error as ChapaError).message).toContain("email");
  });

  it("handles ChapaApiError with 500 status as SERVER_ERROR", async () => {
    const client = createMockClient({
      initializeTransaction: vi.fn().mockRejectedValue(new ChapaApiError("Server error", 500)),
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.SERVER_ERROR);
  });

  it("handles non-ChapaApiError (network failure)", async () => {
    const client = createMockClient({
      initializeTransaction: vi.fn().mockRejectedValue(new Error("Network timeout")),
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() => provider.initializeTransaction(txReq));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INITIALIZATION_FAILED);
    expect((error as ChapaError).message).toContain("Network timeout");
  });

  it("returns error for failed transaction response (status: failed)", async () => {
    const client = createMockClient({
      initializeTransaction: vi.fn().mockResolvedValue({
        status: "failed",
        message: "Insufficient balance",
        data: null,
      }),
    });
    const provider = createChapaProvider(client, mockConfig);

    const result = await provider.initializeTransaction(txReq);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient balance");
  });

  it("returns error for malformed response (missing checkout_url)", async () => {
    const client = createMockClient({
      initializeTransaction: vi.fn().mockResolvedValue({
        status: "success",
        message: "Success",
        data: null,
      }),
    });
    const provider = createChapaProvider(client, mockConfig);

    const result = await provider.initializeTransaction(txReq);

    expect(result.success).toBe(false);
    expect(result.error).toContain("missing checkout URL");
  });
});

describe("ChapaProvider - verifyTransaction errors", () => {
  it("handles ChapaApiError with 401 status as UNAUTHORIZED", async () => {
    const client = createMockClient({
      verifyTransaction: vi.fn().mockRejectedValue(new ChapaApiError("Unauthorized", 401)),
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() => provider.verifyTransaction("tx_fail"));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.UNAUTHORIZED);
    expect((error as ChapaError).message).toContain("API key");
  });

  it("handles ChapaApiError with 404 status as NOT_FOUND", async () => {
    const client = createMockClient({
      verifyTransaction: vi.fn().mockRejectedValue(new ChapaApiError("Not found", 404)),
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() => provider.verifyTransaction("tx_missing"));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.NOT_FOUND);
  });

  it("handles ChapaApiError with 429 status as RATE_LIMITED", async () => {
    const client = createMockClient({
      verifyTransaction: vi.fn().mockRejectedValue(new ChapaApiError("Rate limited", 429)),
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() => provider.verifyTransaction("tx_rl"));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.RATE_LIMITED);
  });

  it("returns successful verification response", async () => {
    const client = createMockClient({
      verifyTransaction: vi.fn().mockResolvedValue({
        status: "success",
        message: "Success",
        data: {
          first_name: "Sam",
          last_name: "Test",
          email: "test@example.com",
          currency: "ETB",
          amount: 10,
          charge: 0,
          mode: "test",
          method: "chapa",
          type: "API",
          status: "success",
          reference: "chapa_ref_1",
          tx_ref: "tx_ok",
          customization: null,
          meta: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      }),
    });
    const provider = createChapaProvider(client, mockConfig);

    const result = await provider.verifyTransaction("tx_ok");

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.amount).toBe(1000);
    expect(result.txRef).toBe("tx_ok");
    expect(result.providerTxRef).toBe("chapa_ref_1");
  });
});

describe("ChapaError.isRetryable", () => {
  it("returns true for NETWORK_ERROR", () => {
    const err = new ChapaError("network", CHAPA_ERROR_CODES.NETWORK_ERROR);
    expect(ChapaError.isRetryable(err)).toBe(true);
  });

  it("returns true for SERVER_ERROR", () => {
    const err = new ChapaError("server", CHAPA_ERROR_CODES.SERVER_ERROR);
    expect(ChapaError.isRetryable(err)).toBe(true);
  });

  it("returns true for RATE_LIMITED", () => {
    const err = new ChapaError("rate limited", CHAPA_ERROR_CODES.RATE_LIMITED);
    expect(ChapaError.isRetryable(err)).toBe(true);
  });

  it("returns false for CLIENT_ERROR", () => {
    const err = new ChapaError("client error", CHAPA_ERROR_CODES.CLIENT_ERROR);
    expect(ChapaError.isRetryable(err)).toBe(false);
  });

  it("returns false for INITIALIZATION_FAILED", () => {
    const err = new ChapaError("init failed", CHAPA_ERROR_CODES.INITIALIZATION_FAILED);
    expect(ChapaError.isRetryable(err)).toBe(false);
  });
});

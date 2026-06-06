import type { PaymentProviderConfig } from "@birrjs/core";
import { describe, it, expect, vi } from "vitest";

import { createChapaProvider } from "../chapa-provider";
import type { ChapaClient } from "../client";
import { ChapaError, CHAPA_ERROR_CODES } from "../errors";
import type { ChapaWebhookEvent } from "../schemas";

const webhookSecret = "test_webhook_secret_123";

const mockConfig: PaymentProviderConfig = {
  id: "chapa",
  kind: "chapa",
  secretKey: "test_key",
  webhookSecret,
  callbackUrl: "https://example.com/callback",
};

const rawBody = JSON.stringify({
  event: "charge.success",
  first_name: "Sam",
  last_name: "Test",
  email: "test@example.com",
  mobile: "+251911000000",
  currency: "ETB",
  amount: "10.00",
  charge: "0.00",
  status: "success",
  mode: "test",
  reference: "chapa_ref_1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  type: "API",
  tx_ref: "tx_test",
  payment_method: "chapa",
  customization: { title: "Test", description: null, logo: null },
  meta: null,
});

function validPayload(): ChapaWebhookEvent {
  return JSON.parse(rawBody) as ChapaWebhookEvent;
}

function validHeaders(): Record<string, string> {
  const crypto = require("crypto");
  const signature = crypto.createHmac("sha256", webhookSecret).update(webhookSecret).digest("hex");
  return { "chapa-signature": signature };
}

function createMockClient(verifyResult?: unknown, initResult?: unknown): ChapaClient {
  return {
    initializeTransaction: vi.fn().mockResolvedValue(
      initResult ?? {
        status: "success",
        message: "ok",
        data: { checkout_url: "https://checkout.chapa.co/1" },
      },
    ),
    verifyTransaction: vi.fn().mockResolvedValue(
      verifyResult ?? {
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
          tx_ref: "tx_test",
          customization: null,
          meta: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      },
    ),
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

describe("ChapaProvider - handleWebhook errors", () => {
  it("rejects payload with invalid structure", async () => {
    const client = createMockClient();
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() => provider.handleWebhook({ invalid: true }, "", {}));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INVALID_WEBHOOK);
  });

  it("rejects when webhook signature is missing", async () => {
    const client = createMockClient();
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() => provider.handleWebhook(validPayload(), rawBody, {}));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INVALID_WEBHOOK);
    expect((error as ChapaError).message).toContain("signature");
  });

  it("rejects when webhook signature is invalid", async () => {
    const client = createMockClient();
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() =>
      provider.handleWebhook(validPayload(), rawBody, { "chapa-signature": "bad_signature" }),
    );

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INVALID_WEBHOOK);
    expect((error as ChapaError).message).toContain("signature");
  });

  it("rejects when tx_ref is missing in payload", async () => {
    const client = createMockClient();
    const provider = createChapaProvider(client, mockConfig);
    const payload = { ...validPayload(), tx_ref: "" };

    const error = await catchError(() => provider.handleWebhook(payload, rawBody, validHeaders()));

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INVALID_WEBHOOK);
    expect((error as ChapaError).message).toContain("tx_ref");
  });

  it("rejects when verification API call fails", async () => {
    const client = createMockClient(Promise.reject(new Error("Network error")));
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() =>
      provider.handleWebhook(validPayload(), rawBody, validHeaders()),
    );

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.VERIFICATION_FAILED);
  });

  it("rejects when webhook status does not match verification", async () => {
    // Webhook payload says "failed", but Chapa verification says "success"
    const mismatchedPayload = { ...validPayload(), status: "failed" };
    const mismatchedRawBody = JSON.stringify(mismatchedPayload);
    const crypto = require("crypto");
    const sig = crypto.createHmac("sha256", webhookSecret).update(webhookSecret).digest("hex");
    const client = createMockClient({
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
        tx_ref: "tx_test",
        customization: null,
        meta: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() =>
      provider.handleWebhook(mismatchedPayload, mismatchedRawBody, { "chapa-signature": sig }),
    );

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INVALID_WEBHOOK);
    expect((error as ChapaError).message).toContain("status");
  });

  it("rejects when amount does not match verification", async () => {
    const client = createMockClient({
      status: "success",
      message: "Success",
      data: {
        first_name: "Sam",
        last_name: "Test",
        email: "test@example.com",
        currency: "ETB",
        amount: 20,
        charge: 0,
        mode: "test",
        method: "chapa",
        type: "API",
        status: "success",
        reference: "chapa_ref_1",
        tx_ref: "tx_test",
        customization: null,
        meta: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() =>
      provider.handleWebhook(validPayload(), rawBody, validHeaders()),
    );

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INVALID_WEBHOOK);
    expect((error as ChapaError).message).toContain("amount");
  });

  it("rejects when mode does not match verification", async () => {
    const client = createMockClient({
      status: "success",
      message: "Success",
      data: {
        first_name: "Sam",
        last_name: "Test",
        email: "test@example.com",
        currency: "ETB",
        amount: 10,
        charge: 0,
        mode: "live",
        method: "chapa",
        type: "API",
        status: "success",
        reference: "chapa_ref_1",
        tx_ref: "tx_test",
        customization: null,
        meta: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    });
    const provider = createChapaProvider(client, mockConfig);

    const error = await catchError(() =>
      provider.handleWebhook(validPayload(), rawBody, validHeaders()),
    );

    expect(error).toBeInstanceOf(ChapaError);
    expect((error as ChapaError).code).toBe(CHAPA_ERROR_CODES.INVALID_WEBHOOK);
    expect((error as ChapaError).message).toContain("mode");
  });

  it("returns success for valid webhook", async () => {
    const client = createMockClient();
    const provider = createChapaProvider(client, mockConfig);

    const result = await provider.handleWebhook(validPayload(), rawBody, validHeaders());

    expect(result).toHaveProperty("providerReferenceId", "tx_test");
    expect(result).toHaveProperty("type", "charge.success");
    expect(result).toHaveProperty("payload");
  });
});

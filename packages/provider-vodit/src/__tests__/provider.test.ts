import { describe, it, expect, vi } from "vitest";

import type { VoditClient } from "../client";
import { VoditApiError, VoditError } from "../errors";
import { createVoditProvider } from "../provider";
import type { VoditChannel, VoditVerifyResponse } from "../types";

const mockChannels: VoditChannel[] = [
  { type: "telebirr", value: "251912345678", name: "samuel" },
  { type: "cbe", value: "1000001234567", name: "samuel" },
];

function createMockClient(overrides?: Partial<VoditClient>): VoditClient {
  return {
    verify: vi.fn(),
    pollResult: vi.fn(),
    status: vi.fn(),
    ...overrides,
  };
}

describe("initializeTransaction", () => {
  it("returns payment instructions with configured channels", async () => {
    const client = createMockClient();
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.initializeTransaction({
      amount: 2900,
      currency: "ETB",
      email: "test@example.com",
      txRef: "tx_test",
      callbackUrl: "https://example.com/callback",
    });

    expect(result.success).toBe(true);
    expect(result.checkoutUrl).toBeUndefined();
    expect(result.paymentInstructions).toBeDefined();
    expect(result.paymentInstructions!.amount).toBe(29);
    expect(result.paymentInstructions!.channels).toHaveLength(2);
    expect(result.paymentInstructions!.channels[0]!.type).toBe("telebirr");
    expect(result.paymentInstructions!.channels[0]!.label).toBe("Telebirr");
    expect(result.paymentInstructions!.channels[1]!.type).toBe("cbe");
    expect(result.paymentInstructions!.channels[1]!.label).toBe("Commercial Bank Of Ethiopia");
    expect(result.paymentInstructions!.channels[0]!.accountHolder).toBe("samuel");
    expect(result.paymentInstructions!.channels[1]!.accountHolder).toBe("samuel");
    expect(result.txRef).toBe("tx_test");
  });
});

describe("verifyTransaction", () => {
  it("verifies a valid telebirr receipt", async () => {
    const mockResponse: VoditVerifyResponse = {
      ok: true,
      providerKey: "telebirr",
      resolvedUrl: "https://transactioninfo.ethiotelecom.et/receipt/ABCD1234EF",
      httpStatus: 200,
      receipt: {
        source: "telebirr-html",
        payerName: "Abebe Kebede",
        transactionStatus: "Completed",
        totalPaidAmount: "100 Birr",
      },
      error: null,
    };

    const client = createMockClient({ verify: vi.fn().mockResolvedValue(mockResponse) });
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/ABCD1234EF",
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.amount).toBe(10000);
    expect(result.currency).toBe("ETB");
  });

  it("verifies a valid CBE receipt with numeric amount", async () => {
    const mockResponse: VoditVerifyResponse = {
      ok: true,
      providerKey: "cbe",
      resolvedUrl: "https://apps.cbe.com.et:100/?id=FT00000000-12345678",
      httpStatus: 200,
      receipt: {
        source: "cbe-pdf",
        payerName: "Abebe Kebede",
        transferredAmount: 100,
      },
      error: null,
    };

    const client = createMockClient({ verify: vi.fn().mockResolvedValue(mockResponse) });
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://apps.cbe.com.et:100/?id=FT00000000-12345678",
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.amount).toBe(10000);
  });

  it("handles invalid receipt URL", async () => {
    const mockResponse: VoditVerifyResponse = {
      ok: false,
      providerKey: "telebirr",
      resolvedUrl: "https://transactioninfo.ethiotelecom.et/receipt/INVALID",
      httpStatus: 502,
      receipt: null,
      error: "Receipt not found",
    };

    const client = createMockClient({ verify: vi.fn().mockResolvedValue(mockResponse) });
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/INVALID",
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("rejects telebirr receipt with non-Completed transactionStatus", async () => {
    const mockResponse: VoditVerifyResponse = {
      ok: true,
      providerKey: "telebirr",
      resolvedUrl: "https://transactioninfo.ethiotelecom.et/receipt/PENDING123",
      httpStatus: 200,
      receipt: {
        source: "telebirr-html",
        payerName: "Abebe Kebede",
        transactionStatus: "Pending",
        totalPaidAmount: "100 Birr",
      },
      error: null,
    };

    const client = createMockClient({ verify: vi.fn().mockResolvedValue(mockResponse) });
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.verifyTransaction("https://example.com/receipt");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not completed");
  });

  it("throws VoditError on network error", async () => {
    const client = createMockClient({
      verify: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const provider = createVoditProvider(client, mockChannels);

    await expect(provider.verifyTransaction("https://example.com/receipt")).rejects.toThrow(
      VoditError,
    );
  });

  it("re-throws VoditApiError as VoditError with matching code", async () => {
    const client = createMockClient({
      verify: vi.fn().mockRejectedValue(new VoditApiError("Bad key", 401, "invalid_key")),
    });
    const provider = createVoditProvider(client, mockChannels);

    await expect(provider.verifyTransaction("https://example.com/receipt")).rejects.toMatchObject({
      code: "VODIT_UNAUTHORIZED",
    });
  });

  it("throws VoditError with TIMEOUT_ERROR on AbortError", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const client = createMockClient({
      verify: vi.fn().mockRejectedValue(abortError),
    });
    const provider = createVoditProvider(client, mockChannels);

    await expect(provider.verifyTransaction("https://example.com/receipt")).rejects.toMatchObject({
      code: "VODIT_TIMEOUT_ERROR",
    });
  });
});

describe("recipient verification", () => {
  it("rejects receipt with mismatched last 4 digits", async () => {
    const mockResponse: VoditVerifyResponse = {
      ok: true,
      providerKey: "telebirr",
      resolvedUrl: "https://transactioninfo.ethiotelecom.et/receipt/DG34IFC04A",
      httpStatus: 200,
      receipt: {
        source: "telebirr-html",
        payerName: "Abebe Kebede",
        transactionStatus: "Completed",
        totalPaidAmount: "200 Birr",
        creditedPartyAccountNo: "2519****9999",
        creditedPartyName: "samuel Fikre",
      },
      error: null,
    };

    const client = createMockClient({ verify: vi.fn().mockResolvedValue(mockResponse) });
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/DG34IFC04A",
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("doesn't match the payment account");
  });

  it("rejects when receipt name doesn't match channel name", async () => {
    const mockResponse: VoditVerifyResponse = {
      ok: true,
      providerKey: "telebirr",
      resolvedUrl: "",
      httpStatus: 200,
      receipt: {
        source: "telebirr-html",
        payerName: "Abebe Kebede",
        transactionStatus: "Completed",
        totalPaidAmount: "200 Birr",
        creditedPartyAccountNo: "2519****5678",
        creditedPartyName: "Abebe Kebede",
      },
      error: null,
    };

    const client = createMockClient({ verify: vi.fn().mockResolvedValue(mockResponse) });
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/ABCD1234",
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("doesn't match the payment account");
  });

  it("passes when both last 4 digits and name match", async () => {
    const mockResponse: VoditVerifyResponse = {
      ok: true,
      providerKey: "telebirr",
      resolvedUrl: "",
      httpStatus: 200,
      receipt: {
        source: "telebirr-html",
        payerName: "Abebe Kebede",
        transactionStatus: "Completed",
        totalPaidAmount: "200 Birr",
        creditedPartyAccountNo: "2519****5678",
        creditedPartyName: "Samuel Fikre",
      },
      error: null,
    };

    const client = createMockClient({ verify: vi.fn().mockResolvedValue(mockResponse) });
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/ABCD1234",
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.amount).toBe(20000);
  });
});

describe("handleWebhook", () => {
  it("returns unsupported event", async () => {
    const client = createMockClient();
    const provider = createVoditProvider(client, mockChannels);

    const result = await provider.handleWebhook({}, "", {});

    expect(result.type).toBe("unsupported");
    expect(result.providerReferenceId).toBe("none");
  });
});

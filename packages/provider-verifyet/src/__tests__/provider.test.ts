import { describe, it, expect, vi } from "vitest";

import type { VerifyEtClient } from "../client";
import { VerifyEtApiError, VerifyEtError } from "../errors";
import { createVerifyEtProvider } from "../provider";
import type { VerifyEtChannel, VerifyEtVerifyResponse } from "../types";

const mockChannels: VerifyEtChannel[] = [
  { type: "telebirr", value: "251912345678", name: "Telebirr" },
  { type: "cbe", value: "1000001234567", name: "CBE" },
];

function createMockClient(overrides?: Partial<VerifyEtClient>): VerifyEtClient {
  return {
    verify: vi.fn(),
    status: vi.fn(),
    ...overrides,
  };
}

function successResponse(overrides?: Partial<VerifyEtVerifyResponse>): VerifyEtVerifyResponse {
  return {
    success: true,
    message: "Transaction verified successfully.",
    data: [
      {
        bank: "telebirr",
        status: "success",
        verified: true,
        amount: 100,
        currency: "ETB",
        senderName: "Abebe Kebede",
        receiverName: "Telebirr",
        receiverAccount: "2519****5678",
        referenceNumber: "DET8FJGUJ4",
        accountSuffix: "5678",
        timestamp: "2026-07-27T12:00:00.000Z",
        confirmationHistory: {
          scope: "platform",
          isFirstConfirmation: true,
          confirmedBefore: false,
          firstConfirmedAt: "2026-07-27T12:00:00.000Z",
          lastConfirmedAt: "2026-07-27T12:00:00.000Z",
          confirmationCount: 1,
        },
        settlementAccountMatch: {
          matched: true,
          matchType: "masked_pattern",
          matchConfidence: "high",
          source: "account_registry",
          bank: "telebirr",
          receiverAccount: "2519****5678",
          matchedSettlementAccount: "251912345678",
          matchedUserBankAccountId: "ba_123",
          matchedBusinessBankAccountId: null,
          candidateCount: 1,
          ambiguous: false,
          reason: "receiver_mask_matches_visible_digits",
        },
      },
    ],
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    verification: {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      processingStatus: "completed",
      status: "success",
      verified: true,
    },
    links: {
      statusUrl: "/api/verify/550e8400-e29b-41d4-a716-446655440000",
    },
    ...overrides,
  };
}

describe("initializeTransaction", () => {
  it("returns payment instructions with configured channels", async () => {
    const client = createMockClient();
    const provider = createVerifyEtProvider(client, mockChannels);

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
    expect(result.paymentInstructions!.channels[0]!.accountHolder).toBe("Telebirr");
    expect(result.paymentInstructions!.channels[1]!.accountHolder).toBe("CBE");
    expect(result.txRef).toBe("tx_test");
  });
});

describe("verifyTransaction", () => {
  it("sends normalized ref and settlementAccount to client", async () => {
    const verify = vi.fn().mockResolvedValue(successResponse());
    const client = createMockClient({ verify });
    const provider = createVerifyEtProvider(client, mockChannels);

    await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/ABCD1234",
      undefined,
      "telebirr",
    );

    expect(verify).toHaveBeenCalledWith("ABCD1234", {
      waitMs: 15000,
      subscriptionId: undefined,
      settlementAccount: "251912345678",
    });
  });

  it("verifies a valid receipt with settlement match", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue(successResponse()),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/ABCD1234",
      undefined,
      "telebirr",
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.amount).toBe(10000);
    expect(result.currency).toBe("ETB");
    expect(result.providerTxRef).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("verifies a valid CBE receipt", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue(
        successResponse({
          data: [
            {
              bank: "cbe",
              status: "success",
              verified: true,
              amount: 1500,
              currency: "ETB",
              senderName: "Abebe Kebede",
              receiverName: "CBE",
              receiverAccount: "1****7441",
              referenceNumber: "FT1234567890",
              accountSuffix: "7441",
              timestamp: "2026-07-27T12:00:00.000Z",
              confirmationHistory: {
                scope: "platform",
                isFirstConfirmation: true,
                confirmedBefore: false,
                firstConfirmedAt: "2026-07-27T12:00:00.000Z",
                lastConfirmedAt: "2026-07-27T12:00:00.000Z",
                confirmationCount: 1,
              },
              settlementAccountMatch: {
                matched: true,
                matchType: "exact_match",
                matchConfidence: "high",
                source: "account_registry",
                bank: "cbe",
                receiverAccount: "1****7441",
                matchedSettlementAccount: "1000001234567",
                matchedUserBankAccountId: "ba_456",
                matchedBusinessBankAccountId: null,
                candidateCount: 1,
                ambiguous: false,
                reason: "receiver_account_exact_match",
              },
            },
          ],
        }),
      ),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://apps.cbe.com.et:100/?id=FT1234567890-7441",
      undefined,
      "cbe",
    );

    expect(result.success).toBe(true);
    expect(result.amount).toBe(150000);
    expect(result.currency).toBe("ETB");
  });

  it("fails when receipt is not verified", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue(
        successResponse({
          data: [
            {
              bank: "telebirr",
              status: "not_found",
              verified: false,
            },
          ],
          verification: {
            requestId: "abc",
            processingStatus: "completed",
            status: "not_found",
            verified: false,
          },
        }),
      ),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://transactioninfo.ethiotelecom.et/receipt/INVALID",
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("returns pending on queued verification (202)", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue(
        successResponse({
          data: [],
          verification: {
            requestId: "abc",
            processingStatus: "queued",
            status: "pending",
            verified: false,
          },
          statusUrl: "/api/verify/abc",
          estimatedWaitMs: 5000,
        }),
      ),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    const result = await provider.verifyTransaction("https://example.com/receipt");

    expect(result.success).toBe(false);
    expect(result.status).toBe("pending");
  });

  it("rejects when settlement account does not match", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue(
        successResponse({
          data: [
            {
              bank: "telebirr",
              status: "success",
              verified: true,
              amount: 100,
              currency: "ETB",
              receiverAccount: "2519****9999",
              settlementAccountMatch: {
                matched: false,
                matchType: "unmatched",
                matchConfidence: "none",
                source: "account_registry",
                bank: "telebirr",
                receiverAccount: "2519****9999",
                matchedSettlementAccount: null,
                matchedUserBankAccountId: null,
                matchedBusinessBankAccountId: null,
                candidateCount: 1,
                ambiguous: false,
                reason: "candidate_account_mismatch",
              },
            },
          ],
        }),
      ),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://example.com/receipt",
      undefined,
      "telebirr",
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe(
      "The receipt doesn't match the account configured for Telebirr. Make sure you paid to the correct account.",
    );
  });

  it("rejects with dashboard message when settlementMatch absent and no channelType", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue(
        successResponse({
          data: [
            {
              bank: "telebirr",
              status: "success",
              verified: true,
              amount: 100,
            },
          ],
        }),
      ),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    const result = await provider.verifyTransaction("https://example.com/receipt");

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Settlement matching unavailable. Please register your settlement accounts in the Verify.et dashboard and try again.",
    );
  });

  it("rejects with channel-specific message when settlementMatch absent and channelType provided", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue(
        successResponse({
          data: [
            {
              bank: "telebirr",
              status: "success",
              verified: true,
              amount: 100,
            },
          ],
        }),
      ),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    const result = await provider.verifyTransaction(
      "https://example.com/receipt",
      undefined,
      "telebirr",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Settlement matching didn't return a result for your account. Try again or contact support.",
    );
  });

  it("throws VerifyEtError on auth failure", async () => {
    const client = createMockClient({
      verify: vi.fn().mockRejectedValue(new VerifyEtApiError("Bad key", 401, "invalid_api_key")),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    await expect(provider.verifyTransaction("https://example.com/receipt")).rejects.toThrow(
      VerifyEtError,
    );
  });

  it("re-throws VerifyEtApiError as VerifyEtError with matching code", async () => {
    const client = createMockClient({
      verify: vi
        .fn()
        .mockRejectedValue(new VerifyEtApiError("Out of credits", 402, "insufficient_credits")),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    await expect(provider.verifyTransaction("https://example.com/receipt")).rejects.toMatchObject({
      code: "VERIFYET_INSUFFICIENT_CREDITS",
    });
  });

  it("throws VerifyEtError with TIMEOUT_ERROR on AbortError", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const client = createMockClient({
      verify: vi.fn().mockRejectedValue(abortError),
    });
    const provider = createVerifyEtProvider(client, mockChannels);

    await expect(provider.verifyTransaction("https://example.com/receipt")).rejects.toMatchObject({
      code: "VERIFYET_TIMEOUT_ERROR",
    });
  });
});

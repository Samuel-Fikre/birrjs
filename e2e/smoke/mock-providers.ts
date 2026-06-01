import type { PaymentProviderConfig } from "@birrjs/core";

export function mockChapaProvider(callbackUrl: string): PaymentProviderConfig {
  return {
    id: "chapa",
    kind: "chapa",
    secretKey: "test_sk_mock",
    callbackUrl,
    testMode: true,
    runtime: {
      initializeTransaction: async () => ({
        success: true,
        checkoutUrl: "https://checkout.chapa.co/mock",
        txRef: `mock_tx_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }),
      verifyTransaction: async () => ({
        success: true,
        status: "success",
        amount: 1000,
        currency: "ETB",
        email: "test@example.com",
        txRef: "mock_tx_ref",
        mode: "test",
      }),
      handleWebhook: async (payload: unknown) => {
        const data = payload as Record<string, unknown>;
        return {
          providerReferenceId: String(data?.tx_ref ?? "mock_ref"),
          type: String(data?.event ?? "charge.success"),
          payload: data,
        };
      },
    },
  };
}

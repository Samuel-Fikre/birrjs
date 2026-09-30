import type { PaymentProviderConfig } from "@birrjs/core";
import { createTelebirrProvider } from "@birrjs/telebirr";
import type { TelebirrClient } from "@birrjs/telebirr";

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

export interface TelebirrMock {
  config: PaymentProviderConfig;
  setOrderStatus: (merchantOrderId: string, status: string) => void;
}

export function mockTelebirrProvider(callbackUrl: string): TelebirrMock {
  const orders = new Map<string, { status: string; amount: string }>();

  const client: TelebirrClient = {
    getFabricToken: async () => "mock-token",
    createPayment: async (input) => {
      const merchantOrderId = input.merchantOrderId ?? `mock_${Date.now()}`;
      orders.set(merchantOrderId, { status: "PAY_SUCCESS", amount: input.amount });
      return {
        merchantOrderId,
        prepayId: `prepay_mock_${merchantOrderId}`,
        checkoutUrl: "https://checkout.ethiomobilemoney.et/mock",
      };
    },
    queryOrder: async (merchantOrderId) => {
      const order = orders.get(merchantOrderId) ?? { status: "PAY_FAILED", amount: "0.00" };
      return {
        result: "SUCCESS",
        biz_content: {
          order_status: order.status,
          total_amount: order.amount,
          trans_currency: "ETB",
          payment_order_id: `tele_mock_${merchantOrderId}`,
        },
      };
    },
  };

  const base: PaymentProviderConfig = {
    id: "telebirr",
    kind: "telebirr",
    secretKey: "test_mock_secret",
    callbackUrl,
  };

  return {
    config: {
      ...base,
      runtime: createTelebirrProvider(client, base),
    },
    setOrderStatus: (merchantOrderId, status) => {
      const order = orders.get(merchantOrderId);
      if (order) order.status = status;
    },
  };
}

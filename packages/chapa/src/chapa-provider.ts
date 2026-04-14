import type { NormalizedWebhookEvent } from "@birrjs/core";

import type { ChapaClient } from "./client";
import type { ChapaProviderConfig, ChapaRuntime } from "./types";
import { ChapaError, CHAPA_ERROR_CODES } from "./errors";

export function createChapaProvider(
  client: ChapaClient,
  config: ChapaProviderConfig,
): ChapaRuntime {
  const currency = config.currency ?? "ETB";

  return {
    async upsertCustomer(data) {
      // Chapa doesn't have customer management - return mock customer ID
      return {
        providerCustomer: {
          id: data.id,
          frozenTime: data.createTestClock ? new Date().toISOString() : undefined,
          testClockId: data.createTestClock ? `clock-${data.id}` : undefined,
        },
      };
    },

    async deleteCustomer(data) {
      // Chapa doesn't have customer management - no-op
      return;
    },

    async getTestClock(data) {
      // Chapa doesn't support test clocks - throw error
      throw ChapaError.from(
        "Chapa does not support test clocks",
        CHAPA_ERROR_CODES.TEST_CLOCK_NOT_SUPPORTED,
      );
    },

    async advanceTestClock(data) {
      // Chapa doesn't support test clocks - throw error
      throw ChapaError.from(
        "Chapa does not support test clocks",
        CHAPA_ERROR_CODES.TEST_CLOCK_NOT_SUPPORTED,
      );
    },

    async attachPaymentMethod(data) {
      // Chapa doesn't have payment method management - throw error
      throw ChapaError.from(
        "Chapa does not support payment method management",
        CHAPA_ERROR_CODES.PAYMENT_METHOD_NOT_SUPPORTED,
      );
    },

    async createSubscriptionCheckout(data) {
      // Use Chapa's transaction initialize for subscription checkout
      const txRef = `sub-${data.providerCustomerId}-${Date.now()}`;

      // Chapa requires amount - get from metadata (temporary workaround)
      const amount = data.metadata?.amount;
      if (!amount) {
        throw ChapaError.from(
          "'amount' is missing in metadata. Since Chapa is a stateless gateway, you must provide the amount in the checkout call via metadata.amount",
          CHAPA_ERROR_CODES.AMOUNT_REQUIRED,
        );
      }

      const response = await client.initializeTransaction({
        amount,
        currency,
        email: config.fallbackCustomer?.email ?? "",
        first_name: config.fallbackCustomer?.firstName ?? "",
        last_name: config.fallbackCustomer?.lastName ?? "",
        tx_ref: txRef,
        callback_url: config.callbackUrl,
        return_url: data.successUrl,
        customization: {
          title: "Subscription Payment",
          description: "Subscription payment via Chapa",
        },
      });

      if (!response.data || !response.data.checkout_url) {
        throw ChapaError.from(
          "Chapa failed to create checkout session",
          CHAPA_ERROR_CODES.CHECKOUT_SESSION_FAILED,
        );
      }

      return {
        paymentUrl: response.data.checkout_url,
        providerCheckoutSessionId: txRef,
      };
    },

    async createSubscription(data) {
      // Chapa doesn't have subscription management - throw error
      throw ChapaError.from(
        "Chapa does not support direct subscription creation. Use createSubscriptionCheckout instead.",
        CHAPA_ERROR_CODES.SUBSCRIPTION_NOT_SUPPORTED,
      );
    },

    async updateSubscription(data) {
      // Chapa doesn't have subscription management - throw error
      throw ChapaError.from(
        "Chapa does not support subscription updates. PayKit handles subscription logic.",
        CHAPA_ERROR_CODES.SUBSCRIPTION_UPDATE_NOT_SUPPORTED,
      );
    },

    async createInvoice(data) {
      // Use Chapa's transaction initialize for invoice payment
      const totalAmount = data.lines.reduce((sum, line) => sum + line.amount, 0);

      const response = await client.initializeTransaction({
        amount: totalAmount.toString(),
        currency,
        email: config.fallbackCustomer?.email ?? "",
        first_name: config.fallbackCustomer?.firstName ?? "",
        last_name: config.fallbackCustomer?.lastName ?? "",
        tx_ref: `invoice-${data.providerCustomerId}-${Date.now()}`,
        callback_url: config.callbackUrl,
        return_url: "",
        customization: {
          title: "Invoice Payment",
          description: "Invoice payment via Chapa",
        },
      });

      if (!response.data) {
        throw ChapaError.from("Chapa failed to create invoice", CHAPA_ERROR_CODES.INVOICE_FAILED);
      }

      return {
        currency,
        hostedUrl: response.data.checkout_url ?? null,
        periodEndAt: null,
        periodStartAt: null,
        providerInvoiceId: response.data.checkout_url ?? "",
        status: response.status,
        totalAmount,
      };
    },

    async scheduleSubscriptionChange(data) {
      // Chapa doesn't have subscription schedules - throw error
      throw ChapaError.from(
        "Chapa does not support subscription schedules. PayKit handles renewal logic.",
        CHAPA_ERROR_CODES.SUBSCRIPTION_SCHEDULE_NOT_SUPPORTED,
      );
    },

    async cancelSubscription(data) {
      // Chapa doesn't have subscription management - no-op (PayKit handles cancellation)
      return {
        invoice: null,
        paymentUrl: null,
        requiredAction: null,
        subscription: {
          cancelAtPeriodEnd: true,
          canceledAt: data.currentPeriodEndAt ?? null,
          currentPeriodEndAt: data.currentPeriodEndAt ?? null,
          currentPeriodStartAt: null,
          endedAt: null,
          providerPriceId: null,
          providerSubscriptionId: data.providerSubscriptionId,
          providerSubscriptionScheduleId: data.providerSubscriptionScheduleId ?? null,
          status: "canceled",
        },
      };
    },

    async listActiveSubscriptions(data) {
      // Chapa doesn't have subscription management - return empty (PayKit tracks subscriptions)
      return [];
    },

    async resumeSubscription(data) {
      // Chapa doesn't have subscription management - no-op (PayKit handles resumption)
      return {
        invoice: null,
        paymentUrl: null,
        requiredAction: null,
        subscription: {
          cancelAtPeriodEnd: false,
          canceledAt: null,
          currentPeriodEndAt: null,
          currentPeriodStartAt: null,
          endedAt: null,
          providerPriceId: null,
          providerSubscriptionId: data.providerSubscriptionId,
          providerSubscriptionScheduleId: data.providerSubscriptionScheduleId ?? null,
          status: "active",
        },
      };
    },

    async detachPaymentMethod(data) {
      // Chapa doesn't have payment method management - no-op
      return;
    },

    async syncProduct(data) {
      // Chapa doesn't have product management - return mock IDs (PayKit tracks products)
      return {
        providerProductId: data.existingProviderProductId ?? `product-${data.id}`,
        providerPriceId: data.existingProviderPriceId ?? `price-${data.id}`,
      };
    },

    async handleWebhook(data) {
      // Parse Chapa webhook and convert to NormalizedWebhookEvent[]
      const event = JSON.parse(data.body) as {
        event: string;
        tx_ref: string;
        status: string;
        amount: string;
      };

      // Verify the transaction with Chapa API to prevent spoofing
      const verification = await client.verifyTransaction(event.tx_ref);

      if (verification.status !== "success") {
        return [];
      }

      // Convert to NormalizedWebhookEvent
      const normalizedEvent: NormalizedWebhookEvent = {
        name: "payment.succeeded",
        payload: {
          providerEventId: event.tx_ref,
          payment: {
            amount: parseFloat(event.amount),
            createdAt: new Date(),
            currency: "ETB",
            description: "Payment via Chapa",
            metadata: {},
            providerPaymentId: event.tx_ref,
            providerMethodId: "",
            status: "succeeded",
          },
          providerCustomerId: verification.data?.tx_ref ?? "",
        },
        actions: [
          {
            type: "payment.upsert",
            data: {
              payment: {
                amount: parseFloat(event.amount),
                createdAt: new Date(),
                currency: "ETB",
                description: "Payment via Chapa",
                metadata: {},
                providerPaymentId: event.tx_ref,
                providerMethodId: "",
                status: "succeeded",
              },
              providerCustomerId: verification.data?.tx_ref ?? "",
            },
          },
        ],
      };

      return [normalizedEvent];
    },

    async createPortalSession(data) {
      // Chapa doesn't have a customer portal - throw error
      throw ChapaError.from(
        "Chapa does not support customer portal",
        CHAPA_ERROR_CODES.PORTAL_NOT_SUPPORTED,
      );
    },
  };
}

export function chapa(config: ChapaProviderConfig): ChapaProviderConfig {
  return {
    ...config,
    id: config.id,
    kind: "chapa",
  };
}

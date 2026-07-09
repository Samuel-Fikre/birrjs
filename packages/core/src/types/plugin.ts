import type { NormalizedPlan } from "../plans/schema";
import type { PaymentInstructions } from "../provider";
import type { BirrJSPluginEventHandlers } from "./events";

export interface BeforeSubscribeHookCtx {
  readonly customerId: string;
  readonly plan: NormalizedPlan;
  readonly customerEmail?: string;
  readonly ip?: string;
}

export interface CheckoutReadyHookCtx {
  readonly customerId: string;
  readonly planId: string;
  readonly subscriptionId: string;
  readonly checkoutUrl: string;
  readonly txRef: string;
}

export interface PaymentReadyHookCtx {
  readonly customerId: string;
  readonly planId: string;
  readonly subscriptionId: string;
  readonly paymentInstructions: PaymentInstructions;
  readonly txRef: string;
}

export interface BirrJSPlugin {
  id: string;
  endpoints?: Record<string, unknown>;
  onBeforeSubscribe?: (hookCtx: BeforeSubscribeHookCtx) => Promise<void>;
  onCheckoutReady?: (hookCtx: CheckoutReadyHookCtx) => Promise<void>;
  onPaymentReady?: (hookCtx: PaymentReadyHookCtx) => Promise<void>;
  onEvent?: BirrJSPluginEventHandlers;
}

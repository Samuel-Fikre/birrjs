import type { NormalizedPlan } from "../plans/schema";

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

export interface BirrJSPlugin {
  id: string;
  endpoints?: Record<string, unknown>;
  onBeforeSubscribe?: (hookCtx: BeforeSubscribeHookCtx) => Promise<void>;
  onCheckoutReady?: (hookCtx: CheckoutReadyHookCtx) => Promise<void>;
}

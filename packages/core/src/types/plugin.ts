import type { Endpoint } from "better-call";

import type { NormalizedPlan } from "../plans/schema";
import type { PaymentInstructions } from "../provider";
import type { PlanChangeQuote } from "../subscription/plan-change";
import type { BirrJSPluginEventHandlers } from "./events";
import type { BirrJSQueries } from "./queries";

export interface BeforeSubscribeResult {
  isTrialEligible?: boolean;
}

export interface BeforeSubscribeHookCtx {
  readonly customerId: string;
  readonly plan: NormalizedPlan;
  readonly customerEmail?: string;
  readonly customerPhone?: string;
  readonly ip?: string;
  readonly fingerprint?: string;
  readonly queries: BirrJSQueries;
}

export interface CheckoutReadyHookCtx {
  readonly customerId: string;
  readonly plan: NormalizedPlan;
  readonly planId: string;
  readonly subscriptionId: string;
  readonly checkoutUrl: string;
  readonly txRef: string;
}

export interface PaymentReadyHookCtx {
  readonly customerId: string;
  readonly plan: NormalizedPlan;
  readonly planId: string;
  readonly subscriptionId: string;
  readonly paymentInstructions: PaymentInstructions;
  readonly txRef: string;
}

export interface BeforePlanChangeHookCtx {
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly fromPlan: NormalizedPlan;
  readonly toPlan: NormalizedPlan;
  readonly quote: PlanChangeQuote;
}

export interface BirrJSPlugin {
  id: string;
  endpoints?: Record<string, Endpoint>;
  onBeforeSubscribe?: (hookCtx: BeforeSubscribeHookCtx) => Promise<void | BeforeSubscribeResult>;
  /** Fail-closed gate: a throw, or a timeout, aborts the plan change before anything is written. */
  onBeforePlanChange?: (hookCtx: BeforePlanChangeHookCtx) => Promise<void>;
  onCheckoutReady?: (hookCtx: CheckoutReadyHookCtx) => Promise<void>;
  onPaymentReady?: (hookCtx: PaymentReadyHookCtx) => Promise<void>;
  onEvent?: BirrJSPluginEventHandlers;
}

import { createRouter, type Endpoint } from "better-call";

import type { BirrJSContext } from "../context";
import type { BirrJSOptions } from "../types";
import type { BirrJSClientMethods, GenerateBirrJSAPI } from "../types/instance";
// Cron methods
import {
  checkPendingSubscriptionsEndpoint,
  checkExpiredSubscriptionsEndpoint,
} from "./cron/cron.api";
// Customer methods
import {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomer,
  getCustomerWithDetailsEndpoint,
  deleteCustomer,
} from "./customer/customer.api";
// Entitlement methods
import {
  check as checkEntitlement,
  report as reportEntitlement,
} from "./entitlement/entitlement.api";
// Plan methods
import { listPlans } from "./plan/plan.api";
// Subscription methods
import {
  subscribe,
  listSubscriptions,
  cancelSubscriptionEndpoint,
  getSubscription,
  checkSubscription,
} from "./subscription/subscription.api";
// Webhook methods
import { handleWebhook } from "./webhook/webhook.api";

export const methods = {
  subscribe,
  listSubscriptions,
  cancelSubscription: cancelSubscriptionEndpoint,
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomer,
  getCustomerWithDetails: getCustomerWithDetailsEndpoint,
  deleteCustomer,
  listPlans,
  getSubscription,
  checkSubscription,
  checkEntitlement,
  reportEntitlement,
  handleWebhook,
  checkPendingSubscriptions: checkPendingSubscriptionsEndpoint,
  checkExpiredSubscriptions: checkExpiredSubscriptionsEndpoint,
} as const;

export type Methods = typeof methods;

export type BirrJSClientAPI<TOptions extends BirrJSOptions = BirrJSOptions> = BirrJSClientMethods<
  Methods,
  TOptions
>;

export type BirrJSAPI<TOptions extends BirrJSOptions = BirrJSOptions> = GenerateBirrJSAPI<
  Methods,
  TOptions
>;

export function wrapMethods<TMethods extends Record<string, unknown>>(
  source: TMethods,
  ctx: BirrJSContext | Promise<BirrJSContext>,
): GenerateBirrJSAPI<TMethods, BirrJSOptions> {
  const wrapped = Object.fromEntries(
    (Object.entries(source) as Array<[keyof TMethods, TMethods[keyof TMethods]]>).map(
      ([key, method]) => {
        const fn = async (input: unknown) => {
          const resolved = await ctx;
          return (method as unknown as (...args: unknown[]) => Promise<unknown>)(resolved, input);
        };
        return [key, fn];
      },
    ),
  );
  return wrapped as GenerateBirrJSAPI<TMethods>;
}

// Type-safe API helper
export function getApi(getContext: () => Promise<BirrJSContext>) {
  return wrapMethods(methods, getContext());
}

function getRouteEndpoints<TMethods extends Record<string, { endpoint?: Endpoint }>>(
  source: TMethods,
): Record<string, Endpoint> {
  return Object.fromEntries(
    (Object.entries(source) as Array<[keyof TMethods, TMethods[keyof TMethods]]>).flatMap(
      ([key, method]) => (method.endpoint ? [[key, method.endpoint]] : []),
    ),
  ) as Record<string, Endpoint>;
}

export function createBirrJSRouter(ctx: BirrJSContext, options: BirrJSOptions) {
  const routeEndpoints = getRouteEndpoints(
    methods as unknown as Record<string, { endpoint?: Endpoint }>,
  );

  return createRouter(routeEndpoints, {
    basePath: options.basePath ?? "/api",
    routerContext: ctx,
    onError(error) {
      ctx.logger.error({ err: error }, "API error");
    },
  });
}

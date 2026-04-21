import { createRouter, type Endpoint } from "better-call";
import type { BirrJSContext } from "../context";
import type { BirrJSOptions } from "../types";
import type {
  SubscribeRequest,
  CancelSubscriptionRequest,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  GetSubscriptionRequest,
  CheckSubscriptionRequest,
  GetCustomerRequest,
  WebhookRequest,
} from "../index";

// Subscription methods
import {
  subscribe,
  listSubscriptions,
  cancelSubscriptionEndpoint,
  getSubscription,
  checkSubscription,
} from "./subscription/subscription.api";

// Customer methods
import {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomer,
} from "./customer/customer.api";

// Plan methods
import { listPlans } from "./plan/plan.api";

// Webhook methods
import { handleWebhook } from "./webhook/webhook.api";

// Cron methods
import {
  checkPendingSubscriptions,
  checkExpiredSubscriptions,
  checkPendingSubscriptionsEndpoint,
  checkExpiredSubscriptionsEndpoint,
} from "./cron/cron.api";

// Type-safe API helper
export function getApi(getContext: () => Promise<BirrJSContext>) {
  return {
    subscribe: (input: SubscribeRequest) => getContext().then((ctx) => subscribe(ctx, input)),
    listSubscriptions: (input?: { limit?: number; offset?: number }) => {
      const { limit = 20, offset = 0 } = input || {};
      return getContext().then((ctx) => listSubscriptions(ctx, { limit, offset }));
    },
    cancelSubscription: (input: CancelSubscriptionRequest) =>
      getContext().then((ctx) => cancelSubscriptionEndpoint(ctx, input)),
    createCustomer: (input: CreateCustomerRequest) =>
      getContext().then((ctx) => createCustomer(ctx, input)),
    updateCustomer: (input: UpdateCustomerRequest) =>
      getContext().then((ctx) => updateCustomer(ctx, input)),
    listCustomers: (input?: { limit?: number; offset?: number }) => {
      const { limit = 20, offset = 0 } = input || {};
      return getContext().then((ctx) => listCustomers(ctx, { limit, offset }));
    },
    listPlans: (input?: { limit?: number; offset?: number }) => {
      const { limit = 20, offset = 0 } = input || {};
      return getContext().then((ctx) => listPlans(ctx, { limit, offset }));
    },
    getSubscription: (input: GetSubscriptionRequest) =>
      getContext().then((ctx) => getSubscription(ctx, input)),
    checkSubscription: (input: CheckSubscriptionRequest) =>
      getContext().then((ctx) => checkSubscription(ctx, input)),
    getCustomer: (input: GetCustomerRequest) => getContext().then((ctx) => getCustomer(ctx, input)),
    handleWebhook: (input: WebhookRequest) => getContext().then((ctx) => handleWebhook(ctx, input)),
    checkPendingSubscriptions: () => getContext().then((ctx) => checkPendingSubscriptions(ctx)),
    checkExpiredSubscriptions: () => getContext().then((ctx) => checkExpiredSubscriptions(ctx)),
    checkPendingSubscriptionsEndpoint: () =>
      getContext().then((ctx) => checkPendingSubscriptionsEndpoint(ctx, {})),
    checkExpiredSubscriptionsEndpoint: () =>
      getContext().then((ctx) => checkExpiredSubscriptionsEndpoint(ctx, {})),
  };
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
  const methods = {
    subscribe,
    listSubscriptions,
    cancelSubscription: cancelSubscriptionEndpoint,
    createCustomer,
    updateCustomer,
    listCustomers,
    getCustomer,
    listPlans,
    getSubscription,
    checkSubscription,
    handleWebhook,
    checkPendingSubscriptions: checkPendingSubscriptionsEndpoint,
    checkExpiredSubscriptions: checkExpiredSubscriptionsEndpoint,
  };

  const routeEndpoints = getRouteEndpoints(methods as Record<string, { endpoint?: Endpoint }>);

  return createRouter(routeEndpoints, {
    basePath: options.basePath ?? "/api",
    routerContext: ctx,
    onError(error) {
      ctx.logger.error({ err: error }, "API error");
    },
  });
}

import type { BirrJSContext } from "../context";
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
import { checkPendingSubscriptions, checkExpiredSubscriptions } from "./cron/cron.api";

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
  };
}

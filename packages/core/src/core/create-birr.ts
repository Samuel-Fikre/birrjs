import { Pool } from "pg";

import type { BirrJSContext } from "../context";
import { createContext } from "../context";
import type {
  SubscribeRequest,
  SubscribeResponse,
  ListSubscriptionsResponse,
  CancelSubscriptionRequest,
  CancelSubscriptionResponse,
  CreateCustomerRequest,
  CreateCustomerResponse,
  UpdateCustomerRequest,
  UpdateCustomerResponse,
  ListCustomersResponse,
  ListPlansResponse,
  GetSubscriptionRequest,
  GetSubscriptionResponse,
  CheckSubscriptionRequest,
  CheckSubscriptionResponse,
  GetCustomerRequest,
  GetCustomerResponse,
  WebhookRequest,
  WebhookResponse,
} from "../index";
import type { PlanIdFromOptions, FeatureIdFromOptions } from "../plans/schema";
import { syncPlans } from "../plans/sync";
import { getApi, createBirrJSRouter } from "../server";
import type { BirrJSOptions } from "../types";

const birrInstanceSymbol = Symbol.for("birr.instance");

export interface BirrInstance<TOptions extends BirrJSOptions = BirrJSOptions> {
  options: TOptions;
  subscribe: (input: SubscribeRequest) => Promise<SubscribeResponse>;
  listSubscriptions: (input?: {
    limit?: number;
    offset?: number;
  }) => Promise<ListSubscriptionsResponse>;
  cancelSubscription: (input: CancelSubscriptionRequest) => Promise<CancelSubscriptionResponse>;
  createCustomer: (input: CreateCustomerRequest) => Promise<CreateCustomerResponse>;
  updateCustomer: (input: UpdateCustomerRequest) => Promise<UpdateCustomerResponse>;
  listCustomers: (input?: { limit?: number; offset?: number }) => Promise<ListCustomersResponse>;
  listPlans: (input?: { limit?: number; offset?: number }) => Promise<ListPlansResponse>;
  getSubscription: (input: GetSubscriptionRequest) => Promise<GetSubscriptionResponse>;
  checkSubscription: (input: CheckSubscriptionRequest) => Promise<CheckSubscriptionResponse>;
  getCustomer: (input: GetCustomerRequest) => Promise<GetCustomerResponse>;
  handleWebhook: (input: WebhookRequest) => Promise<WebhookResponse>;
  checkPendingSubscriptions: () => Promise<{ checked: number; updated: number }>;
  checkExpiredSubscriptions: () => Promise<{ checked: number; updated: number }>;
  checkPendingSubscriptionsEndpoint: () => Promise<{
    success: boolean;
    checked?: number;
    updated?: number;
    message?: string;
  }>;
  checkExpiredSubscriptionsEndpoint: () => Promise<{
    success: boolean;
    checked?: number;
    updated?: number;
    message?: string;
  }>;
  handler: (request: Request) => Promise<Response>;
  $context: Promise<BirrJSContext>;
  $infer: {
    planId: PlanIdFromOptions<TOptions>;
    featureId: FeatureIdFromOptions<TOptions>;
  };
  close: () => Promise<void>;
}

export function isBirrInstance<TOptions extends BirrJSOptions = BirrJSOptions>(
  value: unknown,
): value is BirrInstance<TOptions> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[birrInstanceSymbol] === true
  );
}

async function initContext(options: BirrJSOptions): Promise<BirrJSContext> {
  const pool =
    typeof options.database === "string"
      ? new Pool({ connectionString: options.database })
      : options.database;
  return createContext({ ...options, database: pool });
}

export function createBirr<TOptions extends BirrJSOptions>(
  options: TOptions,
): BirrInstance<TOptions> {
  let contextPromise: Promise<BirrJSContext> | undefined;
  const getContext = () => {
    contextPromise ??= initContext(options);
    return contextPromise;
  };

  const api = getApi(getContext);

  // Sync code-first plans to database
  if (options.plans && options.plans.length > 0) {
    getContext()
      .then((ctx) => syncPlans(ctx, options.plans!))
      .catch((err) => {
        console.warn("BirrJS: Plan sync failed on startup.", err);
      });
  }

  const birr: BirrInstance<TOptions> = {
    options,
    ...api,
    async handler(request: Request) {
      const ctx = await getContext();
      const router = createBirrJSRouter(ctx, options);
      return router.handler(request);
    },
    get $context() {
      return getContext();
    },
    $infer: undefined as never,
    close: async () => {
      const ctx = await getContext();
      await ctx.destroy();
    },
  };

  Object.defineProperty(birr, birrInstanceSymbol, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return birr as BirrInstance<TOptions>;
}

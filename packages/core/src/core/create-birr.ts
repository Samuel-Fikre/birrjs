import { Pool } from "pg";
import type { BirrJSContext } from "../context";
import type { BirrJSOptions } from "../types";
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
import { createContext } from "../context";
import { getApi } from "../server";

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
  checkSubscription: (
    input: CheckSubscriptionRequest,
  ) => Promise<{
    allowed: boolean;
    effectiveStatus: "pending" | "active" | "canceled" | "failed" | "expired" | "none";
  }>;
  getCustomer: (input: GetCustomerRequest) => Promise<GetCustomerResponse>;
  handleWebhook: (input: WebhookRequest) => Promise<WebhookResponse>;
  checkPendingSubscriptions: () => Promise<{ checked: number; updated: number }>;
  checkExpiredSubscriptions: () => Promise<{ checked: number; updated: number }>;
  $context: Promise<BirrJSContext>;
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

  const birr: BirrInstance = {
    options,
    ...api,
    get $context() {
      return getContext();
    },
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

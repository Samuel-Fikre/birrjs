import type { Subscription } from "../../types/models";
import {
  createSubscription,
  cancelSubscription as cancelSubscriptionLogic,
} from "../../subscription";
import { getEffectiveStatus } from "../../subscription/effective-status";
import { defineBirrJSMethod } from "../../api/endpoint";
import {
  SubscribeRequestSchema,
  CancelSubscriptionRequestSchema,
  GetSubscriptionRequestSchema,
  CheckSubscriptionRequestSchema,
} from "../../api/schemas";
import { plan, subscription, customer } from "../../database/schema";
import { eq, desc, count, and } from "drizzle-orm";
import type { TransactionRequest } from "../../provider";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import * as z from "zod";

/**
 * Subscribe to a plan
 */
export const subscribe = defineBirrJSMethod(
  {
    input: SubscribeRequestSchema,
    route: {
      method: "POST",
      path: "/subscribe",
    },
  },
  async (ctx) => {
    const { planId, email, name, metadata } = ctx.input;
    const { database, runtime } = ctx.birrjs;

    // Check if plan exists
    const plans = await database.select().from(plan).where(eq(plan.id, planId)).limit(1);
    const planRecord = plans[0];
    if (!planRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_NOT_FOUND);
    }

    // Find or create customer
    // Create customer with upsert pattern to prevent race conditions
    const customerId = `cus_${crypto.randomUUID()}`;
    const newCustomer = {
      id: customerId,
      email,
      name: name || null,
      metadata: (metadata as Record<string, string>) || null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await database
      .insert(customer)
      .values(newCustomer)
      .onConflictDoNothing({ target: customer.email });

    const customers = await database
      .select()
      .from(customer)
      .where(eq(customer.email, email))
      .limit(1);
    const customerRecord = customers[0];

    // Create subscription
    const subscriptionId = `sub_${crypto.randomUUID()}`;

    // Initialize payment with provider
    const txRef = `tx_${crypto.randomUUID()}`;

    // Store subscription in database with status "pending"
    const newSubscription = {
      ...createSubscription({
        id: subscriptionId,
        customerId: customerRecord!.id,
        planId: planRecord.id,
        interval:
          (planRecord.priceInterval as "monthly" | "yearly" | "weekly" | "daily") || "monthly",
      }),
      cancelAtPeriodEnd: false,
      providerTxRef: txRef,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await database.insert(subscription).values(newSubscription);

    const transactionRequest: TransactionRequest = {
      amount: planRecord.priceAmount || 0,
      currency: planRecord.currency || "ETB",
      email: email,
      txRef,
      callbackUrl: ctx.birrjs.options.callbackUrl,
    };

    let transaction;
    try {
      transaction = await runtime.initializeTransaction(transactionRequest);
    } catch (error) {
      // Update subscription to failed on error
      await database
        .update(subscription)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(subscription.id, subscriptionId));
      throw error;
    }

    if (!transaction.checkoutUrl) {
      throw BirrJSError.from(
        "INTERNAL_SERVER_ERROR",
        BIRRJS_ERROR_CODES.TRANSACTION_INVALID_RESPONSE,
      );
    }

    return {
      checkoutUrl: transaction.checkoutUrl,
      subscriptionId,
      customerId: customerRecord!.id,
    };
  },
);

/**
 * List subscriptions
 */
export const listSubscriptions = defineBirrJSMethod(
  {
    input: z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
    requireCustomer: true,
    route: {
      method: "GET",
      path: "/list-subscriptions",
    },
  },
  async (ctx) => {
    const { database, options } = ctx.birrjs;
    const { limit = 20, offset = 0 } = ctx.input as { limit?: number; offset?: number };
    const { customerId } = ctx;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.customerId, customerId))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(subscription.createdAt));

    const totalResult = await database
      .select({ value: count() })
      .from(subscription)
      .where(eq(subscription.customerId, customerId));
    const total = totalResult[0]?.value || 0;

    const subscriptionsWithEffectiveStatus = subscriptions.map((sub) => ({
      ...sub,
      effectiveStatus: getEffectiveStatus(sub, {
        pendingTimeoutMinutes: options.scheduling?.pendingTimeoutMinutes,
      }),
    }));

    return {
      subscriptions: subscriptionsWithEffectiveStatus as (Subscription & {
        effectiveStatus: string;
      })[],
      total,
      limit,
      offset,
    };
  },
);

/**
 * Cancel subscription
 */
export const cancelSubscriptionEndpoint = defineBirrJSMethod(
  {
    input: CancelSubscriptionRequestSchema,
    requireCustomer: true,
    route: {
      method: "POST",
      path: "/cancel-subscription",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { subscriptionId, cancelAtPeriodEnd = false } = ctx.input;
    const { customerId } = ctx;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, subscriptionId), eq(subscription.customerId, customerId)))
      .limit(1);
    const subscriptionRecord = subscriptions[0];
    if (!subscriptionRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
    }

    const result = cancelSubscriptionLogic({
      currentStatus: subscriptionRecord.status as "active" | "expired" | "canceled" | "pending",
      cancelAtPeriodEnd,
      currentPeriodEndAt: subscriptionRecord.expiresAt,
    });

    await database
      .update(subscription)
      .set({
        status: result.status as string,
        canceledAt: result.canceledAt,
        endedAt: result.endedAt,
        cancelAtPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscription.id, subscriptionId));

    const updatedSubscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1);

    return {
      subscription: updatedSubscriptions[0] as Subscription,
    };
  },
);

/**
 * Get subscription
 */
export const getSubscription = defineBirrJSMethod(
  {
    input: GetSubscriptionRequestSchema,
    requireCustomer: true,
    route: {
      method: "GET",
      path: "/get-subscription",
    },
  },
  async (ctx) => {
    const { database, options } = ctx.birrjs;
    const { subscriptionId } = ctx.input;
    const { customerId } = ctx;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, subscriptionId), eq(subscription.customerId, customerId)))
      .limit(1);
    const subscriptionRecord = subscriptions[0];
    if (!subscriptionRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
    }

    const effectiveStatus = getEffectiveStatus(subscriptionRecord, {
      pendingTimeoutMinutes: options.scheduling?.pendingTimeoutMinutes,
    });

    return {
      subscription: {
        ...subscriptionRecord,
        effectiveStatus,
      } as Subscription & { effectiveStatus: string },
    };
  },
);

export const checkSubscription = defineBirrJSMethod(
  {
    input: CheckSubscriptionRequestSchema,
    route: {
      method: "POST",
      path: "/check-subscription",
    },
  },
  async (ctx) => {
    const { database, options } = ctx.birrjs;
    const { customerId } = ctx.input;

    // Get the most recent subscription for the customer
    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.customerId, customerId))
      .orderBy(desc(subscription.createdAt))
      .limit(1);

    const subscriptionRecord = subscriptions[0];

    // If no subscription, not allowed
    if (!subscriptionRecord) {
      return {
        allowed: false,
        effectiveStatus: "none" as const,
      };
    }

    // Compute effective status
    const effectiveStatus = getEffectiveStatus(subscriptionRecord, {
      pendingTimeoutMinutes: options.scheduling?.pendingTimeoutMinutes,
    });

    // Allowed only if effective status is active
    const allowed = effectiveStatus === "active";

    return {
      allowed,
      effectiveStatus,
    };
  },
);

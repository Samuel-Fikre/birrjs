import type { Subscription } from "../../types/models";
import {
  createSubscription,
  cancelSubscription as cancelSubscriptionLogic,
} from "../../subscription";
import { defineBirrJSMethod } from "../../api/endpoint";
import {
  SubscribeRequestSchema,
  CancelSubscriptionRequestSchema,
  GetSubscriptionRequestSchema,
} from "../../api/schemas";
import { plan, subscription, customer } from "../../database/schema";
import { eq, desc, count } from "drizzle-orm";
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
    const customers = await database
      .select()
      .from(customer)
      .where(eq(customer.email, email))
      .limit(1);
    let customerRecord = customers[0];

    if (!customerRecord) {
      // Create new customer
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
      await database.insert(customer).values(newCustomer);
      customerRecord = newCustomer;
    }

    // Create subscription
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const subscriptionResult = createSubscription({
      id: subscriptionId,
      customerId: customerRecord!.id,
      planId: planRecord.id,
      interval:
        (planRecord.priceInterval as "monthly" | "yearly" | "weekly" | "daily") || "monthly",
    });

    // Store subscription in database with status "pending"
    const newSubscription: Subscription = {
      id: subscriptionId,
      customerId: customerRecord!.id,
      planId: planRecord.id,
      status: subscriptionResult.status,
      startedAt: subscriptionResult.startedAt,
      expiresAt: subscriptionResult.expiresAt,
      canceledAt: subscriptionResult.canceledAt,
      endedAt: subscriptionResult.endedAt,
      cancelAtPeriodEnd: false,
      providerTxRef: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await database.insert(subscription).values(newSubscription);

    // Initialize payment with provider
    const txRef = `tx_${crypto.randomUUID()}`;
    const transactionRequest: TransactionRequest = {
      amount: planRecord.priceAmount || 0,
      currency: planRecord.currency || "ETB",
      email: customerRecord!.email || "",
      txRef,
      callbackUrl: ctx.birrjs.options.callbackUrl,
    };

    let transaction;
    try {
      transaction = await runtime.initializeTransaction(transactionRequest);

      await database
        .update(subscription)
        .set({
          providerTxRef: txRef,
          updatedAt: new Date(),
        })
        .where(eq(subscription.id, subscriptionId));
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

    return {
      checkoutUrl: transaction.checkoutUrl ?? "",
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
    route: {
      method: "GET",
      path: "/subscriptions",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { limit = 20, offset = 0 } = ctx.input as { limit?: number; offset?: number };

    const subscriptions = await database
      .select()
      .from(subscription)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(subscription.createdAt));

    const totalResult = await database.select({ value: count() }).from(subscription);
    const total = totalResult[0]?.value || 0;

    return {
      subscriptions: subscriptions as Subscription[],
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
    route: {
      method: "POST",
      path: "/subscriptions/cancel",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { subscriptionId, cancelAtPeriodEnd = false } = ctx.input;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
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
    route: {
      method: "GET",
      path: "/subscriptions/:subscriptionId",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { subscriptionId } = ctx.input;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1);
    const subscriptionRecord = subscriptions[0];
    if (!subscriptionRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
    }

    return {
      subscription: subscriptionRecord as Subscription,
    };
  },
);

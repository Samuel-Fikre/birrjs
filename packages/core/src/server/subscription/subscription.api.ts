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
import { eq } from "drizzle-orm";
import * as z from "zod";
import type { TransactionRequest } from "../../provider";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";

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
    const { database, provider } = ctx.birrjs;

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
      const customerId = `cus_${Date.now()}`;
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
    const subscriptionId = `sub_${Date.now()}`;
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
    const txRef = `tx_${Date.now()}`;
    const transactionRequest: TransactionRequest = {
      amount: planRecord.priceAmount || 0,
      currency: planRecord.currency || "ETB",
      email: customerRecord!.email || "",
      txRef,
      callbackUrl: "",
    };

    let transaction;
    try {
      transaction = await provider.initializeTransaction(transactionRequest);
      // Update subscription to active on success
      await database
        .update(subscription)
        .set({
          status: "active",
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
    route: {
      method: "GET",
      path: "/subscriptions",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const subscriptions = await database.select().from(subscription);
    return {
      subscriptions: subscriptions as Subscription[],
      total: subscriptions.length,
    };
  },
);

/**
 * Cancel subscription
 */
export const cancelSubscriptionEndpoint = defineBirrJSMethod(
  {
    route: {
      method: "POST",
      path: "/subscriptions/cancel",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { subscriptionId, cancelAtPeriodEnd = false } = ctx.input as z.infer<
      typeof CancelSubscriptionRequestSchema
    >;

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
    route: {
      method: "GET",
      path: "/subscriptions/:subscriptionId",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { subscriptionId } = ctx.input as z.infer<typeof GetSubscriptionRequestSchema>;

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

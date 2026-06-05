import { eq, desc, count, and } from "drizzle-orm";
import * as z from "zod";

import { defineBirrJSMethod } from "../../api/endpoint";
import {
  SubscribeRequestSchema,
  CancelSubscriptionRequestSchema,
  GetSubscriptionRequestSchema,
} from "../../api/schemas";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import { generateId } from "../../core/utils";
import { plan, subscription, planFeature, entitlement } from "../../database/schema";
import { addResetInterval } from "../../entitlement/entitlement.service";
import type { ResetInterval } from "../../plans/schema";
import type { TransactionRequest } from "../../provider";
import {
  createSubscription,
  cancelSubscription as cancelSubscriptionLogic,
} from "../../subscription";
import { getEffectiveStatus } from "../../subscription/effective-status";
import type { PlanInterval } from "../../types";
import type { Subscription } from "../../types/models";

/**
 * Subscribe to a plan
 */
export const subscribe = defineBirrJSMethod(
  {
    input: SubscribeRequestSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/subscribe",
    },
  },
  async (ctx) => {
    const { planId } = ctx.input;
    const { customer } = ctx;
    const { database, runtime } = ctx.birrjs;

    // Check if plan exists
    const plans = await database.select().from(plan).where(eq(plan.id, planId)).limit(1);
    const planRecord = plans[0];
    if (!planRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_NOT_FOUND);
    }

    // Check for existing active subscription (renewal path)
    const existingSubscriptions = await database
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.customerId, customer.id),
          eq(subscription.planId, planRecord.id),
          eq(subscription.status, "active"),
        ),
      )
      .limit(1);
    const existingSubscription = existingSubscriptions[0];

    const subscriptionId = existingSubscription?.id ?? generateId("sub");
    const txRef = `tx_${crypto.randomUUID()}`;

    if (existingSubscription) {
      // Renewal: update existing subscription's providerTxRef
      await database
        .update(subscription)
        .set({ providerTxRef: txRef, updatedAt: new Date() })
        .where(eq(subscription.id, existingSubscription.id));
    } else {
      // New subscription: create pending record + entitlements
      const newSubscription = {
        ...createSubscription({
          id: subscriptionId,
          customerId: customer.id,
          planId: planRecord.id,
          interval: (planRecord.priceInterval ?? "monthly") as PlanInterval,
        }),
        cancelAtPeriodEnd: false,
        providerTxRef: txRef,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await database.insert(subscription).values(newSubscription);

      // create Entitlement record
      const planFeatures = await database
        .select()
        .from(planFeature)
        .where(eq(planFeature.planId, planRecord.internalId));

      for (const pf of planFeatures) {
        await database.insert(entitlement).values({
          id: generateId("ent"),
          subscriptionId,
          customerId: customer.id,
          featureId: pf.featureId,
          limit: pf.limit,
          balance: pf.limit,
          nextResetAt: pf.resetInterval
            ? addResetInterval(new Date(), pf.resetInterval as ResetInterval)
            : null,
        });
      }
    }

    const transactionRequest: TransactionRequest = {
      amount: planRecord.priceAmount || 0,
      currency: planRecord.currency || "ETB",
      email: customer.email ?? "",
      txRef,
      callbackUrl: ctx.birrjs.options.provider.callbackUrl,
    };

    let transaction;
    try {
      transaction = await runtime.initializeTransaction(transactionRequest);
    } catch (error) {
      // For new subscriptions: mark as failed (was never activated)
      // For renewals: leave existing active subscription untouched
      if (!existingSubscription) {
        await database
          .update(subscription)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(subscription.id, subscriptionId));
      }
      throw error;
    }

    if (!transaction.checkoutUrl) {
      if (!existingSubscription) {
        await database
          .update(subscription)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(subscription.id, subscriptionId));
      }
      throw BirrJSError.from(
        "INTERNAL_SERVER_ERROR",
        BIRRJS_ERROR_CODES.TRANSACTION_INVALID_RESPONSE,
      );
    }

    return {
      checkoutUrl: transaction.checkoutUrl,
      subscriptionId,
      customerId: customer.id,
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
      client: true,
      method: "POST",
      path: "/list-subscriptions",
    },
  },
  async (ctx) => {
    const { database, options } = ctx.birrjs;
    const { limit = 20, offset = 0 } = ctx.input as { limit?: number; offset?: number };
    const { customer } = ctx;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.customerId, customer.id))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(subscription.createdAt));

    const totalResult = await database
      .select({ value: count() })
      .from(subscription)
      .where(eq(subscription.customerId, customer.id));
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
      client: true,
      method: "POST",
      path: "/cancel-subscription",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { subscriptionId } = ctx.input;
    const { customer } = ctx;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, subscriptionId), eq(subscription.customerId, customer.id)))
      .limit(1);
    const subscriptionRecord = subscriptions[0];
    if (!subscriptionRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
    }

    const result = cancelSubscriptionLogic({
      currentStatus: subscriptionRecord.status as "active" | "expired" | "canceled" | "pending",
      currentPeriodEndAt: subscriptionRecord.expiresAt,
    });

    await database
      .update(subscription)
      .set({
        status: result.status as string,
        canceledAt: result.canceledAt,
        endedAt: result.endedAt,
        cancelAtPeriodEnd: true,
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
      client: true,
      method: "POST",
      path: "/get-subscription",
    },
  },
  async (ctx) => {
    const { database, options } = ctx.birrjs;
    const { subscriptionId } = ctx.input;
    const { customer } = ctx;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, subscriptionId), eq(subscription.customerId, customer.id)))
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
    input: z.object({}),
    requireCustomer: true,
    route: {
      method: "POST",
      path: "/check-subscription",
    },
  },
  async (ctx) => {
    const { database, options } = ctx.birrjs;
    const { customer } = ctx;

    // Get the most recent subscription for the customer
    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.customerId, customer.id))
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

import { createHash } from "node:crypto";

import { eq, desc, count, and, inArray } from "drizzle-orm";
import * as z from "zod";

import { defineBirrJSMethod } from "../../api/endpoint";
import {
  SubscribeRequestSchema,
  CancelSubscriptionRequestSchema,
  GetSubscriptionRequestSchema,
} from "../../api/schemas";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import {
  runBeforeHooks,
  runAfterHooks,
  runPaymentReadyHooks,
  runEventHandlers,
  runPluginEventHandlers,
} from "../../core/hooks";
import { generateId, normalizeEmail, normalizePhone } from "../../core/utils";
import {
  plan,
  subscription,
  feature,
  planFeature,
  entitlement,
  trialRedemption,
} from "../../database/schema";
import { addResetInterval } from "../../entitlement/entitlement.service";
import type { ResetInterval, NormalizedPlan, PriceInterval, FeatureType } from "../../plans/schema";
import type { TransactionRequest } from "../../provider";
import {
  createSubscription,
  cancelSubscription as cancelSubscriptionLogic,
} from "../../subscription";
import { getEffectiveStatus } from "../../subscription/effective-status";
import type { PlanInterval } from "../../types";
import type { Subscription } from "../../types/models";
import type { BeforeSubscribeResult } from "../../types/plugin";

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
    const plans = await database
      .select()
      .from(plan)
      .where(eq(plan.id, planId))
      .orderBy(desc(plan.version))
      .limit(1);
    const planRecord = plans[0];
    if (!planRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_NOT_FOUND);
    }

    // Load plan features with type for hooks and entitlement creation
    const planFeatures = await database
      .select({
        featureId: planFeature.featureId,
        limit: planFeature.limit,
        resetInterval: planFeature.resetInterval,
        config: planFeature.config,
        type: feature.type,
      })
      .from(planFeature)
      .innerJoin(feature, eq(feature.id, planFeature.featureId))
      .where(eq(planFeature.planId, planRecord.internalId));

    // Build NormalizedPlan for hook context
    const normalizedPlan: NormalizedPlan = {
      id: planRecord.id,
      name: planRecord.name,
      group: planRecord.group ?? null,
      includes: planFeatures.map((pf) => ({
        config: pf.config,
        id: pf.featureId,
        limit: pf.limit,
        resetInterval: pf.resetInterval as ResetInterval | null,
        type: pf.type as FeatureType,
      })),
      isDefault: planRecord.isDefault,
      trialDays: planRecord.trialDays,
      resetOnTrialConversion: planRecord.resetOnTrialConversion,
      priceAmount: planRecord.priceAmount,
      priceInterval: planRecord.priceInterval as PriceInterval | null,
      currency: planRecord.currency ?? "ETB",
      hash: planRecord.hash ?? "",
    };

    // Check for existing active or trialing subscription (renewal / duplicate trial path)
    const existingSubscriptions = await database
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.customerId, customer.id),
          eq(subscription.planId, planRecord.internalId),
          inArray(subscription.status, ["active", "trialing"]),
        ),
      )
      .limit(1);
    const existingSubscription = existingSubscriptions[0];

    // If already trialing, return trial info or payment channels
    if (existingSubscription?.status === "trialing") {
      // "Start trial" button — just return existing trial, no payment
      if (ctx.input.useTrial) {
        return {
          subscriptionId: existingSubscription.id,
          customerId: customer.id,
          trialEndsAt: existingSubscription.trialEndsAt,
        };
      }

      // "Pay now" button — store txRef and return payment channels/checkoutUrl
      const txRef = existingSubscription.providerTxRef ?? generateId("tx");

      if (!existingSubscription.providerTxRef) {
        await database
          .update(subscription)
          .set({ providerTxRef: txRef, updatedAt: new Date() })
          .where(eq(subscription.id, existingSubscription.id));
      }

      const transactionRequest: TransactionRequest = {
        amount: planRecord.priceAmount!,
        currency: planRecord.currency || "ETB",
        email: customer.email ?? "",
        firstName: customer.name?.split(" ").at(0),
        lastName: customer.name?.split(" ").slice(1).join(" ") || undefined,
        phoneNumber: customer.phone ?? undefined,
        txRef,
        callbackUrl: ctx.birrjs.options.provider.callbackUrl,
        returnUrl: ctx.birrjs.options.provider.returnUrl,
      };
      const transaction = await runtime.initializeTransaction(transactionRequest);

      if (transaction.paymentInstructions) {
        Promise.resolve().then(() =>
          runPaymentReadyHooks(
            ctx.birrjs.options.plugins,
            {
              customerId: customer.id,
              plan: normalizedPlan,
              planId: planRecord.id,
              subscriptionId: existingSubscription.id,
              paymentInstructions: transaction.paymentInstructions!,
              txRef,
            },
            ctx.birrjs.logger,
          ),
        );
      } else if (transaction.checkoutUrl) {
        Promise.resolve().then(() =>
          runAfterHooks(
            ctx.birrjs.options.plugins,
            {
              customerId: customer.id,
              plan: normalizedPlan,
              planId: planRecord.id,
              subscriptionId: existingSubscription.id,
              checkoutUrl: transaction.checkoutUrl!,
              txRef,
            },
            ctx.birrjs.logger,
          ),
        );
      }

      return {
        subscriptionId: existingSubscription.id,
        customerId: customer.id,
        trialEndsAt: existingSubscription.trialEndsAt,
        checkoutUrl: transaction.checkoutUrl,
        paymentInstructions: transaction.paymentInstructions,
      };
    }

    // Run onBeforeSubscribe hooks (fail-closed gate)
    const cfIp = ctx.request?.headers.get("cf-connecting-ip");
    const xForwardedFor = ctx.request?.headers.get("x-forwarded-for");
    const ip = cfIp ?? xForwardedFor?.split(",")[0]?.trim() ?? undefined;
    const hookTimeout = ctx.birrjs.options.hookTimeout ?? 5000;
    const hookResult: BeforeSubscribeResult | undefined = await runBeforeHooks(
      ctx.birrjs.options.plugins,
      {
        customerId: customer.id,
        plan: normalizedPlan,
        customerEmail: customer.email ?? undefined,
        customerPhone: customer.phone ?? undefined,
        ip,
        fingerprint: ctx.input.fingerprint,
        queries: ctx.birrjs.queries,
      },
      hookTimeout,
    );

    const subscriptionId = existingSubscription?.id ?? generateId("sub");

    // trial-path
    if (
      ctx.input.useTrial &&
      hookResult?.isTrialEligible &&
      planRecord.trialDays &&
      !existingSubscription
    ) {
      const trialEndsAt = new Date(Date.now() + planRecord.trialDays * 24 * 60 * 60 * 1000);

      await database.transaction(async (tx) => {
        await tx.insert(subscription).values({
          ...createSubscription({
            id: subscriptionId,
            customerId: customer.id,
            planId: planRecord.internalId,
            interval: (planRecord.priceInterval ?? "monthly") as PlanInterval,
          }),
          status: "trialing",
          startedAt: new Date(),
          trialStart: new Date(),
          trialEndsAt,
          cancelAtPeriodEnd: false,
          providerTxRef: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        for (const pf of planFeatures) {
          await tx.insert(entitlement).values({
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

        const phoneHash = customer.phone
          ? createHash("sha256").update(normalizePhone(customer.phone)).digest("hex")
          : undefined;

        const [inserted] = await tx
          .insert(trialRedemption)
          .values({
            id: generateId("trr"),
            customerId: customer.id,
            customerEmail: customer.email ? normalizeEmail(customer.email) : null,
            phoneHash,
            fingerprint: ctx.input.fingerprint ?? null,
            planId: planRecord.id,
            subscriptionId,
          })
          .onConflictDoNothing()
          .returning({ id: trialRedemption.id });

        if (!inserted) {
          throw BirrJSError.from("CONFLICT", BIRRJS_ERROR_CODES.TRIAL_ALREADY_REDEEMED);
        }
      });

      const eventPayload = {
        customerId: customer.id,
        subscriptionId,
        planId: planRecord.internalId,
        planName: planRecord.name,
        customerEmail: customer.email ?? null,
        trialEndsAt,
      };

      Promise.resolve().then(() =>
        runEventHandlers(
          ctx.birrjs.options.on,
          "subscription.trial_started",
          eventPayload,
          ctx.birrjs.logger,
        ),
      );
      Promise.resolve().then(() =>
        runPluginEventHandlers(
          ctx.birrjs.options.plugins,
          "subscription.trial_started",
          eventPayload,
          ctx.birrjs,
        ),
      );

      return { subscriptionId, customerId: customer.id, trialEndsAt };
    }

    // pay path
    const txRef = `tx_${crypto.randomUUID()}`;

    if (existingSubscription) {
      // Renewal: update existing subscription's providerTxRef
      await database
        .update(subscription)
        .set({ providerTxRef: txRef, updatedAt: new Date() })
        .where(eq(subscription.id, existingSubscription.id));
    } else {
      // New subscription: create pending record + entitlements
      await database.insert(subscription).values({
        ...createSubscription({
          id: subscriptionId,
          customerId: customer.id,
          planId: planRecord.internalId,
          interval: (planRecord.priceInterval ?? "monthly") as PlanInterval,
        }),
        cancelAtPeriodEnd: false,
        providerTxRef: txRef,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // create Entitlement record
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

    // Free plan — activate immediately without payment
    if (!planRecord.priceAmount) {
      await database
        .update(subscription)
        .set({ status: "active", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(subscription.id, subscriptionId));

      const eventPayload = {
        customerId: customer.id,
        subscriptionId,
        planId: planRecord.internalId,
        planName: planRecord.name,
        customerEmail: customer.email ?? null,
        startedAt: new Date(),
        expiresAt: null,
      };

      Promise.resolve().then(() =>
        runEventHandlers(
          ctx.birrjs.options.on,
          "subscription.activated",
          eventPayload,
          ctx.birrjs.logger,
        ),
      );
      Promise.resolve().then(() =>
        runPluginEventHandlers(
          ctx.birrjs.options.plugins,
          "subscription.activated",
          eventPayload,
          ctx.birrjs,
        ),
      );

      return { success: true, subscriptionId };
    }

    const transactionRequest: TransactionRequest = {
      amount: planRecord.priceAmount,
      currency: planRecord.currency || "ETB",
      email: customer.email ?? "",
      firstName: customer.name?.split(" ").at(0),
      lastName: customer.name?.split(" ").slice(1).join(" ") || undefined,
      phoneNumber: customer.phone ?? undefined,
      txRef,
      callbackUrl: ctx.birrjs.options.provider.callbackUrl,
      returnUrl: ctx.birrjs.options.provider.returnUrl,
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

    if (!transaction.checkoutUrl && !transaction.paymentInstructions) {
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

    if (transaction.paymentInstructions) {
      Promise.resolve().then(() =>
        runPaymentReadyHooks(
          ctx.birrjs.options.plugins,
          {
            customerId: customer.id,
            plan: normalizedPlan,
            planId: planRecord.id,
            subscriptionId,
            paymentInstructions: transaction.paymentInstructions!,
            txRef,
          },
          ctx.birrjs.logger,
        ),
      );
    } else {
      Promise.resolve().then(() =>
        runAfterHooks(
          ctx.birrjs.options.plugins,
          {
            customerId: customer.id,
            plan: normalizedPlan,
            planId: planRecord.id,
            subscriptionId,
            checkoutUrl: transaction.checkoutUrl!,
            txRef,
          },
          ctx.birrjs.logger,
        ),
      );
    }

    return {
      checkoutUrl: transaction.checkoutUrl,
      paymentInstructions: transaction.paymentInstructions,
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

    // Allowed if effective status is active or trialing
    const allowed = effectiveStatus === "active" || effectiveStatus === "trialing";

    return {
      allowed,
      effectiveStatus,
    };
  },
);

import { and, eq } from "drizzle-orm";

import { defineBirrJSMethod } from "../../api/endpoint";
import {
  CancelPlanChangeRequestSchema,
  ChangeSubscriptionRequestSchema,
  PreviewPlanChangeRequestSchema,
} from "../../api/schemas";
import type { BirrJSContext } from "../../context";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import {
  runBeforePlanChangeHooks,
  runEventHandlers,
  runPluginEventHandlers,
} from "../../core/hooks";
import { generateTxRef } from "../../core/utils";
import { subscription, subscriptionPlanChange } from "../../database/schema";
import type { TransactionRequest } from "../../provider";
import { calculateExpiresAt } from "../../subscription";
import type {
  PlanChangeQuote,
  PlanSnapshot,
  SubscriptionAnchor,
} from "../../subscription/plan-change";
import { quotePlanChange } from "../../subscription/plan-change";
import {
  applyPlanChange,
  createPlanChange,
  failPlanChange,
  loadPlanFeatures,
  loadPlanSnapshot,
  loadLatestPlanSnapshot,
  lockSubscription,
  markChangeVoided,
  type PlanChangeWriter,
} from "../../subscription/plan-change.service";
import type { BirrJSEventMap } from "../../types/events";
import type { Customer } from "../../types/models";
import { loadNormalizedPlan } from "./plan.service";

/**
 * Preview the price of moving a subscription to another plan without writing
 * anything. The quote is valid for the plan versions it names; `changeSubscription`
 * re-derives it and rejects a mismatch so a UI cannot be shown a stale amount.
 */
export const previewPlanChange = defineBirrJSMethod(
  {
    input: PreviewPlanChangeRequestSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/preview-plan-change",
    },
  },
  async (ctx) => {
    assertPlanChangesEnabled(ctx.birrjs);

    const { database } = ctx.birrjs;
    const { subscriptionId, toPlanId, prorationBehavior } = ctx.input;

    const sub = await database
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, subscriptionId), eq(subscription.customerId, ctx.customer.id)))
      .limit(1);

    const subscriptionRecord = sub[0];
    if (!subscriptionRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
    }

    const [fromPlan, toPlan] = await Promise.all([
      loadPlanSnapshot(database, subscriptionRecord.planId),
      loadLatestPlanSnapshot(database, toPlanId),
    ]);

    const quote = buildQuote({
      subscription: subscriptionRecord,
      fromPlan,
      toPlan,
      now: new Date(),
      prorationBehavior,
      minimumChargeAmount: ctx.birrjs.options.planChanges?.minimumChargeAmount,
    });

    return {
      subscriptionId,
      fromPlanId: fromPlan.planId,
      fromPlanName: fromPlan.name,
      toPlanId: toPlan.planId,
      toPlanName: toPlan.name,
      quote: toQuoteView(quote),
    };
  },
);

/**
 * Move a subscription to another plan.
 *
 * `invoice_immediately` keeps the renewal anchor and charges the prorated
 * difference; the new limits only land once that payment succeeds, so a failed
 * charge leaves the customer exactly where they were. `next_period` writes a
 * pending change that the next renewal applies.
 */
export const changeSubscription = defineBirrJSMethod(
  {
    input: ChangeSubscriptionRequestSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/change-subscription",
    },
  },
  async (ctx) => {
    assertPlanChangesEnabled(ctx.birrjs);

    const { database, logger, options } = ctx.birrjs;
    const { subscriptionId, toPlanId, prorationBehavior, carryOverUsage, quoteHash, reason } =
      ctx.input;
    const now = new Date();

    const prepared = await database.transaction(async (tx) => {
      const sub = await lockSubscription(tx, subscriptionId, ctx.customer.id);

      const [fromPlan, toPlan] = await Promise.all([
        loadPlanSnapshot(tx, sub.planId),
        loadLatestPlanSnapshot(tx, toPlanId),
      ]);

      const quote = buildQuote({
        subscription: sub,
        fromPlan,
        toPlan,
        now,
        prorationBehavior,
        minimumChargeAmount: options.planChanges?.minimumChargeAmount,
      });

      if (quoteHash && quoteHash !== quote.quoteHash) {
        throw BirrJSError.from("CONFLICT", BIRRJS_ERROR_CODES.PLAN_CHANGE_QUOTE_STALE);
      }

      // The gate runs after the quote but before the row: a plugin that blocks
      // must not leave a pending change behind for the customer to trip over.
      const hookTimeout = options.hookTimeout ?? 5000;
      await runBeforePlanChangeHooks(
        options.plugins,
        async () => ({
          customerId: ctx.customer.id,
          subscriptionId,
          fromPlan: await loadNormalizedPlan(database, fromPlan.internalId),
          toPlan: await loadNormalizedPlan(database, toPlan.internalId),
          quote,
        }),
        hookTimeout,
        logger,
      );

      const txRef = quote.requiresPayment ? generateTxRef() : null;
      const changeId = await createPlanChange(tx, {
        subscriptionId,
        customerId: ctx.customer.id,
        fromPlanInternalId: fromPlan.internalId,
        toPlanInternalId: toPlan.internalId,
        quote,
        currency: toPlan.currency,
        carryOverUsage,
        providerTxRef: txRef,
        reason,
      });

      return { sub, quote, txRef, changeId, fromPlan, toPlan };
    });

    const { sub, quote, txRef, changeId, toPlan } = prepared;

    if (quote.requiresPayment && txRef) {
      return await requestPlanChangePayment(ctx.birrjs, {
        changeId,
        customer: ctx.customer,
        subscription: sub,
        toPlan,
        quote,
        txRef,
      });
    }

    // Nothing to charge. A scheduled change stays pending until renewal; an
    // immediate one settles here, in the same call the customer asked for it.
    if (prorationBehavior === "next_period") {
      await emitPlanChangeEvent(ctx.birrjs, "subscription.plan_change_pending", {
        customerId: ctx.customer.id,
        subscriptionId,
        planChangeId: changeId,
        fromPlanId: prepared.fromPlan.internalId,
        toPlanId: toPlan.internalId,
        toPlanName: toPlan.name,
        direction: quote.direction,
        customerEmail: ctx.customer.email ?? null,
        amountDue: 0,
        txRef: null,
        cycleStartAt: quote.cycleStartAt,
        cycleEndAt: quote.cycleEndAt,
      });

      return {
        planChangeId: changeId,
        subscriptionId,
        status: "pending" as const,
        quote: toQuoteView(quote),
      };
    }

    const settled = await settleWithoutPayment(ctx.birrjs, changeId);

    await emitPlanChangeEvent(ctx.birrjs, "subscription.plan_changed", {
      customerId: ctx.customer.id,
      subscriptionId,
      planChangeId: changeId,
      fromPlanId: prepared.fromPlan.internalId,
      toPlanId: toPlan.internalId,
      toPlanName: toPlan.name,
      direction: quote.direction,
      customerEmail: ctx.customer.email ?? null,
      amountCharged: 0,
      creditedAmount: quote.bankedCreditAmount,
      cycleStartAt: settled.cycleStartAt,
      cycleEndAt: settled.cycleEndAt,
      changedAt: new Date(),
    });

    return {
      planChangeId: changeId,
      subscriptionId,
      status: "applied" as const,
      quote: toQuoteView(quote),
    };
  },
);

/**
 * Withdraw a pending change — the one waiting on its own payment, or the one
 * scheduled for renewal. Applied changes are history; reversing those is a
 * refund, which the provider layer cannot initiate today.
 */
export const cancelPlanChange = defineBirrJSMethod(
  {
    input: CancelPlanChangeRequestSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/cancel-plan-change",
    },
  },
  async (ctx) => {
    const { database, logger } = ctx.birrjs;
    const now = new Date();

    return await database.transaction(async (tx) => {
      const sub = await lockSubscription(tx, ctx.input.subscriptionId, ctx.customer.id);
      if (!sub.pendingChangeId) {
        return { cancelled: false, planChangeId: null };
      }

      const changes = await tx
        .select()
        .from(subscriptionPlanChange)
        .where(eq(subscriptionPlanChange.id, sub.pendingChangeId))
        .limit(1);
      const change = changes[0];

      if (!change || change.status !== "pending") {
        await tx
          .update(subscription)
          .set({ pendingChangeId: null, updatedAt: now })
          .where(eq(subscription.id, sub.id));
        return { cancelled: false, planChangeId: change?.id ?? null };
      }

      await markChangeVoided(tx, change.id, sub.id, now);
      logger.info(
        { changeId: change.id, subscriptionId: sub.id },
        "Plan change cancelled by customer",
      );

      return { cancelled: true, planChangeId: change.id };
    });
  },
);

interface BuildQuoteParams {
  subscription: typeof subscription.$inferSelect;
  fromPlan: PlanSnapshot;
  toPlan: PlanSnapshot;
  now: Date;
  prorationBehavior: "invoice_immediately" | "next_period";
  minimumChargeAmount?: number;
}

function buildQuote(params: BuildQuoteParams): PlanChangeQuote {
  const { subscription: sub, toPlan, now } = params;

  const anchor: SubscriptionAnchor = {
    id: sub.id,
    status: sub.status,
    planInternalId: sub.planId,
    planId: params.fromPlan.planId,
    periodStartAt: sub.periodStartAt ?? sub.startedAt,
    expiresAt: sub.expiresAt,
  };

  return quotePlanChange({
    subscription: anchor,
    fromPlan: params.fromPlan,
    toPlan,
    now,
    prorationBehavior: params.prorationBehavior,
    minimumChargeAmount: params.minimumChargeAmount,
    nextPeriodEndAt: toPlan.priceAmount > 0 ? calculateExpiresAt(now, toPlan.interval) : null,
  });
}

async function settleWithoutPayment(ctx: BirrJSContext, changeId: string) {
  const { database } = ctx;
  const now = new Date();

  return await database.transaction(async (tx) => {
    const changes = await tx
      .select()
      .from(subscriptionPlanChange)
      .where(eq(subscriptionPlanChange.id, changeId))
      .limit(1);
    const change = changes[0];
    if (!change) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_CHANGE_NOT_FOUND);
    }

    const sub = await lockSubscription(tx, change.subscriptionId, change.customerId);
    const [toPlan, fromFeatures, toFeatures] = await Promise.all([
      loadPlanSnapshot(tx, change.toPlanInternalId),
      loadPlanFeatures(tx, change.fromPlanInternalId),
      loadPlanFeatures(tx, change.toPlanInternalId),
    ]);

    return await applyPlanChange({
      tx: tx as unknown as PlanChangeWriter,
      change,
      subscription: sub,
      toPlan,
      fromFeatures,
      toFeatures,
      now,
      paidNow: false,
    });
  });
}

interface PaymentParams {
  changeId: string;
  customer: Customer;
  subscription: typeof subscription.$inferSelect;
  toPlan: PlanSnapshot;
  quote: PlanChangeQuote;
  txRef: string;
}

async function requestPlanChangePayment(ctx: BirrJSContext, params: PaymentParams) {
  const { options, runtime } = ctx;
  const { changeId, customer: actor, quote, subscription: sub, toPlan, txRef } = params;

  const request: TransactionRequest = {
    amount: quote.dueNowAmount,
    currency: toPlan.currency,
    email: actor.email ?? "",
    firstName: actor.name?.split(" ").at(0),
    lastName: actor.name?.split(" ").slice(1).join(" ") || undefined,
    phoneNumber: actor.phone ?? undefined,
    txRef,
    callbackUrl: options.provider.callbackUrl,
    returnUrl: options.provider.returnUrl,
  };

  let transaction;
  try {
    transaction = await runtime.initializeTransaction(request);
  } catch (error) {
    // The pending row is the guard against a second attempt, so it has to go when
    // the provider never saw the charge — otherwise the customer is locked out of
    // changing plan again.
    await failPlanChange(ctx.database, changeId, sub.id, new Date());
    throw error;
  }

  if (!transaction.checkoutUrl && !transaction.paymentInstructions) {
    await failPlanChange(ctx.database, changeId, sub.id, new Date());
    throw BirrJSError.from(
      "INTERNAL_SERVER_ERROR",
      BIRRJS_ERROR_CODES.TRANSACTION_INVALID_RESPONSE,
    );
  }

  await emitPlanChangeEvent(ctx, "subscription.plan_change_pending", {
    customerId: actor.id,
    subscriptionId: sub.id,
    planChangeId: changeId,
    fromPlanId: sub.planId,
    toPlanId: toPlan.internalId,
    toPlanName: toPlan.name,
    direction: quote.direction,
    customerEmail: actor.email ?? null,
    amountDue: quote.dueNowAmount,
    txRef,
    cycleStartAt: quote.cycleStartAt,
    cycleEndAt: quote.cycleEndAt,
  });

  return {
    planChangeId: changeId,
    subscriptionId: sub.id,
    status: "pending" as const,
    quote: toQuoteView(quote),
    checkoutUrl: transaction.checkoutUrl,
    paymentInstructions: transaction.paymentInstructions,
  };
}

function assertPlanChangesEnabled(ctx: BirrJSContext): void {
  if (!ctx.options.planChanges?.enabled) {
    throw BirrJSError.from(
      "FORBIDDEN",
      BIRRJS_ERROR_CODES.PLAN_CHANGE_NOT_ALLOWED,
      "Plan changes are disabled. Set options.planChanges.enabled to true.",
    );
  }
}

async function emitPlanChangeEvent<TName extends keyof BirrJSEventMap>(
  ctx: BirrJSContext,
  name: TName,
  payload: BirrJSEventMap[TName],
) {
  await runEventHandlers(ctx.options.on, name, payload, ctx.logger);
  await runPluginEventHandlers(ctx.options.plugins, name, payload, ctx);
}

function toQuoteView(quote: PlanChangeQuote) {
  const { dueNowAmount: amountDue, bankedCreditAmount: bankedCredit, lines, ...rest } = quote;
  return {
    ...rest,
    amountDue,
    bankedCredit,
    lines: lines.map((line) => ({ kind: line.kind, amountMinor: line.amountMinor })),
  };
}

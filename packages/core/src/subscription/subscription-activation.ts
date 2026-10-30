import { eq } from "drizzle-orm";

import type { BirrJSInternalLogger } from "../core/logger";
import { plan, subscription } from "../database/schema";
import { resetTrialEntitlements } from "../entitlement/entitlement.service";
import type { PlanInterval } from "../types";
import { calculateExpiresAt, renewalAnchor } from "./index";
import { activatePlanChangeByTxRef, applyScheduledChangeAtRenewal } from "./plan-change-activation";
import type { PlanChangeWriter } from "./plan-change.service";

export interface SubscriptionActivationResult {
  updated: boolean;
  subscriptionId?: string;
  /** Set when the txRef paid for a plan change rather than a new subscription. */
  planChangeId?: string;
  /** Set when a change scheduled for period end landed on this renewal. */
  scheduledChangeId?: string;
}

export async function activateSubscriptionByTxRef(
  database: PlanChangeWriter,
  logger: BirrJSInternalLogger,
  txRef: string,
): Promise<SubscriptionActivationResult> {
  const planChange = await activatePlanChangeByTxRef(database, logger, txRef);
  if (planChange.handled) {
    return {
      updated: !!planChange.changeId,
      subscriptionId: planChange.subscriptionId,
      planChangeId: planChange.changeId,
    };
  }

  const subs = await database
    .select()
    .from(subscription)
    .where(eq(subscription.providerTxRef, txRef))
    .limit(1);

  const sub = subs[0];
  if (!sub) {
    logger.warn({ tx_ref: txRef }, "Subscription not found for activation");
    return { updated: false };
  }

  if (sub.status === "active") {
    logger.info({ subscriptionId: sub.id }, "Subscription already active, skipping activation");
    return { updated: false, subscriptionId: sub.id };
  }

  const updateFields: Record<string, unknown> = {
    status: "active",
    updatedAt: new Date(),
    lastPaymentAt: new Date(),
    trialEndsAt: null,
    trialStart: null,
  };

  if (!sub.startedAt) {
    updateFields.startedAt = new Date();
  }

  if (sub.interval) {
    const anchor = renewalAnchor(sub.expiresAt ?? new Date());
    updateFields.periodStartAt = anchor;
    updateFields.expiresAt = calculateExpiresAt(anchor, sub.interval as PlanInterval);
  }

  await database.update(subscription).set(updateFields).where(eq(subscription.id, sub.id));

  if (sub.status === "trialing") {
    const plans = await database
      .select({ resetOnTrialConversion: plan.resetOnTrialConversion })
      .from(plan)
      .where(eq(plan.internalId, sub.planId))
      .limit(1);

    const planRecord = plans[0];
    await resetTrialEntitlements(
      database,
      sub.id,
      planRecord?.resetOnTrialConversion ? "reset" : "carryover",
    );
  }

  // A renewal is the moment a change scheduled for period end becomes due.
  const scheduled = await applyScheduledChangeAtRenewal(database, logger, sub.id);

  logger.info(
    { subscriptionId: sub.id, oldStatus: sub.status, newStatus: "active" },
    "Subscription activated via txRef",
  );

  return {
    updated: true,
    subscriptionId: sub.id,
    scheduledChangeId: scheduled?.changeId,
  };
}

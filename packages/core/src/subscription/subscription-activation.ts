import { eq } from "drizzle-orm";

import type { BirrJSInternalLogger } from "../core/logger";
import type { BirrJSDatabase } from "../database";
import { plan, subscription } from "../database/schema";
import { resetTrialEntitlements } from "../entitlement/entitlement.service";
import type { PlanInterval } from "../types";
import { renewSubscription } from "./index";

export async function activateSubscriptionByTxRef(
  database: BirrJSDatabase,
  logger: BirrJSInternalLogger,
  txRef: string,
): Promise<{ updated: boolean; subscriptionId?: string }> {
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
    updateFields.expiresAt = renewSubscription({
      currentExpiresAt: sub.expiresAt ?? new Date(),
      interval: sub.interval as PlanInterval,
    });
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

  logger.info(
    { subscriptionId: sub.id, oldStatus: sub.status, newStatus: "active" },
    "Subscription activated via txRef",
  );

  return { updated: true, subscriptionId: sub.id };
}

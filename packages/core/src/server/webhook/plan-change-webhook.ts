import { eq } from "drizzle-orm";

import type { BirrJSContext } from "../../context";
import { runEventHandlers, runPluginEventHandlers } from "../../core/hooks";
import { webhookEvent } from "../../database/schema";
import { settlePlanChange, voidPlanChange } from "../../subscription/plan-change-activation";
import {
  findPendingChangeByTxRef,
  loadPlanChangeSummary,
} from "../../subscription/plan-change.service";
import type { BirrJSEventMap } from "../../types/events";

/** Provider events that mean the money is never coming. */
const TERMINAL_FAILURES = ["charge.failed/cancelled", "charge.refunded", "charge.reversed"];

/**
 * Settles a webhook that belongs to a plan change rather than a subscription.
 *
 * Returns `null` when the txRef is not a change, so the caller keeps its own
 * handling. Returns a message when it is, because the change owns the outcome:
 * letting the subscription path run too would extend a period that was never
 * paid for.
 */
export async function settlePlanChangeWebhook(
  ctx: BirrJSContext,
  txRef: string,
  eventType: string,
  webhookEventId: string,
): Promise<string | null> {
  const change = await findPendingChangeByTxRef(ctx.database, txRef);
  if (!change) return null;

  const { database, logger } = ctx;
  const now = new Date();

  if (eventType === "charge.success") {
    const settled = await database.transaction(async (tx) => {
      const result = await settlePlanChange(tx, logger, change, true, now);
      await tx
        .update(webhookEvent)
        .set({
          status: result ? "completed" : "ignored",
          processedAt: now,
        })
        .where(eq(webhookEvent.id, webhookEventId));
      return result;
    });

    if (settled) {
      await emitPlanChanged(ctx, settled.changeId, now);
      return "Plan change applied";
    }

    logger.info({ txRef }, "Plan change no longer applicable when payment landed");
    return "Plan change skipped";
  }

  if (TERMINAL_FAILURES.includes(eventType)) {
    await database.transaction(async (tx) => {
      await voidPlanChange(tx, logger, change, now);
      await tx
        .update(webhookEvent)
        .set({ status: "completed", processedAt: now })
        .where(eq(webhookEvent.id, webhookEventId));
    });

    await emitPlanChangeFailed(ctx, change.id, eventType, now);
    return "Plan change voided";
  }

  // charge.pending and anything unrecognised: the change stays open, and the
  // event row is marked ignored so the terminal webhook for the same txRef is
  // still allowed to be processed.
  await database
    .update(webhookEvent)
    .set({ status: "ignored", processedAt: now })
    .where(eq(webhookEvent.id, webhookEventId));
  return "Plan change payment pending";
}

export async function emitPlanChanged(ctx: BirrJSContext, changeId: string, changedAt: Date) {
  const summary = await loadPlanChangeSummary(ctx.database, changeId);
  if (!summary) return;

  const payload: BirrJSEventMap["subscription.plan_changed"] = {
    customerId: summary.customerId,
    subscriptionId: summary.subscriptionId,
    planChangeId: summary.changeId,
    fromPlanId: summary.fromPlanId,
    toPlanId: summary.toPlanId,
    toPlanName: summary.toPlanName,
    direction: summary.direction,
    customerEmail: summary.customerEmail,
    amountCharged: summary.amountCharged,
    creditedAmount: summary.creditedAmount,
    cycleStartAt: summary.cycleStartAt,
    cycleEndAt: summary.cycleEndAt,
    changedAt,
  };

  await runEventHandlers(ctx.options.on, "subscription.plan_changed", payload, ctx.logger);
  await runPluginEventHandlers(ctx.options.plugins, "subscription.plan_changed", payload, ctx);
}

async function emitPlanChangeFailed(
  ctx: BirrJSContext,
  changeId: string,
  reason: string,
  failedAt: Date,
) {
  const summary = await loadPlanChangeSummary(ctx.database, changeId);
  if (!summary) return;

  const payload: BirrJSEventMap["subscription.plan_change_failed"] = {
    customerId: summary.customerId,
    subscriptionId: summary.subscriptionId,
    planChangeId: summary.changeId,
    fromPlanId: summary.fromPlanId,
    toPlanId: summary.toPlanId,
    customerEmail: summary.customerEmail,
    reason,
    failedAt,
  };

  await runEventHandlers(ctx.options.on, "subscription.plan_change_failed", payload, ctx.logger);
  await runPluginEventHandlers(
    ctx.options.plugins,
    "subscription.plan_change_failed",
    payload,
    ctx,
  );
}

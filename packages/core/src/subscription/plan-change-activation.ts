import type { BirrJSInternalLogger } from "../core/logger";
import type { subscriptionPlanChange } from "../database/schema";
import {
  applyPlanChange,
  findPendingChangeByTxRef,
  findScheduledChangeForRenewal,
  loadPlanFeatures,
  loadPlanSnapshot,
  lockSubscription,
  markChangeVoided,
  type PlanChangeWriter,
} from "./plan-change.service";

export interface SettledPlanChange {
  subscriptionId: string;
  changeId: string;
  toPlanName: string;
}

type PlanChangeRow = typeof subscriptionPlanChange.$inferSelect;

interface SettleParams {
  change: PlanChangeRow;
  paidNow: boolean;
  now: Date;
}

/**
 * Shared settle: read the plan versions the change was quoted against, then swap
 * the subscription and reconcile its entitlements in one step.
 *
 * Amounts come from the change row, never recomputed. The row pinned the plan
 * versions when the customer saw the price, and re-pricing at settlement would
 * silently charge a different amount than the payment that just landed.
 */
async function settle(
  writer: PlanChangeWriter,
  logger: BirrJSInternalLogger,
  params: SettleParams,
): Promise<SettledPlanChange | null> {
  const { change, paidNow, now } = params;

  const [sub, toPlan, fromFeatures, toFeatures] = await Promise.all([
    lockSubscription(writer, change.subscriptionId, change.customerId),
    loadPlanSnapshot(writer, change.toPlanInternalId),
    loadPlanFeatures(writer, change.fromPlanInternalId),
    loadPlanFeatures(writer, change.toPlanInternalId),
  ]);

  if (paidNow && sub.status === "canceled") {
    await markChangeVoided(writer, change.id, sub.id, now);
    logger.info(
      { changeId: change.id, subscriptionId: sub.id },
      "Plan change voided: subscription cancelled before payment settled",
    );
    return null;
  }

  await applyPlanChange({
    tx: writer,
    change,
    subscription: sub,
    toPlan,
    fromFeatures,
    toFeatures,
    now,
    paidNow,
  });

  return { subscriptionId: sub.id, changeId: change.id, toPlanName: toPlan.name };
}

/**
 * Settles a change the caller has already loaded.
 *
 * `paidNow` distinguishes the two ways a change lands: settling the payment it
 * was priced against (an upgrade that just cleared) versus a change scheduled
 * for period end (a downgrade that renewal carries across).
 */
export async function settlePlanChange(
  writer: PlanChangeWriter,
  logger: BirrJSInternalLogger,
  change: PlanChangeRow,
  paidNow: boolean,
  now = new Date(),
): Promise<SettledPlanChange | null> {
  const settled = await settle(writer, logger, { change, paidNow, now });
  if (!settled) return null;

  logger.info(
    {
      changeId: change.id,
      subscriptionId: settled.subscriptionId,
      from: change.fromPlanInternalId,
      to: change.toPlanInternalId,
      paidNow,
    },
    paidNow ? "Plan change applied after payment" : "Scheduled plan change applied at renewal",
  );

  return settled;
}

/**
 * Settles the plan change a payment was raised for, if `txRef` belongs to one.
 *
 * Plan-change payments deliberately do not appear in `subscription.provider_tx_ref`:
 * writing the change's txRef there would overwrite the renewal reference, and
 * because subscription activation returns early for an already-active plan, the
 * customer would pay and stay on the old plan. Callers must therefore resolve
 * changes before looking the subscription up.
 */
export async function activatePlanChangeByTxRef(
  writer: PlanChangeWriter,
  logger: BirrJSInternalLogger,
  txRef: string,
  now = new Date(),
): Promise<{ handled: boolean } & Partial<SettledPlanChange>> {
  const change = await findPendingChangeByTxRef(writer, txRef);
  if (!change) return { handled: false };

  const settled = await settlePlanChange(writer, logger, change, true, now);
  return settled ? { handled: true, ...settled } : { handled: true };
}

/**
 * Withdraws a change the caller has already loaded, clearing the subscription's
 * pointer so the customer can try again.
 */
export async function voidPlanChange(
  writer: PlanChangeWriter,
  logger: BirrJSInternalLogger,
  change: PlanChangeRow,
  now = new Date(),
): Promise<void> {
  await markChangeVoided(writer, change.id, change.subscriptionId, now);
  logger.info({ changeId: change.id, subscriptionId: change.subscriptionId }, "Plan change voided");
}

/**
 * Drops a change whose payment never landed. The subscription is untouched, so an
 * upgrade that fails at the provider leaves the customer on the plan they were
 * already paying for.
 */
export async function failPlanChangeByTxRef(
  writer: PlanChangeWriter,
  logger: BirrJSInternalLogger,
  txRef: string,
  now = new Date(),
) {
  const change = await findPendingChangeByTxRef(writer, txRef);
  if (!change) return null;

  await voidPlanChange(writer, logger, change, now);
  return change;
}

/**
 * Lands the change a subscription scheduled for the end of its period, if any.
 * The renewal payment has already extended the subscription, so this only swaps
 * the plan, the limits and the cycle anchor — no second charge, and the new
 * plan's price is what the following renewal is raised against.
 */
export async function applyScheduledChangeAtRenewal(
  writer: PlanChangeWriter,
  logger: BirrJSInternalLogger,
  subscriptionId: string,
  now = new Date(),
): Promise<SettledPlanChange | null> {
  const change = await findScheduledChangeForRenewal(writer, subscriptionId);
  if (!change) return null;
  return settlePlanChange(writer, logger, change, false, now);
}

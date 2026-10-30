import { and, desc, eq, type SQL } from "drizzle-orm";

import { BirrJSError, BIRRJS_ERROR_CODES } from "../core/error-codes";
import { generateId } from "../core/utils";
import type { BirrJSDatabase, BirrJSTransaction } from "../database";
import {
  customer,
  entitlement,
  invoice,
  plan,
  planFeature,
  subscription,
  subscriptionPlanChange,
} from "../database/schema";
import { addResetInterval } from "../entitlement/entitlement.service";
import type { ResetInterval } from "../plans/schema";
import type { ProrationLine } from "../proration/proration.types";
import type { PlanInterval } from "../types";
import { calculateExpiresAt } from "./index";
import type { PlanChangeDirection, PlanChangeQuote, PlanSnapshot } from "./plan-change";

export type PlanChangeWriter = BirrJSDatabase | BirrJSTransaction;

export interface PlanFeatureRow {
  featureId: string;
  limit: number | null;
  resetInterval: ResetInterval | null;
}

export function loadPlanSnapshot(db: PlanChangeWriter, internalId: string): Promise<PlanSnapshot> {
  return readPlan(db, eq(plan.internalId, internalId));
}

/** Resolves a plan slug to its newest version, for callers that pass `plan_starter` rather than an internal id. */
export function loadLatestPlanSnapshot(
  db: PlanChangeWriter,
  planId: string,
): Promise<PlanSnapshot> {
  return readPlan(db, eq(plan.id, planId));
}

async function readPlan(db: PlanChangeWriter, condition: SQL): Promise<PlanSnapshot> {
  const rows = await db
    .select({
      internalId: plan.internalId,
      planId: plan.id,
      name: plan.name,
      hash: plan.hash,
      priceAmount: plan.priceAmount,
      priceInterval: plan.priceInterval,
      currency: plan.currency,
    })
    .from(plan)
    .where(condition)
    .orderBy(desc(plan.version))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_NOT_FOUND);
  }

  return {
    internalId: row.internalId,
    planId: row.planId,
    name: row.name,
    hash: row.hash ?? "",
    priceAmount: row.priceAmount ?? 0,
    interval: (row.priceInterval ?? "monthly") as PlanInterval,
    currency: row.currency ?? "ETB",
  };
}

export async function loadPlanFeatures(
  db: PlanChangeWriter,
  internalId: string,
): Promise<PlanFeatureRow[]> {
  const rows = await db
    .select({
      featureId: planFeature.featureId,
      limit: planFeature.limit,
      resetInterval: planFeature.resetInterval,
    })
    .from(planFeature)
    .where(eq(planFeature.planId, internalId));

  return rows.map((row) => ({
    featureId: row.featureId,
    limit: row.limit,
    resetInterval: row.resetInterval as ResetInterval | null,
  }));
}

/**
 * Serialises concurrent changes to the same subscription. Without the row lock
 * two requests could both pass the quote check and leave a second pending change
 * overwriting `pendingChangeId`.
 */
export async function lockSubscription(
  db: PlanChangeWriter,
  subscriptionId: string,
  customerId: string,
) {
  const rows = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.id, subscriptionId), eq(subscription.customerId, customerId)))
    .for("update")
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
  }
  return row;
}

export interface CreatePlanChangeInput {
  subscriptionId: string;
  customerId: string;
  fromPlanInternalId: string;
  toPlanInternalId: string;
  quote: PlanChangeQuote;
  currency: string;
  carryOverUsage: boolean;
  providerTxRef?: string | null;
  reason?: string | null;
}

export async function createPlanChange(db: PlanChangeWriter, input: CreatePlanChangeInput) {
  const id = generateId("pch");

  const [created] = await db
    .insert(subscriptionPlanChange)
    .values({
      id,
      subscriptionId: input.subscriptionId,
      customerId: input.customerId,
      fromPlanInternalId: input.fromPlanInternalId,
      toPlanInternalId: input.toPlanInternalId,
      direction: input.quote.direction,
      strategy: input.quote.strategy,
      debitAmount: input.quote.debitAmount,
      creditAmount: input.quote.creditAmount,
      dueNowAmount: input.quote.dueNowAmount,
      bankedCreditAmount: input.quote.bankedCreditAmount,
      deferredAmount: input.quote.deferredAmount,
      currency: input.currency,
      cycleStartAt: input.quote.cycleStartAt,
      cycleEndAt: input.quote.cycleEndAt,
      status: "pending",
      providerTxRef: input.providerTxRef ?? null,
      quoteHash: input.quote.quoteHash,
      carryOverUsage: input.carryOverUsage,
      reason: input.reason ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: subscriptionPlanChange.id });

  if (!created) {
    // Either the partial unique index on `pending` or the one over `providerTxRef`
    // rejected the row — both mean the same request is already in flight.
    throw BirrJSError.from("CONFLICT", BIRRJS_ERROR_CODES.PLAN_CHANGE_IN_PROGRESS);
  }

  await db
    .update(subscription)
    .set({ pendingChangeId: id, updatedAt: new Date() })
    .where(eq(subscription.id, input.subscriptionId));

  return id;
}

export interface PlanChangeSummary {
  changeId: string;
  subscriptionId: string;
  customerId: string;
  customerEmail: string | null;
  direction: PlanChangeDirection;
  fromPlanId: string;
  toPlanId: string;
  toPlanName: string;
  amountCharged: number;
  creditedAmount: number;
  cycleStartAt: Date;
  cycleEndAt: Date | null;
  reason: string | null;
}

/**
 * Everything an event listener needs about one change, resolved once. Webhooks
 * arrive without a request context, so the payload is built from the row rather
 * than from whatever the caller had loaded earlier.
 */
export async function loadPlanChangeSummary(
  db: PlanChangeWriter,
  changeId: string,
): Promise<PlanChangeSummary | null> {
  const rows = await db
    .select({
      changeId: subscriptionPlanChange.id,
      subscriptionId: subscriptionPlanChange.subscriptionId,
      customerId: subscriptionPlanChange.customerId,
      customerEmail: customer.email,
      direction: subscriptionPlanChange.direction,
      fromPlanId: subscriptionPlanChange.fromPlanInternalId,
      toPlanId: subscriptionPlanChange.toPlanInternalId,
      toPlanName: plan.name,
      amountCharged: subscriptionPlanChange.dueNowAmount,
      creditedAmount: subscriptionPlanChange.bankedCreditAmount,
      cycleStartAt: subscriptionPlanChange.cycleStartAt,
      cycleEndAt: subscriptionPlanChange.cycleEndAt,
      reason: subscriptionPlanChange.reason,
    })
    .from(subscriptionPlanChange)
    .innerJoin(plan, eq(plan.internalId, subscriptionPlanChange.toPlanInternalId))
    .innerJoin(customer, eq(customer.id, subscriptionPlanChange.customerId))
    .where(eq(subscriptionPlanChange.id, changeId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { ...row, direction: row.direction as PlanChangeDirection };
}

export async function findChangeById(db: PlanChangeWriter, changeId: string) {
  const rows = await db
    .select()
    .from(subscriptionPlanChange)
    .where(eq(subscriptionPlanChange.id, changeId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_CHANGE_NOT_FOUND);
  }
  return row;
}

export async function findPendingChangeByTxRef(db: PlanChangeWriter, txRef: string) {
  const rows = await db
    .select()
    .from(subscriptionPlanChange)
    .where(
      and(
        eq(subscriptionPlanChange.providerTxRef, txRef),
        eq(subscriptionPlanChange.status, "pending"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The change to settle when a subscription renews: a downgrade scheduled for
 * period end carries no payment, so anything with a `providerTxRef` belongs to
 * its own payment funnel instead of this one.
 */
export async function findScheduledChangeForRenewal(db: PlanChangeWriter, subscriptionId: string) {
  const rows = await db
    .select()
    .from(subscriptionPlanChange)
    .where(
      and(
        eq(subscriptionPlanChange.subscriptionId, subscriptionId),
        eq(subscriptionPlanChange.status, "pending"),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row && !row.providerTxRef ? row : null;
}

export async function markChangeVoided(
  tx: PlanChangeWriter,
  changeId: string,
  subscriptionId: string,
  now: Date,
) {
  await tx
    .update(subscriptionPlanChange)
    .set({ status: "voided", settledAt: now, updatedAt: now })
    .where(eq(subscriptionPlanChange.id, changeId));

  await tx
    .update(subscription)
    .set({ pendingChangeId: null, updatedAt: now })
    .where(eq(subscription.id, subscriptionId));
}

export interface ApplyPlanChangeInput {
  tx: PlanChangeWriter;
  change: typeof subscriptionPlanChange.$inferSelect;
  subscription: typeof subscription.$inferSelect;
  toPlan: PlanSnapshot;
  fromFeatures: PlanFeatureRow[];
  toFeatures: PlanFeatureRow[];
  now: Date;
  /** True when this call settles the payment the change was priced against. */
  paidNow: boolean;
}

export async function applyPlanChange(input: ApplyPlanChangeInput) {
  const { tx, change, toPlan, now, paidNow } = input;
  const sub = input.subscription;

  // A keep-anchor change keeps the period the customer already paid for, so its
  // boundaries are the ones quoted. A rebase starts the new period at the moment
  // the change takes effect, which is settlement time — not quote time.
  const keepAnchor = change.strategy === "keep_anchor";
  const cycleStartAt = keepAnchor ? change.cycleStartAt : now;
  const cycleEndAt = keepAnchor
    ? change.cycleEndAt
    : toPlan.priceAmount > 0
      ? calculateExpiresAt(now, toPlan.interval)
      : null;

  await tx
    .update(subscription)
    .set({
      planId: change.toPlanInternalId,
      interval: toPlan.interval,
      status: sub.status === "expired" || sub.status === "trialing" ? "active" : sub.status,
      periodStartAt: cycleStartAt,
      expiresAt: cycleEndAt,
      pendingChangeId: null,
      trialStart: null,
      trialEndsAt: null,
      lastPaymentAt: paidNow ? now : sub.lastPaymentAt,
      updatedAt: now,
    })
    .where(eq(subscription.id, sub.id));

  await reconcileEntitlements({
    tx,
    subscriptionId: sub.id,
    customerId: sub.customerId,
    fromFeatures: input.fromFeatures,
    toFeatures: input.toFeatures,
    carryOverUsage: change.carryOverUsage,
    now,
  });

  if (paidNow) {
    await recordProrationInvoice(tx, change, cycleStartAt, cycleEndAt, now);
  }

  await tx
    .update(subscriptionPlanChange)
    .set({ status: "applied", cycleStartAt, cycleEndAt, settledAt: now, updatedAt: now })
    .where(eq(subscriptionPlanChange.id, change.id));

  return { cycleStartAt, cycleEndAt };
}

export async function failPlanChange(
  tx: PlanChangeWriter,
  changeId: string,
  subscriptionId: string,
  now: Date,
) {
  await tx
    .update(subscriptionPlanChange)
    .set({ status: "failed", settledAt: now, updatedAt: now })
    .where(eq(subscriptionPlanChange.id, changeId));

  await tx
    .update(subscription)
    .set({ pendingChangeId: null, updatedAt: now })
    .where(eq(subscription.id, subscriptionId));
}

interface ReconcileInput {
  tx: PlanChangeWriter;
  subscriptionId: string;
  customerId: string;
  fromFeatures: PlanFeatureRow[];
  toFeatures: PlanFeatureRow[];
  carryOverUsage: boolean;
  now: Date;
}

/**
 * Moves usage onto the target plan's limits. Features the new plan drops are
 * deleted rather than zeroed: `getActiveEntitlements` joins through
 * `plan_feature`, so a leftover row is already invisible to `check`, and a
 * zeroed one would only look like a quota the customer can never use.
 */
export async function reconcileEntitlements(input: ReconcileInput): Promise<void> {
  const { tx, subscriptionId, customerId, fromFeatures, toFeatures, carryOverUsage, now } = input;

  const rows = await tx
    .select({
      id: entitlement.id,
      featureId: entitlement.featureId,
      limit: entitlement.limit,
      balance: entitlement.balance,
      nextResetAt: entitlement.nextResetAt,
    })
    .from(entitlement)
    .where(eq(entitlement.subscriptionId, subscriptionId));

  const previousInterval = new Map(
    fromFeatures.map((featureRow) => [featureRow.featureId, featureRow.resetInterval]),
  );
  const targetIds = new Set(toFeatures.map((featureRow) => featureRow.featureId));

  for (const row of rows) {
    if (!targetIds.has(row.featureId)) {
      await tx.delete(entitlement).where(eq(entitlement.id, row.id));
    }
  }

  for (const target of toFeatures) {
    const existing = rows.find((row) => row.featureId === target.featureId);
    const resetAt = target.resetInterval ? addResetInterval(now, target.resetInterval) : null;

    if (!existing) {
      await tx.insert(entitlement).values({
        id: generateId("ent"),
        subscriptionId,
        customerId,
        featureId: target.featureId,
        limit: target.limit,
        balance: target.limit,
        nextResetAt: target.limit === null ? null : resetAt,
      });
      continue;
    }

    // Re-timing a meter the customer is part-way through would either skip or
    // double-bill the usage they already have, so keep the old cadence when the
    // reset interval is unchanged and usage carries over.
    const keepCadence =
      carryOverUsage &&
      previousInterval.get(target.featureId) === target.resetInterval &&
      existing.nextResetAt !== null &&
      existing.nextResetAt > now;

    await tx
      .update(entitlement)
      .set({
        limit: target.limit,
        balance: balanceAfterChange(existing, target.limit, carryOverUsage),
        nextResetAt: target.limit === null ? null : keepCadence ? existing.nextResetAt : resetAt,
        updatedAt: now,
      })
      .where(eq(entitlement.id, existing.id));
  }
}

function balanceAfterChange(
  existing: { limit: number | null; balance: number | null },
  nextLimit: number | null,
  carryOverUsage: boolean,
): number | null {
  if (nextLimit === null) return null;
  if (!carryOverUsage || existing.balance === null) return nextLimit;

  const used = existing.limit === null ? 0 : Math.max(0, existing.limit - existing.balance);
  return Math.max(0, nextLimit - used);
}

async function recordProrationInvoice(
  tx: PlanChangeWriter,
  change: typeof subscriptionPlanChange.$inferSelect,
  cycleStartAt: Date,
  cycleEndAt: Date | null,
  now: Date,
) {
  // A change can be payment-gated and still owe nothing once the minimum charge
  // threshold suppresses the difference; there is no money to record.
  if (change.dueNowAmount <= 0) return;

  await tx.insert(invoice).values({
    id: generateId("inv"),
    customerId: change.customerId,
    subscriptionId: change.subscriptionId,
    planChangeId: change.id,
    kind: "proration",
    amount: change.dueNowAmount,
    currency: change.currency,
    status: "paid",
    providerTxRef: change.providerTxRef,
    description: `Plan change ${change.direction}: ${change.fromPlanInternalId} to ${change.toPlanInternalId}`,
    lines: invoiceLines(change),
    periodStartAt: cycleStartAt,
    periodEndAt: cycleEndAt,
    createdAt: now,
    updatedAt: now,
  });
}

function invoiceLines(change: typeof subscriptionPlanChange.$inferSelect): ProrationLine[] {
  const lines: ProrationLine[] = [];

  if (change.debitAmount > 0) {
    lines.push({
      kind: change.strategy === "keep_anchor" ? "plan_difference_prorated" : "new_period_charged",
      amountMinor: change.debitAmount,
    });
  }

  if (change.creditAmount > 0) {
    lines.push({
      kind:
        change.strategy === "keep_anchor" ? "plan_difference_prorated" : "unused_period_credited",
      amountMinor: -change.creditAmount,
    });
  }

  return lines;
}

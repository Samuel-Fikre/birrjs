import { createHash } from "node:crypto";

import { BirrJSError, BIRRJS_ERROR_CODES } from "../core/error-codes";
import { calculateProration } from "../proration/proration.service";
import type { ProrationLine, ProrationStrategy } from "../proration/proration.types";
import type { PlanInterval } from "../types";

export type PlanChangeDirection = "upgrade" | "downgrade" | "switch";

export type PlanChangeStatus = "pending" | "applied" | "voided" | "failed";

export type ProrationBehavior = "invoice_immediately" | "next_period";

/**
 * A change is priced against a period that exists, so it starts from a settled
 * or trialling subscription. A `pending` row has no paid period yet, and
 * repointing it would leave a provider charge priced for the previous plan.
 */
const CHANGEABLE_STATUSES = ["trialing", "active", "expired"];

/**
 * Nominal period lengths, used only to compare the cost of two different
 * intervals. Approximation is safe here: the result picks a direction label, it
 * never decides an amount.
 */
const nominalDays: Record<PlanInterval, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

export interface PlanSnapshot {
  internalId: string;
  planId: string;
  name: string;
  hash: string;
  /** Minor units; 0 for a free plan. */
  priceAmount: number;
  interval: PlanInterval;
  currency: string;
}

export interface SubscriptionAnchor {
  id: string;
  status: string;
  planInternalId: string;
  planId: string;
  periodStartAt: Date | null;
  expiresAt: Date | null;
}

export interface PlanChangeQuote {
  direction: PlanChangeDirection;
  strategy: ProrationStrategy;
  cycleStartAt: Date;
  cycleEndAt: Date | null;
  debitAmount: number;
  creditAmount: number;
  dueNowAmount: number;
  bankedCreditAmount: number;
  deferredAmount: number;
  lines: readonly ProrationLine[];
  requiresPayment: boolean;
  /** Cheap signature of the inputs; a stale quote is rejected at commit. */
  quoteHash: string;
}

export interface QuotePlanChangeInput {
  subscription: SubscriptionAnchor;
  fromPlan: PlanSnapshot;
  toPlan: PlanSnapshot;
  now: Date;
  /** End of the target plan's period, when the change rebases the cycle. */
  nextPeriodEndAt?: Date | null;
  minimumChargeAmount?: number;
  /** `next_period` defers the swap to renewal, where nothing is prorated. */
  prorationBehavior?: ProrationBehavior;
}

function assertChangeable(subscription: SubscriptionAnchor, toPlan: PlanSnapshot): void {
  if (!CHANGEABLE_STATUSES.includes(subscription.status)) {
    throw BirrJSError.from(
      "BAD_REQUEST",
      BIRRJS_ERROR_CODES.PLAN_CHANGE_NOT_ALLOWED,
      `Cannot change plan from status: ${subscription.status}`,
    );
  }

  if (subscription.planInternalId === toPlan.internalId) {
    throw BirrJSError.from("BAD_REQUEST", BIRRJS_ERROR_CODES.PLAN_CHANGE_SAME_PLAN);
  }
}

function assertComparable(fromPlan: PlanSnapshot, toPlan: PlanSnapshot): void {
  if (fromPlan.currency !== toPlan.currency) {
    throw BirrJSError.from(
      "BAD_REQUEST",
      BIRRJS_ERROR_CODES.PLAN_CURRENCY_MISMATCH,
      `Cannot move between ${fromPlan.currency} and ${toPlan.currency} plans`,
    );
  }
}

function perDayCost(plan: PlanSnapshot): number {
  return plan.priceAmount / nominalDays[plan.interval];
}

function directionOf(fromPlan: PlanSnapshot, toPlan: PlanSnapshot): PlanChangeDirection {
  const delta = perDayCost(toPlan) - perDayCost(fromPlan);
  if (delta === 0) return "switch";
  return delta > 0 ? "upgrade" : "downgrade";
}

/**
 * The anchor is what makes a partial period computable. Rows written before the
 * column existed have no anchor, so they rebase without credit rather than
 * inventing a period boundary.
 */
function resolveCurrentPeriod(
  subscription: SubscriptionAnchor,
  now: Date,
): {
  startAt: Date;
  endAt: Date | null;
} {
  if (!subscription.periodStartAt || !subscription.expiresAt) {
    return { startAt: now, endAt: null };
  }
  return { startAt: subscription.periodStartAt, endAt: subscription.expiresAt };
}

export function buildQuoteHash(input: {
  subscriptionId: string;
  fromPlanHash: string;
  toPlanHash: string;
  dueNowAmount: number;
  creditAmount: number;
  strategy: ProrationStrategy;
}): string {
  const payload = JSON.stringify({
    subscriptionId: input.subscriptionId,
    fromPlanHash: input.fromPlanHash,
    toPlanHash: input.toPlanHash,
    dueNowAmount: input.dueNowAmount,
    creditAmount: input.creditAmount,
    strategy: input.strategy,
  });

  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function quotePlanChange(input: QuotePlanChangeInput): PlanChangeQuote {
  const { subscription, fromPlan, toPlan, now } = input;

  assertChangeable(subscription, toPlan);
  assertComparable(fromPlan, toPlan);

  if (input.prorationBehavior === "next_period") {
    return deferredQuote(input);
  }

  const currentPeriod = resolveCurrentPeriod(subscription, now);
  const proration = calculateProration({
    now,
    currentPeriodStartAt: currentPeriod.startAt,
    currentPeriodEndAt: currentPeriod.endAt,
    currentAmountMinor: fromPlan.priceAmount,
    currentInterval: fromPlan.interval,
    nextAmountMinor: toPlan.priceAmount,
    nextInterval: toPlan.interval,
    nextPeriodEndAt: input.nextPeriodEndAt ?? null,
    minimumChargeMinor: input.minimumChargeAmount ?? 0,
  });

  return {
    direction: directionOf(fromPlan, toPlan),
    strategy: proration.strategy,
    cycleStartAt: proration.cycleStartAt,
    cycleEndAt: proration.cycleEndAt,
    debitAmount: proration.debitMinor,
    creditAmount: proration.creditMinor,
    dueNowAmount: proration.dueNowMinor,
    bankedCreditAmount: proration.bankedCreditMinor,
    deferredAmount: proration.deferredMinor,
    lines: proration.lines,
    requiresPayment: proration.dueNowMinor > 0,
    quoteHash: buildQuoteHash({
      subscriptionId: subscription.id,
      fromPlanHash: fromPlan.hash,
      toPlanHash: toPlan.hash,
      dueNowAmount: proration.dueNowMinor,
      creditAmount: proration.creditMinor,
      strategy: proration.strategy,
    }),
  };
}

/**
 * A change scheduled for renewal moves the customer onto the new plan's price for
 * the *next* period; the one already paid for is honoured in full, so nothing
 * moves now and the cycle always rebases when the swap lands.
 */
function deferredQuote({
  subscription,
  fromPlan,
  toPlan,
  now,
}: QuotePlanChangeInput): PlanChangeQuote {
  return {
    direction: directionOf(fromPlan, toPlan),
    strategy: "rebase",
    cycleStartAt: now,
    cycleEndAt: null,
    debitAmount: 0,
    creditAmount: 0,
    dueNowAmount: 0,
    bankedCreditAmount: 0,
    deferredAmount: 0,
    lines: [],
    requiresPayment: false,
    quoteHash: buildQuoteHash({
      subscriptionId: subscription.id,
      fromPlanHash: fromPlan.hash,
      toPlanHash: toPlan.hash,
      dueNowAmount: 0,
      creditAmount: 0,
      strategy: "rebase",
    }),
  };
}

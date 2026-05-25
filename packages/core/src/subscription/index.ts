import { addResetInterval } from "../entitlement/entitlement.service";
import type { ResetInterval } from "../plans/schema";
import type { PlanInterval, SubscriptionStatus } from "../types";

const intervalToReset: Record<PlanInterval, ResetInterval> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export function calculateExpiresAt(startDate: Date, interval: PlanInterval): Date {
  const reset = intervalToReset[interval];
  if (!reset) throw new Error(`Invalid interval: ${interval}`);
  return addResetInterval(startDate, reset);
}

/**
 * Check if status transition is valid
 */
export function canTransitionStatus(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  const validTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
    active: ["expired", "canceled"],
    expired: ["active"],
    canceled: [],
    pending: ["active", "canceled", "expired"],
  };

  return validTransitions[from]?.includes(to) ?? false;
}

/**
 * Transition subscription status
 */
export function transitionStatus(
  currentStatus: SubscriptionStatus,
  newStatus: SubscriptionStatus,
): SubscriptionStatus {
  if (!canTransitionStatus(currentStatus, newStatus)) {
    throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
  }

  return newStatus;
}

/**
 * Create subscription
 */
export interface CreateSubscriptionInput {
  id: string;
  customerId: string;
  planId: string;
  interval: PlanInterval;
}

export interface CreateSubscriptionResult {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  interval: PlanInterval;
  startedAt: Date | null;
  expiresAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
}

export function createSubscription(input: CreateSubscriptionInput): CreateSubscriptionResult {
  return {
    id: input.id,
    customerId: input.customerId,
    planId: input.planId,
    status: "pending",
    interval: input.interval,
    startedAt: null,
    expiresAt: null,
    canceledAt: null,
    endedAt: null,
  };
}

/**
 * Renew subscription (calculate new expiresAt on payment).
 */
export interface RenewSubscriptionInput {
  currentExpiresAt: Date;
  interval: PlanInterval;
}

export function renewSubscription(input: RenewSubscriptionInput): Date {
  const now = new Date();
  const renewalDate =
    input.currentExpiresAt.getTime() > now.getTime() ? input.currentExpiresAt : now;
  return calculateExpiresAt(renewalDate, input.interval);
}

/**
 * Cancel subscription
 */
export interface CancelSubscriptionInput {
  currentStatus: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEndAt: Date | null;
}

export interface CancelSubscriptionResult {
  status: SubscriptionStatus;
  canceledAt: Date;
  endedAt: Date | null;
}

export function cancelSubscription(input: CancelSubscriptionInput): CancelSubscriptionResult {
  const now = new Date();

  // Validate that cancellation is allowed from current status
  if (!canTransitionStatus(input.currentStatus, "canceled")) {
    throw new Error(`Cannot cancel subscription with status: ${input.currentStatus}`);
  }

  if (input.cancelAtPeriodEnd) {
    if (!input.currentPeriodEndAt) {
      throw new Error("Cannot cancel at period end: currentPeriodEndAt is required");
    }
    // Prevent cancel-at-period-end for subscriptions without an active period
    if (input.currentStatus !== "active") {
      throw new Error("Cannot cancel at period end: subscription must be active");
    }
    // Cancel at period end
    return {
      status: "active",
      canceledAt: now,
      endedAt: input.currentPeriodEndAt,
    };
  }

  // Immediate cancellation
  return {
    status: "canceled",
    canceledAt: now,
    endedAt: now,
  };
}

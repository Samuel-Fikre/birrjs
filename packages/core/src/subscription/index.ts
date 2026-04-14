import type { PlanInterval, SubscriptionStatus } from "../types";

// TODO: Migrate to Temporal once it's no longer experimental in Node.js
// Temporal provides safer calendar arithmetic and better date/time handling
// https://tc39.es/proposal-temporal/

export function calculateExpiresAt(startDate: Date, interval: PlanInterval): Date {
  const expiresAt = new Date(startDate.getTime());

  switch (interval) {
    case "daily":
      expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
      break;
    case "weekly":
      expiresAt.setUTCDate(expiresAt.getUTCDate() + 7);
      break;
    case "monthly": {
      const targetMonth = expiresAt.getUTCMonth() + 1;
      expiresAt.setUTCMonth(targetMonth);
      // Clamp to last day of target month if overflow occurred
      if (expiresAt.getUTCMonth() !== targetMonth % 12) {
        expiresAt.setUTCDate(0);
      }
      break;
    }
    case "yearly":
      expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
      break;
    default:
      throw new Error(`Invalid interval: ${interval}`);
  }

  return expiresAt;
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

  if (input.cancelAtPeriodEnd && input.currentPeriodEndAt) {
    // Cancel at period end
    return {
      status: "active",
      canceledAt: now,
      endedAt: null,
    };
  }

  // Immediate cancellation
  return {
    status: "canceled",
    canceledAt: now,
    endedAt: now,
  };
}

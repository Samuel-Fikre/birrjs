import type { Subscription } from "../types/models";

export type SubscriptionStatus = "pending" | "active" | "canceled" | "failed" | "expired";

export interface GetEffectiveStatusOptions {
  pendingTimeoutMinutes?: number;
}

export function getEffectiveStatus(
  subscription: Subscription,
  options?: GetEffectiveStatusOptions,
): SubscriptionStatus {
  const now = Date.now();
  const pendingTimeoutMinutes = options?.pendingTimeoutMinutes ?? 60;
  const pendingTimeoutMs = pendingTimeoutMinutes * 60 * 1000;

  // Normalize dates to timestamps for deterministic comparison
  const createdAt = new Date(subscription.createdAt).getTime();
  const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt).getTime() : null;

  // If pending for too long, treat as failed
  if (subscription.status === "pending") {
    if (createdAt + pendingTimeoutMs <= now) {
      return "failed";
    }
  }

  // If active but expired, treat as expired
  if (subscription.status === "active" && expiresAt !== null) {
    if (expiresAt <= now) {
      return "expired";
    }
  }

  // Otherwise return stored status
  return subscription.status as SubscriptionStatus;
}

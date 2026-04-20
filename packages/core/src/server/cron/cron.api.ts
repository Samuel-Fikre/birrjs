import { eq, and, lt } from "drizzle-orm";
import { subscription } from "../../database/schema";
import type { BirrJSContext } from "../../context";

/**
 * Check subscriptions stuck in pending status
 */
export async function checkPendingSubscriptions(ctx: BirrJSContext) {
  const { database, logger, options } = ctx;

  // Find subscriptions in pending status for more than configured timeout
  const pendingTimeoutMinutes = options.scheduling?.pendingTimeoutMinutes ?? 60;
  const pendingTimeoutMs = pendingTimeoutMinutes * 60 * 1000;
  const timeoutAgo = new Date(Date.now() - pendingTimeoutMs);

  // Mark stuck subscriptions as failed and get the updated rows
  const updatedSubscriptions = await database
    .update(subscription)
    .set({ status: "failed", failedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(subscription.status, "pending"), lt(subscription.createdAt, timeoutAgo)))
    .returning();

  logger.info(`Marked ${updatedSubscriptions.length} subscriptions as failed (stuck in pending)`);

  return {
    checked: updatedSubscriptions.length,
    updated: updatedSubscriptions.length,
  };
}

/**
 * Check expired subscriptions
 */
export async function checkExpiredSubscriptions(ctx: BirrJSContext) {
  const { database, logger } = ctx;

  // Find active subscriptions that have passed their endedAt
  const now = new Date();

  // Mark expired subscriptions and get the updated rows
  const updatedSubscriptions = await database
    .update(subscription)
    .set({ status: "expired", expiredAt: new Date(), updatedAt: new Date() })
    .where(and(eq(subscription.status, "active"), lt(subscription.endedAt, now)))
    .returning();

  logger.info(`Marked ${updatedSubscriptions.length} subscriptions as expired`);

  return {
    checked: updatedSubscriptions.length,
    updated: updatedSubscriptions.length,
  };
}

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

  const stuckSubscriptions = await database
    .select()
    .from(subscription)
    .where(and(eq(subscription.status, "pending"), lt(subscription.createdAt, timeoutAgo)));

  logger.info(`Found ${stuckSubscriptions.length} stuck pending subscriptions`);

  // Mark them as failed in a single bulk update
  await database
    .update(subscription)
    .set({ status: "failed", updatedAt: new Date() })
    .where(and(eq(subscription.status, "pending"), lt(subscription.createdAt, timeoutAgo)));

  logger.warn(`Marked ${stuckSubscriptions.length} subscriptions as failed (stuck in pending)`);

  return {
    checked: stuckSubscriptions.length,
    updated: stuckSubscriptions.length,
  };
}

/**
 * Check expired subscriptions
 */
export async function checkExpiredSubscriptions(ctx: BirrJSContext) {
  const { database, logger } = ctx;

  // Find active subscriptions that have passed their endedAt
  const now = new Date();

  const expiredSubscriptions = await database
    .select()
    .from(subscription)
    .where(and(eq(subscription.status, "active"), lt(subscription.endedAt, now)));

  logger.info(`Found ${expiredSubscriptions.length} expired subscriptions`);

  // Mark them as expired in a single bulk update
  await database
    .update(subscription)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(subscription.status, "active"), lt(subscription.endedAt, now)));

  logger.warn(`Marked ${expiredSubscriptions.length} subscriptions as expired`);

  return {
    checked: expiredSubscriptions.length,
    updated: expiredSubscriptions.length,
  };
}

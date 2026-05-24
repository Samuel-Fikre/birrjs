import { createHash, timingSafeEqual } from "crypto";

import { APIError } from "better-call";
import { eq, and, lt } from "drizzle-orm";

import { defineBirrJSMethod } from "../../api/endpoint";
import type { BirrJSContext } from "../../context";
import { subscription } from "../../database/schema";

function safeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function validateCronAuth(ctx: {
  birrjs: { options: { scheduling?: { cronSecret?: string; mode?: string } } };
  headers?: Headers;
}): void {
  const { options } = ctx.birrjs;

  const auth = ctx.headers?.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new APIError("UNAUTHORIZED", {
      message: "Missing or invalid Authorization header",
    });
  }

  const token = auth.slice(7);
  const cronSecret = options.scheduling?.cronSecret;

  if (!cronSecret || !safeCompare(token, cronSecret)) {
    throw new APIError("UNAUTHORIZED", {
      message: "Invalid cron secret",
    });
  }

  if (options.scheduling?.mode === "manual") {
    throw new APIError("FORBIDDEN", {
      message: "Scheduler is in manual mode",
    });
  }
}

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
    .set({ status: "failed", endedAt: new Date(), updatedAt: new Date() })
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

  // Find active subscriptions that have passed their expiresAt
  const now = new Date();

  // Mark expired subscriptions and get the updated rows
  const updatedSubscriptions = await database
    .update(subscription)
    .set({ status: "expired", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(subscription.status, "active"), lt(subscription.expiresAt, now)))
    .returning();

  logger.info(`Marked ${updatedSubscriptions.length} subscriptions as expired`);

  return {
    checked: updatedSubscriptions.length,
    updated: updatedSubscriptions.length,
  };
}

/**
 * HTTP endpoint to check pending subscriptions (requires cronSecret)
 */
export const checkPendingSubscriptionsEndpoint = defineBirrJSMethod(
  {
    route: {
      method: "POST",
      path: "/check-pending-subscriptions",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateCronAuth(ctx);

    const result = await checkPendingSubscriptions(ctx.birrjs);

    return {
      success: true,
      ...result,
    };
  },
);

/**
 * HTTP endpoint to check expired subscriptions (requires cronSecret)
 */
export const checkExpiredSubscriptionsEndpoint = defineBirrJSMethod(
  {
    route: {
      method: "POST",
      path: "/check-expired-subscriptions",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateCronAuth(ctx);

    const result = await checkExpiredSubscriptions(ctx.birrjs);

    return {
      success: true,
      ...result,
    };
  },
);

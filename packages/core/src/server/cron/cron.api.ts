import { createHash, timingSafeEqual } from "crypto";

import { APIError } from "better-call";
import { eq, and, gte, inArray, lt, lte } from "drizzle-orm";

import { defineBirrJSMethod } from "../../api/endpoint";
import type { BirrJSContext } from "../../context";
import { runEventHandlers, runPluginEventHandlers } from "../../core/hooks";
import { generateId } from "../../core/utils";
import { customer, plan, reminderSent, subscription } from "../../database/schema";
import type { BirrJSEventMap } from "../../types/events";

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
 * Check expired subscriptions (active + trialing)
 */
export async function checkExpiredSubscriptions(ctx: BirrJSContext) {
  const { database, logger } = ctx;
  const now = new Date();

  // Mark expired active subscriptions
  const expiredActive = await database
    .update(subscription)
    .set({ status: "expired", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(subscription.status, "active"), lt(subscription.expiresAt, now)))
    .returning();

  // Mark expired trialing subscriptions
  const expiredTrials = await database
    .update(subscription)
    .set({ status: "expired", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(subscription.status, "trialing"), lt(subscription.trialEndsAt, now)))
    .returning();

  const allExpired = [...expiredActive, ...expiredTrials];

  logger.info(
    `Marked ${allExpired.length} subscriptions as expired (${expiredActive.length} active, ${expiredTrials.length} trials)`,
  );

  for (const sub of allExpired) {
    const [subData] = await database
      .select({
        planName: plan.name,
        customerEmail: customer.email,
      })
      .from(subscription)
      .innerJoin(plan, eq(plan.internalId, subscription.planId))
      .innerJoin(customer, eq(customer.id, subscription.customerId))
      .where(eq(subscription.id, sub.id))
      .limit(1);

    const eventPayload: BirrJSEventMap["subscription.expired"] = {
      customerId: sub.customerId,
      subscriptionId: sub.id,
      planId: sub.planId,
      planName: subData?.planName ?? "",
      customerEmail: subData?.customerEmail ?? null,
      expiredAt: sub.expiresAt ?? sub.trialEndsAt ?? sub.endedAt ?? new Date(),
    };
    await runEventHandlers(ctx.options.on, "subscription.expired", eventPayload, logger);
    await runPluginEventHandlers(ctx.options.plugins, "subscription.expired", eventPayload, ctx);
  }

  return {
    checked: allExpired.length,
    updated: allExpired.length,
  };
}

/**
 * Send reminders for subscriptions approaching expiry or trial end
 */
export async function sendReminders(ctx: BirrJSContext) {
  const { database, logger, options } = ctx;

  const leadDays = options.scheduling?.reminderLeadDays ?? [7, 3, 1];
  if (
    !Array.isArray(leadDays) ||
    leadDays.length === 0 ||
    leadDays.some((d) => !Number.isInteger(d) || d < 1)
  ) {
    logger.warn({ leadDays }, "Invalid reminderLeadDays, skipping reminder sweep");
    return { checked: 0, updated: 0 };
  }
  const trialLeadDays = options.scheduling?.trialReminderLeadDays ?? [3, 1];
  if (
    !Array.isArray(trialLeadDays) ||
    trialLeadDays.length === 0 ||
    trialLeadDays.some((d) => !Number.isInteger(d) || d < 1)
  ) {
    logger.warn({ trialLeadDays }, "Invalid trialReminderLeadDays, skipping reminder sweep");
    return { checked: 0, updated: 0 };
  }

  const maxLeadDays = Math.max(...leadDays);
  const maxTrialLeadDays = Math.max(...trialLeadDays);
  const now = new Date();
  const maxExpiry = new Date(now.getTime() + maxLeadDays * 24 * 60 * 60 * 1000);
  const maxTrialExpiry = new Date(now.getTime() + maxTrialLeadDays * 24 * 60 * 60 * 1000);

  // Query active subscriptions approaching expiry
  const expiringSubscriptions = await database
    .select({
      id: subscription.id,
      customerId: subscription.customerId,
      planId: subscription.planId,
      expiresAt: subscription.expiresAt,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      planName: plan.name,
    })
    .from(subscription)
    .innerJoin(customer, eq(customer.id, subscription.customerId))
    .innerJoin(plan, eq(plan.internalId, subscription.planId))
    .where(
      and(
        eq(subscription.status, "active"),
        gte(subscription.expiresAt, now),
        lte(subscription.expiresAt, maxExpiry),
      ),
    );

  // Query trialing subscriptions approaching trial end
  const trialingSubscriptions = await database
    .select({
      id: subscription.id,
      customerId: subscription.customerId,
      planId: subscription.planId,
      trialEndsAt: subscription.trialEndsAt,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      planName: plan.name,
    })
    .from(subscription)
    .innerJoin(customer, eq(customer.id, subscription.customerId))
    .innerJoin(plan, eq(plan.internalId, subscription.planId))
    .where(
      and(
        eq(subscription.status, "trialing"),
        gte(subscription.trialEndsAt, now),
        lte(subscription.trialEndsAt, maxTrialExpiry),
      ),
    );

  // Batch check which reminders were already sent
  const allSubscriptionIds = [
    ...expiringSubscriptions.map((s) => s.id),
    ...trialingSubscriptions.map((s) => s.id),
  ];
  const allLeadDayValues = [...new Set([...leadDays, ...trialLeadDays])];
  const existingReminders =
    allSubscriptionIds.length > 0
      ? await database
          .select({
            subscriptionId: reminderSent.subscriptionId,
            reminderDay: reminderSent.reminderDay,
          })
          .from(reminderSent)
          .where(
            and(
              inArray(reminderSent.subscriptionId, allSubscriptionIds),
              inArray(
                reminderSent.reminderDay,
                allLeadDayValues.map((d) => -d),
              ),
            ),
          )
      : [];
  const sentSet = new Set(existingReminders.map((r) => `${r.subscriptionId}:${r.reminderDay}`));

  const newRecords: Array<typeof reminderSent.$inferInsert> = [];
  const eventPromises: Promise<void>[] = [];

  // Process active subscriptions approaching expiry
  for (const sub of expiringSubscriptions) {
    if (!sub.expiresAt) continue;

    const daysUntilExpiry = Math.ceil(
      (sub.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (!leadDays.includes(daysUntilExpiry)) continue;
    if (sentSet.has(`${sub.id}:${-daysUntilExpiry}`)) continue;

    newRecords.push({
      id: generateId("rem"),
      subscriptionId: sub.id,
      reminderDay: -daysUntilExpiry,
      sentAt: new Date(),
    });

    const eventPayload: BirrJSEventMap["subscription.reminder"] = {
      customerId: sub.customerId,
      subscriptionId: sub.id,
      planId: sub.planId,
      planName: sub.planName ?? "",
      customerEmail: sub.customerEmail,
      customerPhone: sub.customerPhone,
      expiresAt: sub.expiresAt,
      daysUntilExpiry,
    };
    eventPromises.push(
      runEventHandlers(ctx.options.on, "subscription.reminder", eventPayload, logger),
      runPluginEventHandlers(ctx.options.plugins, "subscription.reminder", eventPayload, ctx),
    );
  }

  // Process trialing subscriptions approaching trial end
  for (const sub of trialingSubscriptions) {
    if (!sub.trialEndsAt) continue;

    const daysUntilTrialEnd = Math.ceil(
      (sub.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (!trialLeadDays.includes(daysUntilTrialEnd)) continue;
    if (sentSet.has(`${sub.id}:${-daysUntilTrialEnd}`)) continue;

    newRecords.push({
      id: generateId("rem"),
      subscriptionId: sub.id,
      reminderDay: -daysUntilTrialEnd,
      sentAt: new Date(),
    });

    const eventPayload: BirrJSEventMap["subscription.trial_ending"] = {
      customerId: sub.customerId,
      subscriptionId: sub.id,
      planId: sub.planId,
      planName: sub.planName ?? "",
      customerEmail: sub.customerEmail,
      customerPhone: sub.customerPhone,
      trialEndsAt: sub.trialEndsAt,
      daysUntilTrialEnd,
    };
    eventPromises.push(
      runEventHandlers(ctx.options.on, "subscription.trial_ending", eventPayload, logger),
      runPluginEventHandlers(ctx.options.plugins, "subscription.trial_ending", eventPayload, ctx),
    );
  }

  // Batch insert all dedup records
  if (newRecords.length > 0) {
    await database.insert(reminderSent).values(newRecords);
  }

  // Fire all events concurrently
  await Promise.allSettled(eventPromises);

  logger.info(
    `Sent ${newRecords.length} reminders (${expiringSubscriptions.length} expiring, ${trialingSubscriptions.length} trials ending)`,
  );

  return {
    checked: expiringSubscriptions.length + trialingSubscriptions.length,
    updated: newRecords.length,
  };
}

/**
 * HTTP endpoint to send reminders (requires cronSecret)
 */
export const sendRemindersEndpoint = defineBirrJSMethod(
  {
    route: {
      method: "POST",
      path: "/send-reminders",
      requireHeaders: true,
    },
  },
  async (ctx) => {
    validateCronAuth(ctx);

    const result = await sendReminders(ctx.birrjs);

    return {
      success: true,
      ...result,
    };
  },
);

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

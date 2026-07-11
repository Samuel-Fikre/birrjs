import { and, eq } from "drizzle-orm";

import { defineBirrJSMethod } from "../../api/endpoint";
import { VerifyReceiptRequestSchema } from "../../api/schemas";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import { runEventHandlers, runPluginEventHandlers } from "../../core/hooks";
import { generateId } from "../../core/utils";
import type { BirrJSDatabase } from "../../database";
import { customer, plan, reminderSent, subscription, usedReceipt } from "../../database/schema";
import { activateSubscriptionByTxRef } from "../../subscription/subscription-activation";
import type { BirrJSEventMap } from "../../types/events";

export const verifyReceipt = defineBirrJSMethod(
  {
    input: VerifyReceiptRequestSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/verify-receipt",
    },
  },
  async (ctx) => {
    const { subscriptionId, receiptUrl } = ctx.input;
    const { database, logger, runtime } = ctx.birrjs;
    const { customer: customerCtx } = ctx;

    const subscriptions = await database
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, subscriptionId), eq(subscription.customerId, customerCtx.id)))
      .limit(1);

    const sub = subscriptions[0];
    if (!sub) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
    }

    // check subscription can be activated
    if (sub.status === "active") {
      return { success: true, subscriptionId, alreadyActive: true };
    }

    if (sub.status !== "pending") {
      throw BirrJSError.from(
        "BAD_REQUEST",
        BIRRJS_ERROR_CODES.INVALID_INPUT,
        `Cannot activate subscription with status: ${sub.status}`,
      );
    }

    // verify receipt
    const verification = await runtime.verifyTransaction(receiptUrl);

    if (!verification.success) {
      throw BirrJSError.from(
        "BAD_REQUEST",
        BIRRJS_ERROR_CODES.RECEIPT_VERIFICATION_FAILED,
        verification.error ?? "Receipt verification failed",
      );
    }

    if (verification.status !== "completed") {
      throw BirrJSError.from(
        "BAD_REQUEST",
        BIRRJS_ERROR_CODES.RECEIPT_VERIFICATION_FAILED,
        `Receipt status is "${verification.status}", expected "completed"`,
      );
    }

    // verify amount
    const plans = await database
      .select({ priceAmount: plan.priceAmount })
      .from(plan)
      .where(eq(plan.internalId, sub.planId))
      .limit(1);

    const planRecord = plans[0];
    if (!planRecord) {
      throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_NOT_FOUND);
    }

    if (verification.amount != null && planRecord.priceAmount != null) {
      if (verification.amount < planRecord.priceAmount) {
        throw BirrJSError.from(
          "BAD_REQUEST",
          BIRRJS_ERROR_CODES.RECEIPT_AMOUNT_MISMATCH,
          `Receipt amount (${verification.amount}) is less than plan price (${planRecord.priceAmount})`,
        );
      }
    }

    if (!sub.providerTxRef) {
      throw BirrJSError.from(
        "BAD_REQUEST",
        BIRRJS_ERROR_CODES.INVALID_INPUT,
        "Subscription has no transaction reference",
      );
    }

    const txRef = sub.providerTxRef;

    const result = await database.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(usedReceipt)
        .values({ id: generateId("ur"), receiptUrl, subscriptionId })
        .onConflictDoNothing()
        .returning({ id: usedReceipt.id });

      if (!inserted) {
        throw BirrJSError.from("CONFLICT", BIRRJS_ERROR_CODES.DUPLICATE_RECEIPT);
      }

      return await activateSubscriptionByTxRef(tx as unknown as BirrJSDatabase, logger, txRef);
    });

    if (result.updated) {
      // Clear prior reminder records so new period starts fresh
      await database.delete(reminderSent).where(eq(reminderSent.subscriptionId, subscriptionId));

      // Fire subscription.activated events
      const [activatedSub] = await database
        .select({
          startedAt: subscription.startedAt,
          expiresAt: subscription.expiresAt,
          planName: plan.name,
          customerEmail: customer.email,
        })
        .from(subscription)
        .innerJoin(plan, eq(plan.internalId, subscription.planId))
        .innerJoin(customer, eq(customer.id, subscription.customerId))
        .where(eq(subscription.id, subscriptionId))
        .limit(1);

      const eventPayload: BirrJSEventMap["subscription.activated"] = {
        customerId: customerCtx.id,
        subscriptionId,
        planId: sub.planId,
        planName: activatedSub?.planName ?? "",
        customerEmail: activatedSub?.customerEmail ?? null,
        startedAt: activatedSub?.startedAt ?? null,
        expiresAt: activatedSub?.expiresAt ?? null,
      };

      Promise.resolve().then(() =>
        runEventHandlers(ctx.birrjs.options.on, "subscription.activated", eventPayload, logger),
      );
      Promise.resolve().then(() =>
        runPluginEventHandlers(
          ctx.birrjs.options.plugins,
          "subscription.activated",
          eventPayload,
          ctx.birrjs,
        ),
      );
    }

    return { success: true, subscriptionId };
  },
);

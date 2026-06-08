import { APIError } from "better-call";
import { and, eq } from "drizzle-orm";

import { defineBirrJSMethod } from "../../api/endpoint";
import { WebhookRequestSchema } from "../../api/schemas";
import type { WebhookPayload } from "../../api/schemas";
import { runEventHandlers } from "../../core/hooks";
import { generateId } from "../../core/utils";
import type { BirrJSDatabase } from "../../database";
import { subscription, webhookEvent } from "../../database/schema";
import { activateSubscriptionByTxRef } from "../../subscription/subscription-activation";
import type { BirrJSEventMap } from "../../types/events";

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export const handleWebhook = defineBirrJSMethod(
  {
    input: WebhookRequestSchema,
    route: {
      disableBody: true,
      method: "POST",
      path: "/handle-webhook",
      requireHeaders: true,
      requireRequest: true,
      resolveInput: async (ctx) => {
        const rawBody = await ctx.request!.text();
        const headers = headersToRecord(ctx.headers ?? new Headers());
        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          throw new APIError("BAD_REQUEST", {
            message: "Invalid JSON in webhook payload",
          });
        }
        return { payload, rawBody, headers };
      },
    },
  },
  async (ctx) => {
    const { database, logger, runtime } = ctx.birrjs;
    const { payload, rawBody, headers } = ctx.input as {
      payload: WebhookPayload;
      rawBody: string;
      headers: Record<string, string>;
    };

    logger.info({ event: payload.event, tx_ref: payload.tx_ref }, "Webhook received");

    // Call provider's handleWebhook method (provider handles signature verification)
    const providerEvent = await runtime.handleWebhook(payload, rawBody, headers);

    logger.info(
      { providerReferenceId: providerEvent.providerReferenceId, type: providerEvent.type },
      "Webhook processed by provider",
    );

    // Webhook-level idempotency: try insert first, let unique index handle races
    const providerId = ctx.birrjs.options.provider.id;
    const newEventId = generateId("wh");
    await database
      .insert(webhookEvent)
      .values({
        id: newEventId,
        providerId,
        providerReferenceId: providerEvent.providerReferenceId,
        type: providerEvent.type,
        payload: providerEvent.payload,
        status: "processing",
        receivedAt: new Date(),
      })
      .onConflictDoNothing();

    // Determine which event was actually committed (ours or a concurrent one)
    const [existingEvent] = await database
      .select({ id: webhookEvent.id, status: webhookEvent.status })
      .from(webhookEvent)
      .where(
        and(
          eq(webhookEvent.providerId, providerId),
          eq(webhookEvent.providerReferenceId, providerEvent.providerReferenceId),
        ),
      )
      .limit(1);

    if (!existingEvent) {
      throw new Error("Webhook event not found after insert");
    }

    if (existingEvent.id !== newEventId) {
      // Another request inserted this event first
      if (existingEvent.status === "completed") {
        logger.info(
          { providerId, providerReferenceId: providerEvent.providerReferenceId },
          "Duplicate webhook, skipping",
        );
        return { success: true, message: "Webhook already processed" };
      }
    }

    const webhookEventId = existingEvent.id;

    // Find subscription by providerTxRef (tx_ref from webhook)
    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.providerTxRef, providerEvent.providerReferenceId))
      .limit(1);

    const subscriptionRecord = subscriptions[0];

    if (!subscriptionRecord) {
      logger.warn(
        { tx_ref: providerEvent.providerReferenceId },
        "Subscription not found for webhook",
      );
      await database
        .update(webhookEvent)
        .set({ status: "ignored", processedAt: new Date() })
        .where(eq(webhookEvent.id, webhookEventId));
      return { success: true, message: "Webhook processed (subscription not found)" };
    }

    // Map webhook event type to subscription status
    const eventType = providerEvent.type;
    let newStatus: string;
    const updateFields: {
      status: string;
      updatedAt: Date;
      lastPaymentAt?: Date;
      startedAt?: Date;
      expiresAt?: Date;
    } = {
      status: "",
      updatedAt: new Date(),
    };

    switch (eventType) {
      case "charge.success": {
        const result = await database.transaction(async (tx) => {
          const activation = await activateSubscriptionByTxRef(
            tx as unknown as BirrJSDatabase,
            logger,
            providerEvent.providerReferenceId,
          );
          await tx
            .update(webhookEvent)
            .set({ status: "completed", processedAt: new Date() })
            .where(eq(webhookEvent.id, webhookEventId));
          return activation;
        });

        if (result.updated) {
          logger.info(
            { subscriptionId: result.subscriptionId, eventType },
            "Subscription activated via webhook",
          );

          const [activatedSub] = await database
            .select({ startedAt: subscription.startedAt, expiresAt: subscription.expiresAt })
            .from(subscription)
            .where(eq(subscription.id, result.subscriptionId!))
            .limit(1);

          const eventPayload: BirrJSEventMap["subscription.activated"] = {
            customerId: subscriptionRecord.customerId,
            subscriptionId: subscriptionRecord.id,
            planId: subscriptionRecord.planId,
            startedAt: activatedSub?.startedAt ?? null,
            expiresAt: activatedSub?.expiresAt ?? null,
          };
          await runEventHandlers(
            ctx.birrjs.options.on,
            "subscription.activated",
            eventPayload,
            logger,
          );
        }

        return { success: true, message: "Webhook processed successfully" };
      }
      case "charge.failed/cancelled":
        // Don't mark active subscriptions as failed (renewal attempt failed,
        // but current access is still valid until current expiry)
        if (subscriptionRecord.status === "active") {
          logger.info(
            { subscriptionId: subscriptionRecord.id },
            "Renewal payment failed, current subscription remains active",
          );
          await database
            .update(webhookEvent)
            .set({ status: "completed", processedAt: new Date() })
            .where(eq(webhookEvent.id, webhookEventId));
          return { success: true, message: "Renewal payment failed, subscription unchanged" };
        }
        newStatus = "failed";
        break;
      case "charge.reversed":
        newStatus = "cancelled";
        break;
      case "charge.refunded":
        newStatus = "cancelled";
        break;
      default:
        logger.warn({ eventType }, "Unknown webhook event");
        await database
          .update(webhookEvent)
          .set({ status: "ignored", processedAt: new Date() })
          .where(eq(webhookEvent.id, webhookEventId));
        return { success: true, message: "Unknown event ignored" };
    }

    updateFields.status = newStatus;

    try {
      await database.transaction(async (tx) => {
        await tx
          .update(subscription)
          .set(updateFields)
          .where(eq(subscription.id, subscriptionRecord.id));

        await tx
          .update(webhookEvent)
          .set({ status: "completed", processedAt: new Date() })
          .where(eq(webhookEvent.id, webhookEventId));
      });
    } catch (error) {
      await database
        .update(webhookEvent)
        .set({ status: "failed", error: String(error), processedAt: new Date() })
        .where(eq(webhookEvent.id, webhookEventId));
      throw error;
    }

    logger.info(
      {
        subscriptionId: subscriptionRecord.id,
        oldStatus: subscriptionRecord.status,
        newStatus,
        eventType,
      },
      "Subscription status updated via webhook",
    );

    const [cancelledSub] = await database
      .select({ canceledAt: subscription.canceledAt, endedAt: subscription.endedAt })
      .from(subscription)
      .where(eq(subscription.id, subscriptionRecord.id))
      .limit(1);

    const cancelPayload: BirrJSEventMap["subscription.cancelled"] = {
      customerId: subscriptionRecord.customerId,
      subscriptionId: subscriptionRecord.id,
      planId: subscriptionRecord.planId,
      canceledAt: cancelledSub?.canceledAt ?? null,
      endedAt: cancelledSub?.endedAt ?? null,
    };
    await runEventHandlers(ctx.birrjs.options.on, "subscription.cancelled", cancelPayload, logger);

    return { success: true, message: "Webhook processed successfully" };
  },
);

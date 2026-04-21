import { eq } from "drizzle-orm";
import { defineBirrJSMethod } from "../../api/endpoint";
import { subscription } from "../../database/schema";
import { WebhookRequestSchema } from "../../api/schemas";
import type { WebhookPayload } from "../../api/schemas";

export const handleWebhook = defineBirrJSMethod(
  {
    input: WebhookRequestSchema,
    route: {
      method: "POST",
      path: "/handle-webhook",
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
    const webhookEvent = await runtime.handleWebhook(payload, rawBody, headers);

    logger.info(
      { providerReferenceId: webhookEvent.providerReferenceId, type: webhookEvent.type },
      "Webhook processed by provider",
    );

    // Find subscription by providerTxRef (tx_ref from webhook)
    const subscriptions = await database
      .select()
      .from(subscription)
      .where(eq(subscription.providerTxRef, webhookEvent.providerReferenceId))
      .limit(1);

    const subscriptionRecord = subscriptions[0];

    if (!subscriptionRecord) {
      logger.warn(
        { tx_ref: webhookEvent.providerReferenceId },
        "Subscription not found for webhook",
      );
      // Return success anyway to avoid retry spam
      return { success: true, message: "Webhook processed (subscription not found)" };
    }

    // Map webhook event type to subscription status
    const eventType = webhookEvent.type;
    let newStatus: string;
    let updateFields: { status: string; updatedAt: Date; lastPaymentAt?: Date } = {
      status: "",
      updatedAt: new Date(),
    };

    switch (eventType) {
      case "charge.success":
        newStatus = "active";
        updateFields.lastPaymentAt = new Date();
        break;
      case "charge.failed/cancelled":
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
        return { success: true, message: "Unknown event ignored" };
    }

    updateFields.status = newStatus;

    // Skip update if status unchanged (idempotency)
    if (subscriptionRecord.status === newStatus) {
      logger.info(
        { subscriptionId: subscriptionRecord.id, status: newStatus },
        "Webhook received but status already matches",
      );
      return { success: true, message: "Webhook processed (no status change)" };
    }

    // Update subscription status
    await database
      .update(subscription)
      .set(updateFields)
      .where(eq(subscription.id, subscriptionRecord.id));

    logger.info(
      {
        subscriptionId: subscriptionRecord.id,
        oldStatus: subscriptionRecord.status,
        newStatus,
        eventType,
      },
      "Subscription status updated via webhook",
    );

    return { success: true, message: "Webhook processed successfully" };
  },
);

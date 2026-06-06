import { APIError } from "better-call";
import * as z from "zod";

import { defineBirrJSMethod } from "../../api/endpoint";
import { activateSubscriptionByTxRef } from "../../subscription/subscription-activation";

export const handleWebhookCallback = defineBirrJSMethod(
  {
    input: z.object({}),
    route: {
      method: "GET",
      path: "/handle-webhook",
      resolveInput: async (ctx) => {
        if (!ctx.request) {
          throw new APIError("BAD_REQUEST", { message: "No request" });
        }
        const url = new URL(ctx.request.url);
        const trx_ref = url.searchParams.get("trx_ref");
        const ref_id = url.searchParams.get("ref_id");
        const status = url.searchParams.get("status");

        if (!trx_ref) {
          throw new APIError("BAD_REQUEST", { message: "Missing trx_ref" });
        }

        return { trx_ref, ref_id, status };
      },
    },
  },
  async (ctx) => {
    const { trx_ref, status } = ctx.input as unknown as {
      trx_ref: string;
      ref_id: string | null;
      status: string | null;
    };
    const { database, logger, runtime } = ctx.birrjs;

    logger.info({ trx_ref, status }, "Callback received");

    if (status !== "success") {
      logger.info({ trx_ref, status }, "Callback status not success, skipping");
      return { success: true, message: "Callback received" };
    }

    // Verify transaction with provider to confirm authenticity
    const verification = await runtime.verifyTransaction(trx_ref);

    if (!verification.success || verification.status !== "success") {
      logger.warn(
        { trx_ref, verificationStatus: verification.status },
        "Callback verification failed",
      );
      return { success: true, message: "Callback processed (verification failed)" };
    }

    logger.info({ trx_ref }, "Callback transaction verified");

    const result = await activateSubscriptionByTxRef(database, logger, trx_ref);

    if (result.updated) {
      logger.info(
        { subscriptionId: result.subscriptionId, trx_ref },
        "Subscription activated via callback",
      );
    } else {
      logger.info(
        { subscriptionId: result.subscriptionId, trx_ref },
        "Subscription already active via callback",
      );
    }

    return { success: true, message: "Callback processed successfully" };
  },
);

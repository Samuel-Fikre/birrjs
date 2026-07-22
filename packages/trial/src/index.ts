import { createHash } from "node:crypto";

import { normalizePhone } from "@birrjs/core";
import type { BirrJSPlugin } from "@birrjs/core";

import type { TrialConfig } from "./types";

export function trial(config?: TrialConfig): BirrJSPlugin {
  const maxTrials = config?.maxTrialsPerCustomer ?? 1;

  return {
    id: "trial",
    onBeforeSubscribe: async (ctx) => {
      if (!ctx.plan.trialDays) return;

      const phoneHash = ctx.customerPhone
        ? createHash("sha256").update(normalizePhone(ctx.customerPhone)).digest("hex")
        : undefined;

      const redemptionCount = await ctx.queries.countRedemptions({
        customerId: ctx.customerId,
        customerEmail: ctx.customerEmail,
        phoneHash,
        fingerprint: ctx.fingerprint,
      });

      if (redemptionCount >= maxTrials) return;

      return { isTrialEligible: true };
    },
  };
}

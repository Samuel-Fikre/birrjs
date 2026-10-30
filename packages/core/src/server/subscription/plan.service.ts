import { eq } from "drizzle-orm";

import type { BirrJSDatabase } from "../../database";
import { feature, plan, planFeature } from "../../database/schema";
import type { FeatureType, NormalizedPlan, PriceInterval, ResetInterval } from "../../plans/schema";

/**
 * Reads a stored plan version back into the `NormalizedPlan` shape that plugin
 * hooks and the plan sync both use, so hook payloads look the same whether a
 * plan came from `plans.ts` config or from a webhook.
 */
export async function loadNormalizedPlan(
  database: BirrJSDatabase,
  internalId: string,
): Promise<NormalizedPlan> {
  const planRecord = await database.query.plan.findFirst({
    where: eq(plan.internalId, internalId),
  });
  if (!planRecord) {
    throw new Error(`Plan version ${internalId} is missing`);
  }

  const includes = await database
    .select({
      featureId: planFeature.featureId,
      limit: planFeature.limit,
      resetInterval: planFeature.resetInterval,
      config: planFeature.config,
      type: feature.type,
    })
    .from(planFeature)
    .innerJoin(feature, eq(feature.id, planFeature.featureId))
    .where(eq(planFeature.planId, internalId));

  return {
    id: planRecord.id,
    name: planRecord.name,
    group: planRecord.group ?? null,
    includes: includes.map((row) => ({
      config: row.config,
      id: row.featureId,
      limit: row.limit,
      resetInterval: row.resetInterval as ResetInterval | null,
      type: row.type as FeatureType,
    })),
    isDefault: planRecord.isDefault,
    trialDays: planRecord.trialDays,
    resetOnTrialConversion: planRecord.resetOnTrialConversion,
    priceAmount: planRecord.priceAmount,
    priceInterval: planRecord.priceInterval as PriceInterval | null,
    currency: planRecord.currency ?? "ETB",
    hash: planRecord.hash ?? "",
  };
}

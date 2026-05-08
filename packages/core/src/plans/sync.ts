import { eq } from "drizzle-orm";

import type { BirrJSContext } from "../context";
import { generateId } from "../core/utils";
import type { BirrJSDatabase } from "../database";
import { plan, planFeature } from "../database/schema";
import type { NewPlan, StoredPlan, PlanFeature, StoredPlanSnapshot } from "../types/models";
import type { BirrJSPlan, NormalizedPlan, NormalizedPlanFeature } from "./schema";
import { normalizePlan } from "./schema";

export interface SyncPlanResult {
  id: string;
  version: number;
  action: "created" | "updated" | "unchanged";
}

function serializeFeatureConfig(config: Record<string, unknown> | null): string {
  return JSON.stringify(config ?? null);
}

function featuresChanged(
  existing: readonly PlanFeature[],
  next: readonly NormalizedPlanFeature[],
): boolean {
  if (existing.length !== next.length) {
    return true;
  }

  return existing.some((storedFeature, index) => {
    const nextFeature = next[index];
    if (!nextFeature) {
      return true;
    }

    return (
      storedFeature.featureId !== nextFeature.id ||
      storedFeature.limit !== nextFeature.limit ||
      storedFeature.resetInterval !== nextFeature.resetInterval ||
      serializeFeatureConfig(storedFeature.config) !== serializeFeatureConfig(nextFeature.config)
    );
  });
}

function planChanged(
  existing: Awaited<ReturnType<typeof getLatestPlanSnapshot>>,
  next: NormalizedPlan,
): boolean {
  if (!existing) {
    return true;
  }

  return (
    existing.plan.group !== next.group ||
    existing.plan.isDefault !== next.isDefault ||
    existing.plan.priceAmount !== next.priceAmount ||
    existing.plan.priceInterval !== next.priceInterval ||
    featuresChanged(existing.features, next.includes)
  );
}

async function getLatestPlan(database: BirrJSDatabase, planId: string): Promise<StoredPlan | null> {
  const result = await database.query.plan.findFirst({
    where: eq(plan.id, planId),
    orderBy: (p, { desc }) => [desc(p.version)],
  });

  return result ?? null;
}

async function getPlanFeatures(
  database: BirrJSDatabase,
  internalId: string,
): Promise<readonly PlanFeature[]> {
  return await database.query.planFeature.findMany({
    where: eq(planFeature.planId, internalId),
    orderBy: (pf) => [pf.featureId],
  });
}

async function getLatestPlanSnapshot(
  database: BirrJSDatabase,
  planId: string,
): Promise<StoredPlanSnapshot | null> {
  const plan = await getLatestPlan(database, planId);
  if (!plan) {
    return null;
  }

  const features = await getPlanFeatures(database, plan.internalId);

  return { plan, features };
}

async function insertPlanVersion(database: BirrJSDatabase, input: NewPlan) {
  const now = new Date();
  const internalId = generateId("plan");
  return await database
    .insert(plan)
    .values({
      createdAt: now,
      updatedAt: now,
      group: input.group,
      id: input.id,
      internalId,
      isDefault: input.isDefault,
      name: input.name,
      priceAmount: input.priceAmount,
      priceInterval: input.priceInterval,
      currency: input.currency,
      provider: input.provider,
      version: input.version,
    })
    .returning();
}

async function replacePlanFeatures(
  database: BirrJSDatabase,
  params: { features: readonly NormalizedPlanFeature[]; planId: string },
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.delete(planFeature).where(eq(planFeature.planId, params.planId));

    if (params.features.length === 0) {
      return;
    }

    const now = new Date();
    const featureValues = params.features.map((feature) => ({
      planId: params.planId,
      featureId: feature.id,
      limit: feature.limit,
      resetInterval: feature.resetInterval,
      config: feature.config,
      createdAt: now,
      updatedAt: now,
    }));

    await tx.insert(planFeature).values(featureValues);
  });
}

async function updatePlanName(database: BirrJSDatabase, planId: string, name: string) {
  await database.update(plan).set({ name, updatedAt: new Date() }).where(eq(plan.id, planId));
}

async function upsertPlanVersion(database: BirrJSDatabase, plan: NormalizedPlan, version: number) {
  const internalId = generateId("plan");
  const inserted = await insertPlanVersion(database, {
    group: plan.group,
    id: plan.id,
    internalId,
    isDefault: plan.isDefault,
    name: plan.name,
    priceAmount: plan.priceAmount,
    priceInterval: plan.priceInterval,
    version,
    currency: plan.currency,
  });

  const storedPlan = inserted[0] ?? null;
  if (!storedPlan) {
    throw new Error(`Failed to insert plan "${plan.id}" version ${version}`);
  }

  await replacePlanFeatures(database, {
    features: plan.includes,
    planId: storedPlan.internalId,
  });

  return storedPlan;
}

/**
 * Sync code-first plans to database
 */
export async function syncPlans(
  ctx: BirrJSContext,
  plans: BirrJSPlan[],
): Promise<SyncPlanResult[]> {
  const { database, logger, provider } = ctx;
  const currency = provider.currency ?? "ETB";
  const results: SyncPlanResult[] = [];

  for (const plan of plans) {
    const existing = await getLatestPlanSnapshot(database, plan.id);
    const normalizedPlan = normalizePlan(plan, currency);

    let storedPlan = existing?.plan ?? null;
    let action: SyncPlanResult["action"] = "unchanged";

    if (!existing) {
      storedPlan = await upsertPlanVersion(database, normalizedPlan, 1);
      action = "created";
    } else if (planChanged(existing, normalizedPlan)) {
      storedPlan = await upsertPlanVersion(database, normalizedPlan, existing.plan.version + 1);
      action = "created";
    } else if (existing.plan.name !== plan.name) {
      await updatePlanName(database, plan.id, plan.name);
      storedPlan = { ...existing.plan, name: plan.name };
      action = "updated";
    }

    if (!storedPlan) {
      throw new Error(`Failed to sync plan "${plan.id}"`);
    }

    logger.info(
      { planId: plan.id, version: storedPlan.version, action },
      action === "unchanged" ? "Plan unchanged" : `Plan ${action} in database`,
    );

    results.push({
      action,
      id: plan.id,
      version: storedPlan.version,
    });
  }

  return results;
}

/**
 * Get plans from code-first definition
 */
export function getCodeFirstPlans(ctx: BirrJSContext) {
  return ctx.options.plans || [];
}

import { and, eq } from "drizzle-orm";

import type { BirrJSContext } from "../context";
import { generateId } from "../core/utils";
import type { BirrJSDatabase } from "../database";
import { feature, plan, planFeature } from "../database/schema";
import type { NewPlan, StoredPlan, PlanFeature, StoredPlanSnapshot } from "../types/models";
import type { BirrJSPlan, NormalizedPlan, NormalizedPlanFeature } from "./schema";
import { normalizePlan } from "./schema";

function validateFeatureTypes(plans: readonly BirrJSPlan[]): void {
  const seen = new Map<string, string>();

  for (const p of plans) {
    for (const include of p.includes ?? []) {
      const existingType = seen.get(include.feature.id);
      if (existingType && existingType !== include.feature.type) {
        throw new Error(
          `Feature "${include.feature.id}" has conflicting types: "${existingType}" in one plan and "${include.feature.type}" in plan "${p.id}".`,
        );
      }
      seen.set(include.feature.id, include.feature.type);
    }
  }
}

export interface SyncPlanResult {
  id: string;
  version: number;
  action: "created" | "updated" | "unchanged";
}

function planChanged(
  existing: Awaited<ReturnType<typeof getLatestPlanSnapshot>>,
  next: NormalizedPlan,
): boolean {
  if (!existing) {
    return true;
  }

  return existing.plan.hash !== next.hash;
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

async function insertPlanVersion(
  database: BirrJSDatabase,
  input: Omit<NewPlan, "internalId" | "provider">,
) {
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
      trialDays: input.trialDays,
      resetOnTrialConversion: input.resetOnTrialConversion,
      currency: input.currency,
      hash: input.hash,
      provider: {},
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

async function upsertPlanVersion(database: BirrJSDatabase, np: NormalizedPlan, version: number) {
  return await database.transaction(async (tx) => {
    const db = tx as unknown as BirrJSDatabase;

    if (np.isDefault) {
      await tx
        .update(plan)
        .set({ isDefault: false })
        .where(and(eq(plan.id, np.id), eq(plan.isDefault, true)));
    }

    const inserted = await insertPlanVersion(db, {
      group: np.group ?? undefined,
      hash: np.hash,
      id: np.id,
      isDefault: np.isDefault,
      name: np.name,
      priceAmount: np.priceAmount,
      priceInterval: np.priceInterval,
      trialDays: np.trialDays,
      resetOnTrialConversion: np.resetOnTrialConversion,
      version,
      currency: np.currency,
    });

    const storedPlan = inserted[0] ?? null;
    if (!storedPlan) {
      throw new Error(`Failed to insert plan "${np.id}" version ${version}`);
    }

    await replacePlanFeatures(db, {
      features: np.includes,
      planId: storedPlan.internalId,
    });

    return storedPlan;
  });
}

/**
 * Sync code-first plans to database
 */
export async function syncPlans(
  ctx: BirrJSContext,
  plans: readonly BirrJSPlan[],
): Promise<SyncPlanResult[]> {
  validateFeatureTypes(plans);
  const { database, logger, provider } = ctx;
  const currency = provider.currency ?? "ETB";
  const results: SyncPlanResult[] = [];

  // Upsert all features in a single pass before processing plans
  const allFeatures = new Map<string, string>();
  for (const p of plans) {
    for (const include of p.includes ?? []) {
      allFeatures.set(include.feature.id, include.feature.type);
    }
  }
  const featureUpsertNow = new Date();
  for (const [id, type] of allFeatures) {
    await database
      .insert(feature)
      .values({ id, type, createdAt: featureUpsertNow, updatedAt: featureUpsertNow })
      .onConflictDoUpdate({
        target: feature.id,
        set: { type, updatedAt: featureUpsertNow },
      });
  }

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

export async function dryRunSyncPlans(
  ctx: BirrJSContext,
  plans: readonly BirrJSPlan[],
): Promise<SyncPlanResult[]> {
  validateFeatureTypes(plans);
  const { database, provider } = ctx;
  const currency = provider.currency ?? "ETB";
  const results: SyncPlanResult[] = [];

  for (const plan of plans) {
    const existing = await getLatestPlanSnapshot(database, plan.id);
    const normalizedPlan = normalizePlan(plan, currency);
    let action: SyncPlanResult["action"] = "unchanged";

    if (!existing) {
      action = "created";
    } else if (planChanged(existing, normalizedPlan)) {
      action = "created";
    } else if (existing.plan.name !== plan.name) {
      action = "updated";
    }

    results.push({
      id: plan.id,
      version: existing?.plan.version ?? 1,
      action,
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

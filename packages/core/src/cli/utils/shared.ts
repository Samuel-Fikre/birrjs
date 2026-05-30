import type { Pool } from "pg";

import type { createContext, BirrJSContext } from "../../context";
import type { getPendingMigrationCount, migrateDatabase } from "../../database/migrate";
import type { NormalizedPlan } from "../../plans/schema";
import type { dryRunSyncPlans, syncPlans } from "../../plans/sync";
import type { detectPackageManager, getInstallCommand, getRunCommand } from "./detect";
import type { formatPlanLine, formatPrice, getConnectionString } from "./format";
import type { getBirrJSConfig, LoadedConfig } from "./get-config";

export interface CliDeps {
  Pool: typeof Pool;
  createContext: typeof createContext;
  getPendingMigrationCount: typeof getPendingMigrationCount;
  migrateDatabase: typeof migrateDatabase;
  dryRunSyncPlans: typeof dryRunSyncPlans;
  syncPlans: typeof syncPlans;
  formatPlanLine: typeof formatPlanLine;
  formatPrice: typeof formatPrice;
  getConnectionString: typeof getConnectionString;
  getBirrJSConfig: typeof getBirrJSConfig;
  detectPackageManager: typeof detectPackageManager;
  getInstallCommand: typeof getInstallCommand;
  getRunCommand: typeof getRunCommand;
}

export async function loadCliDeps(): Promise<CliDeps> {
  const [pg, context, database, productSync, format, getConfig, detect] = await Promise.all([
    import("pg"),
    import("../../context"),
    import("../../database/migrate"),
    import("../../plans/sync"),
    import("../utils/format"),
    import("../utils/get-config"),
    import("../utils/detect"),
  ]);

  return {
    Pool: pg.Pool,
    createContext: context.createContext,
    getPendingMigrationCount: database.getPendingMigrationCount,
    migrateDatabase: database.migrateDatabase,
    dryRunSyncPlans: productSync.dryRunSyncPlans,
    syncPlans: productSync.syncPlans,
    formatPlanLine: format.formatPlanLine,
    formatPrice: format.formatPrice,
    getConnectionString: format.getConnectionString,
    getBirrJSConfig: getConfig.getBirrJSConfig,
    detectPackageManager: detect.detectPackageManager,
    getInstallCommand: detect.getInstallCommand,
    getRunCommand: detect.getRunCommand,
  };
}

export function createPool(deps: Pick<CliDeps, "Pool">, database: Pool | string): Pool {
  return typeof database === "string" ? new deps.Pool({ connectionString: database }) : database;
}

export interface PlanDiff {
  action: "created" | "updated" | "unchanged";
  id: string;
}

export function formatPlanDiffs(
  diffs: PlanDiff[],
  plans: readonly NormalizedPlan[],
  deps: Pick<CliDeps, "formatPlanLine" | "formatPrice">,
): string[] {
  const plansById = new Map(plans.map((pl) => [pl.id, pl]));
  return diffs.map((diff) => {
    const plan = plansById.get(diff.id);
    const price = plan ? deps.formatPrice(plan.priceAmount ?? null, plan.priceInterval) : "";
    return deps.formatPlanLine(diff.action, diff.id, price);
  });
}

export async function checkDatabase(
  database: Pool,
  deps: Pick<CliDeps, "getPendingMigrationCount">,
): Promise<{ ok: true; pendingMigrations: number } | { ok: false; message: string }> {
  try {
    await database.query("SELECT 1");
    const count = await deps.getPendingMigrationCount(database);
    return { ok: true, pendingMigrations: count };
  } catch (error) {
    const err = error as { message?: string; code?: string };
    const message = err.message || err.code || "Connection failed";
    return { ok: false, message };
  }
}

export async function loadPlanDiffs(
  config: LoadedConfig,
  deps: Pick<CliDeps, "createContext" | "dryRunSyncPlans">,
): Promise<{ ctx: BirrJSContext; diffs: PlanDiff[] }> {
  const ctx = await deps.createContext(config.options);
  const plans = config.options.plans ?? [];
  const diffs = await deps.dryRunSyncPlans(ctx, plans);
  return { ctx, diffs };
}

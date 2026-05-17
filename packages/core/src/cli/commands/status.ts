import path from "node:path";

import * as p from "@clack/prompts";
import { Command } from "@commander-js/extra-typings";
import picocolors from "picocolors";

import { normalizePlan } from "../../plans/schema";
import type { NormalizedPlan } from "../../plans/schema";
import {
  checkDatabase,
  createPool,
  formatPlanDiffs,
  loadCliDeps,
  loadPlanDiffs,
} from "../utils/shared";

async function statusAction(options: {
  config?: string;
  cwd: string;
  throw?: boolean;
}): Promise<void> {
  const cwd = path.resolve(options.cwd);
  const s = p.spinner();

  s.start("Checking");

  const deps = await loadCliDeps();

  let config;
  try {
    config = await deps.getBirrJSConfig({ configPath: options.config, cwd });
  } catch (error) {
    s.stop("");
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(`Config\n  ${picocolors.red("✖")} ${message}`);
    p.outro("Fix config before continuing");
    process.exit(1);
  }
  const pushCmd = deps.getRunCommand(await deps.detectPackageManager(cwd), "birrjs push");

  const planCount = config.options.plans ? config.options.plans.length : 0;
  const hasProvider = Boolean(config.options.provider);

  if (!hasProvider) {
    s.stop("");
    p.log.error(
      `Config\n` +
        `  ${picocolors.green("✔")} ${picocolors.dim(config.path)}\n` +
        `  ${picocolors.green("✔")} ${String(planCount)} plan${planCount === 1 ? "" : "s"} defined\n` +
        `  ${picocolors.red("✖")} No provider configured`,
    );
    p.outro("Fix config issues before continuing");
    process.exit(1);
  }

  const database = createPool(deps, config.options.database);
  const connStr = deps.getConnectionString(database as never);

  const dbResult = await checkDatabase(database, deps);

  if (!dbResult.ok) {
    s.stop("");
    p.log.error(`Database\n  ${picocolors.red("✖")} ${connStr}\n  ${dbResult.message}`);
    p.outro("Fix database issues before continuing");
    await database.end();
    process.exit(1);
  }

  const pendingMigrations = dbResult.pendingMigrations;

  let needsSync = false;
  let plansBlock: string;
  const plans = config.options.plans ?? [];

  if (pendingMigrations > 0) {
    plansBlock = `Plans\n  ${picocolors.dim("?")} Cannot check sync status until migrations are applied`;
  } else if (plans.length === 0) {
    plansBlock = `Plans\n  ${picocolors.dim("No plans defined")}`;
  } else {
    const { ctx, diffs } = await loadPlanDiffs(config, deps);

    const allSynced = diffs.every((d) => d.action === "unchanged");
    if (!allSynced) needsSync = true;

    const header = allSynced
      ? `${picocolors.green("✔")} All synced`
      : `${picocolors.red("✖")} Not synced (run ${picocolors.bold(pushCmd)})`;

    const normalizedPlans: readonly NormalizedPlan[] = plans.map((p) =>
      normalizePlan(p, ctx.provider.currency ?? "ETB"),
    );
    const planLines = formatPlanDiffs(diffs, normalizedPlans, deps);
    plansBlock = `Plans\n  ${header}\n${planLines.join("\n")}`;

    await ctx.destroy();
  }

  await database.end();

  const migrationStatus =
    pendingMigrations > 0
      ? `${picocolors.red("✖")} Schema needs migration`
      : `${picocolors.green("✔")} Schema up to date`;

  s.stop("");

  p.log.info(
    `Config\n` +
      `  ${picocolors.green("✔")} ${picocolors.dim(config.path)}\n` +
      `  ${picocolors.green("✔")} ${String(planCount)} plan${planCount === 1 ? "" : "s"} defined\n` +
      `  ${picocolors.green("✔")} Provider configured`,
  );

  p.log.info(`Database\n  ${picocolors.green("✔")} ${connStr}\n  ${migrationStatus}`);

  p.log.info(plansBlock);

  const needsMigration = pendingMigrations > 0;
  const hasIssues = needsMigration || needsSync;

  if (hasIssues) {
    const action =
      needsMigration && needsSync
        ? "apply migrations and sync plans"
        : needsMigration
          ? "apply migrations"
          : "sync plans";
    p.outro(`Run ${picocolors.bold(pushCmd)} to ${action}`);
    if (options.throw) process.exit(1);
  } else {
    p.outro("Everything looks good");
  }
}

export const statusCommand = new Command("status")
  .description("Check BirrJS configuration and sync status")
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd(),
  )
  .option("--config <config>", "the path to the BirrJS configuration file to load.")
  .option("--throw", "exit with code 1 if there are issues")
  .action(statusAction);

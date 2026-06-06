import path from "node:path";

import * as p from "@clack/prompts";
import { Command } from "@commander-js/extra-typings";
import picocolors from "picocolors";

import type { BirrJSContext } from "../../context";
import {
  checkDatabase,
  createPool,
  loadCliDeps,
  loadPlanDiffs,
  type PlanDiff,
} from "../utils/shared";

async function pushAction(options: { config?: string; cwd: string; yes?: boolean }): Promise<void> {
  const cwd = path.resolve(options.cwd);
  const s = p.spinner();

  s.start("Connecting");

  const deps = await loadCliDeps();
  const config = await deps.getBirrJSConfig({ configPath: options.config, cwd });
  const database = createPool(deps, config.options.database);
  let syncCtx: BirrJSContext | undefined;

  try {
    const connStr = deps.getConnectionString(database as never);
    const dbResult = await checkDatabase(database, deps);

    if (!dbResult.ok) {
      s.stop("");
      p.log.error(`Database\n  ${picocolors.red("✖")} ${connStr}\n  ${dbResult.message}`);
      p.cancel("Push failed");
      process.exit(1);
    }

    const pendingMigrations = dbResult.pendingMigrations;

    if (pendingMigrations > 0) {
      s.message("Applying migrations");
      await deps.migrateDatabase(database);
    }

    s.message("Checking plans");
    const plans = config.options.plans ?? [];
    let diffs: PlanDiff[] = [];

    if (plans.length > 0) {
      const { ctx, diffs: planDiffs } = await loadPlanDiffs(config, deps);
      diffs = planDiffs;
      syncCtx = ctx;
    }

    s.stop("");

    const migrationStatus =
      pendingMigrations > 0
        ? `${picocolors.green("✔")} Migrated (${String(pendingMigrations)} applied)`
        : `${picocolors.green("✔")} Schema up to date`;

    p.log.info(`Database\n  ${picocolors.green("✔")} ${connStr}\n  ${migrationStatus}`);

    const hasChanges = diffs.some((d) => d.action !== "unchanged");

    if (!hasChanges && pendingMigrations === 0) {
      p.outro("Nothing to do");
      return;
    }

    if (pendingMigrations > 0 && !hasChanges) {
      p.outro("Done");
      return;
    }

    if (diffs.length > 0) {
      const planChanged = diffs.filter((d) => d.action !== "unchanged");
      const planLines = diffs.map((diff) => {
        const plan = plans.find((p) => p.id === diff.id);
        const price = plan?.price
          ? deps.formatPrice(plan.price.amount * 100, plan.price.interval)
          : "";
        return deps.formatPlanLine(diff.action, diff.id, price);
      });
      const header =
        planChanged.length > 0
          ? `${picocolors.red("✖")} ${String(planChanged.length)} plan${planChanged.length === 1 ? "" : "s"} out of sync`
          : `${picocolors.green("✔")} All plans synced`;
      p.log.info(`Plans\n  ${header}\n${planLines.join("\n")}`);
    }

    const changeCount = diffs.filter((d) => d.action !== "unchanged").length;
    if (changeCount > 0 && !options.yes) {
      const shouldContinue = await p.confirm({
        message: `Push ${String(changeCount)} plan change${changeCount === 1 ? "" : "s"}?`,
      });
      if (p.isCancel(shouldContinue) || !shouldContinue) {
        p.cancel("Aborted");
        process.exit(0);
      }
    }

    if (changeCount > 0 && plans.length > 0 && syncCtx) {
      s.start("Syncing plans");
      const results = await deps.syncPlans(syncCtx, plans);
      const syncedCount = results.filter((r) => r.action !== "unchanged").length;
      s.stop("");
      p.outro(
        `Done ${picocolors.dim("·")} synced ${String(syncedCount)} plan${syncedCount === 1 ? "" : "s"}`,
      );
    }
  } catch (error) {
    s.stop("");
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(message);
    p.cancel("Push failed");
    process.exit(1);
  } finally {
    await syncCtx?.destroy();
    await database.end();
  }
}

export const pushCommand = new Command("push")
  .description("Apply migrations and sync plans to database")
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd(),
  )
  .option("--config <config>", "the path to the BirrJS configuration file to load.")
  .option("-y, --yes", "skip confirmation prompt")
  .action(pushAction);

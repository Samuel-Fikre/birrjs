import { Pool } from "pg";
import picocolors from "picocolors";

import type { BirrJSContext } from "../context";
import { createContext } from "../context";
import { getPendingMigrationCount } from "../database/migrate";
import type { PlanIdFromOptions, FeatureIdFromOptions } from "../plans/schema";
import { dryRunSyncPlans, syncPlans } from "../plans/sync";
import { getApi, createBirrJSRouter } from "../server";
import type { BirrJSClientAPI, BirrJSAPI } from "../server/index";
import type { BirrJSOptions } from "../types";
import type { BirrJSClientApiCarrier } from "../types/instance";

const birrInstanceSymbol = Symbol.for("birr.instance");

const _global = globalThis as unknown as { __birrjsDevChecksRan?: boolean };

async function runDevChecks(ctx: BirrJSContext, pool: Pool): Promise<void> {
  if (_global.__birrjsDevChecksRan) return;
  _global.__birrjsDevChecksRan = true;

  await Promise.allSettled([
    getPendingMigrationCount(pool).then((count) => {
      if (count > 0) {
        console.warn(
          `${picocolors.yellow("[birrjs]")} ${count} pending migration${count === 1 ? "" : "s"}. Run ${picocolors.bold("birrjs push")} to apply.`,
        );
      }
    }),
    (async () => {
      const plans = ctx.options.plans;
      if (!plans || plans.length === 0) return;
      const results = await dryRunSyncPlans(ctx, plans);
      const outOfSync = results.filter((r) => r.action !== "unchanged");
      if (outOfSync.length > 0) {
        console.warn(
          `${picocolors.yellow("[birrjs]")} ${outOfSync.length} plan${outOfSync.length === 1 ? "" : "s"} out of sync: ${outOfSync.map((r) => r.id).join(", ")}. Run ${picocolors.bold("birrjs push")} to update.`,
        );
      }
    })(),
  ]);
}

export type BirrInstance<TOptions extends BirrJSOptions = BirrJSOptions> = BirrJSClientApiCarrier<
  BirrJSClientAPI<TOptions>
> & {
  options: TOptions;
  handler: (request: Request) => Promise<Response>;
  $context: Promise<BirrJSContext>;
  $infer: {
    planId: PlanIdFromOptions<TOptions>;
    featureId: FeatureIdFromOptions<TOptions>;
  };
  close: () => Promise<void>;
} & BirrJSAPI<TOptions>;

export function isBirrInstance<TOptions extends BirrJSOptions = BirrJSOptions>(
  value: unknown,
): value is BirrInstance<TOptions> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[birrInstanceSymbol] === true
  );
}

async function initContext(options: BirrJSOptions): Promise<BirrJSContext> {
  const pool =
    typeof options.database === "string"
      ? new Pool({ connectionString: options.database })
      : options.database;
  const ctx = await createContext({ ...options, database: pool });

  if (process.env.NODE_ENV !== "production" && !process.env.BIRRJS_CLI) {
    runDevChecks(ctx, pool).catch(() => {});
  }

  return ctx;
}

export function createBirr<TOptions extends BirrJSOptions>(
  options: TOptions,
): BirrInstance<TOptions> {
  let contextPromise: Promise<BirrJSContext> | undefined;
  const getContext = () => {
    contextPromise ??= initContext(options);
    return contextPromise;
  };

  const api = getApi(getContext);

  const birr: BirrInstance<TOptions> = {
    options,
    ...api,
    async handler(request: Request) {
      const ctx = await getContext();
      const router = createBirrJSRouter(ctx, options);
      return router.handler(request);
    },
    get $context() {
      return getContext();
    },
    $infer: undefined as never,
    close: async () => {
      const ctx = await getContext();
      await ctx.destroy();
    },
  };

  Object.defineProperty(birr, birrInstanceSymbol, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return birr as BirrInstance<TOptions>;
}

import { Pool } from "pg";

import { BirrJSError, BIRRJS_ERROR_CODES } from "../core/error-codes";
import { createBirrJSLogger, type BirrJSInternalLogger } from "../core/logger";
import { createDatabase, type BirrJSDatabase } from "../database";
import type { PaymentProvider, PaymentProviderConfig } from "../provider";
import { startScheduler, stopScheduler } from "../scheduler";
import type { BirrJSOptions } from "../types";

export interface BirrJSContext {
  options: BirrJSOptions;
  database: BirrJSDatabase;
  provider: PaymentProviderConfig;
  runtime: PaymentProvider;
  logger: BirrJSInternalLogger;
  destroy: () => Promise<void>;
}

export async function createContext(options: BirrJSOptions): Promise<BirrJSContext> {
  if (!options.provider) {
    throw BirrJSError.from("BAD_REQUEST", BIRRJS_ERROR_CODES.PROVIDER_REQUIRED);
  }

  const poolCreatedInternally = typeof options.database === "string";
  const pool: Pool = poolCreatedInternally
    ? new Pool({ connectionString: options.database as string })
    : (options.database as Pool);

  const database = await createDatabase(pool);
  const logger = createBirrJSLogger(options.logging);

  let destroyed = false;

  const runtime = options.provider.runtime;
  if (!runtime) {
    throw BirrJSError.from(
      "BAD_REQUEST",
      BIRRJS_ERROR_CODES.PROVIDER_REQUIRED,
      "Provider runtime is required. Please include it in the provider config.",
    );
  }

  const ctx = {
    options,
    database,
    provider: options.provider,
    runtime,
    logger,
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;

      // Stop scheduler if running
      if (options.scheduling?.mode === "auto") {
        stopScheduler();
        logger.info("Scheduler stopped");
      }

      if (poolCreatedInternally) {
        await pool.end();
      }
    },
  };

  // Start scheduler if mode is auto
  if (options.scheduling?.mode === "auto") {
    const pendingCron = options.scheduling.pendingSweepCron || "*/5 * * * *";
    const expiryCron = options.scheduling.expirySweepCron || "*/10 * * * *";
    try {
      startScheduler(ctx, pendingCron, expiryCron);
      logger.info("Scheduler started in auto mode");
    } catch (error) {
      await ctx.destroy();
      throw error;
    }
  }

  return ctx;
}

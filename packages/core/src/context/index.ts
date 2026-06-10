import { eq } from "drizzle-orm";
import { Pool } from "pg";

import { BirrJSError, BIRRJS_ERROR_CODES } from "../core/error-codes";
import { createBirrJSLogger, type BirrJSInternalLogger } from "../core/logger";
import { createDatabase, type BirrJSDatabase } from "../database";
import { customer, subscription } from "../database/schema";
import type { PaymentProvider, PaymentProviderConfig } from "../provider";
import { startScheduler, stopScheduler } from "../scheduler";
import type { BirrJSQueries, BirrJSOptions, SubscriptionStatus } from "../types";

export interface BirrJSContext {
  options: BirrJSOptions;
  queries: BirrJSQueries;
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

  const queries: BirrJSQueries = {
    getCustomer: async (id) => {
      const rows = await database
        .select({
          id: customer.id,
          email: customer.email,
          name: customer.name,
          phone: customer.phone,
        })
        .from(customer)
        .where(eq(customer.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, email: row.email, name: row.name, phone: row.phone };
    },
    getSubscription: async (id) => {
      const rows = await database
        .select({
          id: subscription.id,
          customerId: subscription.customerId,
          planId: subscription.planId,
          status: subscription.status,
          interval: subscription.interval,
          startedAt: subscription.startedAt,
          expiresAt: subscription.expiresAt,
          canceledAt: subscription.canceledAt,
          endedAt: subscription.endedAt,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        })
        .from(subscription)
        .where(eq(subscription.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        customerId: row.customerId,
        planId: row.planId,
        status: row.status as SubscriptionStatus,
        interval: row.interval,
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        canceledAt: row.canceledAt,
        endedAt: row.endedAt,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      };
    },
  };

  const ctx = {
    options,
    queries,
    database,
    provider: options.provider,
    runtime,
    logger,
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;

      // Stop scheduler if running
      if (options.scheduling?.mode === "auto" || options.scheduling?.mode === undefined) {
        stopScheduler();
        logger.info("Scheduler stopped");
      }

      if (poolCreatedInternally) {
        await pool.end();
      }
    },
  };

  // Start scheduler if mode is auto or unset
  const schedulerMode = options.scheduling?.mode;
  if (schedulerMode === "auto" || schedulerMode === undefined) {
    if (schedulerMode === undefined) {
      logger.warn(
        "birrjs: No scheduling mode configured. Defaulting to 'auto'. " +
          "Set scheduling.mode to 'manual' or 'external' to disable.",
      );
    }
    const pendingCron = options.scheduling?.pendingSweepCron || "*/5 * * * *";
    const expiryCron = options.scheduling?.expirySweepCron || "*/10 * * * *";
    const reminderCron = options.scheduling?.reminderSweepCron || "0 8 * * *";
    try {
      startScheduler(ctx, pendingCron, expiryCron, reminderCron);
      logger.info("Scheduler started");
    } catch (error) {
      await ctx.destroy();
      throw error;
    }
  }

  return ctx;
}

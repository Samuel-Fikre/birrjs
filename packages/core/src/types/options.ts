import type { Pool } from "pg";
import type { LevelWithSilent, Logger } from "pino";

import type { BirrJSPlan } from "../plans/index";
import type { PaymentProviderConfig } from "../provider";
import type { BirrJSEventHandlers } from "./events";
import type { BirrJSPlugin } from "./plugin";

export interface BirrJSLoggingOptions {
  level?: LevelWithSilent;
  logger?: Logger;
}

export type SchedulerMode = "auto" | "external" | "manual";

export interface BirrJSSchedulingOptions {
  mode?: SchedulerMode;
  cronSecret?: string;
  pendingTimeoutMinutes?: number;
  pendingSweepCron?: string;
  expirySweepCron?: string;
  reminderSweepCron?: string;
  reminderLeadDays?: number[];
  trialReminderLeadDays?: number[];
}

export interface BirrJSPlanChangeOptions {
  /**
   * Plan changes write through the activation path, so the first release ships
   * dark: callers must opt in per deployment.
   */
  enabled?: boolean;
  /**
   * Differences below this amount (minor units) are not pushed to the provider;
   * they are recorded as deferred and recovered at the next renewal.
   */
  minimumChargeAmount?: number;
}

export interface BirrJSOptions {
  provider: PaymentProviderConfig;
  database: string | Pool;
  basePath?: string;
  logging?: BirrJSLoggingOptions;
  scheduling?: BirrJSSchedulingOptions;
  planChanges?: BirrJSPlanChangeOptions;
  adminSecret?: string;
  identify?: (
    request: Request,
  ) => Promise<{ customerId?: string; email?: string; name?: string; phone?: string } | null>;
  plans?: readonly BirrJSPlan[];
  plugins?: BirrJSPlugin[];
  on?: BirrJSEventHandlers;
  hookTimeout?: number;
}

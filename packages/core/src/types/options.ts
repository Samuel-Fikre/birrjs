import type { Pool } from "pg";
import type { LevelWithSilent, Logger } from "pino";

import type { BirrJSPlan } from "../plans/index";
import type { PaymentProviderConfig } from "../provider";

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
}

export interface BirrJSOptions {
  provider: PaymentProviderConfig;
  database: string | Pool;
  callbackUrl: string;
  basePath?: string;
  logging?: BirrJSLoggingOptions;
  scheduling?: BirrJSSchedulingOptions;
  identify?: (
    request: Request,
  ) => Promise<{ customerId?: string; email?: string; name?: string } | null>;
  plans?: readonly BirrJSPlan[];
}

import type { PaymentProviderConfig } from "../provider";
import type { Pool } from "pg";
import type { LevelWithSilent, Logger } from "pino";

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
  logging?: BirrJSLoggingOptions;
  scheduling?: BirrJSSchedulingOptions;
}

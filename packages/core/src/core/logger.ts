import pino from "pino";
import pretty from "pino-pretty";

import type { BirrJSLoggingOptions } from "../types/options";

const DEFAULT_LOG_LEVEL = "info";

export interface BirrJSInternalLogger extends pino.Logger {}

export interface LoggerEnvironment {
  nodeEnv?: string;
}

export function shouldUsePrettyLogs(environment: LoggerEnvironment = {}): boolean {
  const { nodeEnv = process.env.NODE_ENV } = environment;
  return nodeEnv !== "production";
}

export function getDefaultLoggerOptions(
  logging: Pick<BirrJSLoggingOptions, "level"> | undefined,
): pino.LoggerOptions {
  return {
    level: logging?.level ?? DEFAULT_LOG_LEVEL,
    name: "birrjs",
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function getPrettyLoggerOptions(): pretty.PrettyOptions {
  return {
    colorize: true,
    ignore: "pid,hostname",
    levelFirst: true,
    translateTime: "SYS:HH:MM:ss.l",
  };
}

export function createBirrJSLogger(
  logging?: BirrJSLoggingOptions,
  environment: LoggerEnvironment = {},
): BirrJSInternalLogger {
  const base =
    logging?.logger ??
    (shouldUsePrettyLogs(environment)
      ? pino(getDefaultLoggerOptions(logging), pretty(getPrettyLoggerOptions()))
      : pino(getDefaultLoggerOptions(logging)));

  return base;
}

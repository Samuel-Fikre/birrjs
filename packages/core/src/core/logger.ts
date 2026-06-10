import { createRequire } from "node:module";

import pino from "pino";

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

export function getPrettyLoggerOptions() {
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
  let transport: { target: string; options?: Record<string, any> } | undefined;

  if (shouldUsePrettyLogs(environment)) {
    try {
      createRequire(import.meta.url).resolve("pino-pretty");
      transport = { target: "pino-pretty", options: getPrettyLoggerOptions() };
    } catch {
      // pino-pretty not installed — fall back to JSON logs
    }
  }

  const base = logging?.logger ?? pino({ ...getDefaultLoggerOptions(logging), transport });

  return base;
}

import { Pool } from "pg";
import type { PaymentProvider } from "../provider";
import type { BirrJSOptions } from "../types";
import { createDatabase, type BirrJSDatabase } from "../database";
import { createBirrJSLogger, type BirrJSInternalLogger } from "../core/logger";
import { BirrJSError, BIRRJS_ERROR_CODES } from "../core/error-codes";

export interface BirrJSContext {
  options: BirrJSOptions;
  database: BirrJSDatabase;
  provider: PaymentProvider;
  logger: BirrJSInternalLogger;
}

export async function createContext(options: BirrJSOptions): Promise<BirrJSContext> {
  if (!options.provider) {
    throw BirrJSError.from("BAD_REQUEST", BIRRJS_ERROR_CODES.PROVIDER_REQUIRED);
  }

  const pool =
    typeof options.database === "string"
      ? new Pool({ connectionString: options.database })
      : options.database;

  const database = await createDatabase(pool);
  const logger = createBirrJSLogger(options.logging);

  return {
    options,
    database,
    provider: options.provider,
    logger,
  };
}

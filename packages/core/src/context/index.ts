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

  return {
    options,
    database,
    provider: options.provider,
    logger,
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;

      if (poolCreatedInternally) {
        await pool.end();
      }
    },
  };
}

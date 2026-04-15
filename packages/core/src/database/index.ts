import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema";

export * from "./schema";

export type BirrJSDatabase = ReturnType<typeof drizzle<typeof schema>>;

export async function createDatabase(pool: Pool): Promise<BirrJSDatabase> {
  return drizzle(pool, { schema });
}

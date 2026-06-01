import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

import type { BirrInstance, PaymentProviderConfig } from "@birrjs/core";
import type { Pool } from "pg";

function loadDotEnv(): void {
  const envPath = resolve(import.meta.dirname ?? __dirname, "../../.env");
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found use defaults
  }
}
loadDotEnv();

export interface CreateTestBirrJSOptions {
  provider?: PaymentProviderConfig;
}

export interface TestBirrJS {
  birr: BirrInstance;
  pool: Pool;
  dbName: string;
  cleanup: () => Promise<void>;
}

async function detectProvider(callbackUrl: string): Promise<PaymentProviderConfig> {
  if (process.env.CHAPA_SECRET_KEY) {
    const { chapa } = await import("@birrjs/chapa");
    return chapa({
      id: "chapa",
      kind: "chapa",
      secretKey: process.env.CHAPA_SECRET_KEY,
      callbackUrl,
      testMode: true,
    });
  }
  const { mockChapaProvider } = await import("./mock-providers");
  return mockChapaProvider(callbackUrl);
}

export async function createTestBirrJS(options?: CreateTestBirrJSOptions): Promise<TestBirrJS> {
  const { Pool } = await import("pg");
  const { createBirr } = await import("@birrjs/core");
  const { migrateDatabase } = await import("../../packages/core/src/database/migrate");

  const rawUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
  const callbackUrl = process.env.CALLBACK_URL ?? "http://localhost:3000/api/birrjs/callback";

  const dbName = `birrjs_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const adminPool = new Pool({ connectionString: rawUrl });
  await adminPool.query(`CREATE DATABASE "${dbName}"`);
  await adminPool.end();

  const dbUrl = rawUrl.replace(/\/[^/]+$/, `/${dbName}`);
  const pool = new Pool({ connectionString: dbUrl });

  await migrateDatabase(pool);

  const providerConfig = options?.provider ?? (await detectProvider(callbackUrl));

  const birr: BirrInstance = createBirr({
    database: pool,
    provider: providerConfig,
    callbackUrl,
    logging: { level: "silent" },
  });

  return {
    birr,
    pool,
    dbName,
    cleanup: async () => {
      await birr.close();
      await pool.end();

      const cleanupPool = new Pool({ connectionString: rawUrl });
      await cleanupPool.query(
        `SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      if (!process.env.SKIP_CLEANUP) {
        await cleanupPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      } else {
        console.log(`SKIP_CLEANUP set — database preserved: ${dbName}`);
      }
      await cleanupPool.end();
    },
  };
}

export interface WebhookTestServer {
  port: number;
  close: () => void;
}

export function startWebhookServer(
  birr: Pick<BirrInstance, "handler">,
): Promise<WebhookTestServer> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString();
      const url = new URL(req.url ?? "/", "http://localhost");
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });
      try {
        const response = await birr.handler(request);
        res.writeHead(response.status);
        res.end(await response.text());
      } catch (error) {
        res.writeHead(500);
        res.end(error instanceof Error ? error.message : "Internal error");
      }
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}

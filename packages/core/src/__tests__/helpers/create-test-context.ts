import { vi } from "vitest";

import type { BirrJSContext } from "../../context";
import type { BirrJSInternalLogger } from "../../core/logger";
import type { BirrJSDatabase } from "../../database";
import type { PaymentProvider, PaymentProviderConfig } from "../../provider";
import type { BirrJSQueries, BirrJSOptions } from "../../types";

export function createTestContext(overrides: Partial<BirrJSContext> = {}): BirrJSContext {
  return {
    options: {} as BirrJSOptions,
    queries: {} as BirrJSQueries,
    database: {} as BirrJSDatabase,
    provider: {} as PaymentProviderConfig,
    runtime: {} as PaymentProvider,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({}),
    } as unknown as BirrJSInternalLogger,
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

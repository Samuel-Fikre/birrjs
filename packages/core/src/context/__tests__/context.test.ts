import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BirrJSInternalLogger } from "../../core/logger";
import type { BirrJSDatabase } from "../../database";
import type { PaymentProvider, PaymentProviderConfig } from "../../provider";
import type { BirrJSOptions } from "../../types";

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  createBirrJSLogger: vi.fn(),
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  MockPool: vi.fn().mockImplementation(function () {
    return { end: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock("pg", () => ({ Pool: mocks.MockPool }));
vi.mock("../../database", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("../../core/logger", () => ({ createBirrJSLogger: mocks.createBirrJSLogger }));
vi.mock("../../scheduler", () => ({
  startScheduler: mocks.startScheduler,
  stopScheduler: mocks.stopScheduler,
}));

import { BirrJSError } from "../../core/error-codes";
import { createContext } from "../index";

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

describe("createContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDatabase.mockResolvedValue({} as unknown as BirrJSDatabase);
    mocks.createBirrJSLogger.mockReturnValue(makeMockLogger() as unknown as BirrJSInternalLogger);
  });

  const baseOptions = {
    provider: {
      id: "chapa",
      kind: "chapa",
      secretKey: "sk_test_123",
      callbackUrl: "",
      runtime: {} as unknown as PaymentProvider,
    } satisfies Partial<PaymentProviderConfig>,
    database: {} as Pool,
    callbackUrl: "",
  };

  it("throws when provider is missing", async () => {
    await expect(createContext({} as unknown as BirrJSOptions)).rejects.toThrow(BirrJSError);
  });

  it("throws when provider has no runtime", async () => {
    await expect(
      createContext({
        ...baseOptions,
        provider: {
          id: "chapa",
          kind: "chapa",
          secretKey: "sk_test_123",
          callbackUrl: "",
        } as unknown as PaymentProviderConfig,
      } as unknown as BirrJSOptions),
    ).rejects.toThrow("Provider runtime is required");
  });

  it("calls createDatabase with the provided Pool", async () => {
    const pool = {} as Pool;

    await createContext({
      ...baseOptions,
      database: pool,
    } as unknown as BirrJSOptions);

    expect(mocks.createDatabase).toHaveBeenCalledWith(pool);
  });

  it("creates Pool from connection string when database is a string", async () => {
    const fakePool = { end: vi.fn() };
    mocks.MockPool.mockImplementation(function () {
      return fakePool;
    });

    await createContext({
      ...baseOptions,
      database: "postgres://localhost/mydb",
    } as unknown as BirrJSOptions);

    expect(mocks.MockPool).toHaveBeenCalledWith({ connectionString: "postgres://localhost/mydb" });
    expect(mocks.createDatabase).toHaveBeenCalledWith(fakePool);
  });

  it("calls createBirrJSLogger with logging options", async () => {
    const logging = { level: "debug" } as const;

    await createContext({
      ...baseOptions,
      logging,
    } as unknown as BirrJSOptions);

    expect(mocks.createBirrJSLogger).toHaveBeenCalledWith(logging);
  });

  it("starts scheduler when scheduling.mode is auto", async () => {
    await createContext({
      ...baseOptions,
      scheduling: { mode: "auto" },
    } as unknown as BirrJSOptions);

    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
  });

  it("passes cron defaults to startScheduler", async () => {
    await createContext({
      ...baseOptions,
      scheduling: { mode: "auto" },
    } as unknown as BirrJSOptions);

    expect(mocks.startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.any(Object) }),
      "*/5 * * * *",
      "*/10 * * * *",
    );
  });

  it("passes custom cron values when provided", async () => {
    await createContext({
      ...baseOptions,
      scheduling: { mode: "auto", pendingSweepCron: "*/2 * * * *", expirySweepCron: "*/3 * * * *" },
    } as unknown as BirrJSOptions);

    expect(mocks.startScheduler).toHaveBeenCalledWith(
      expect.any(Object),
      "*/2 * * * *",
      "*/3 * * * *",
    );
  });

  it("does not start scheduler when scheduling.mode is manual", async () => {
    await createContext({
      ...baseOptions,
      scheduling: { mode: "manual" },
    } as unknown as BirrJSOptions);

    expect(mocks.startScheduler).not.toHaveBeenCalled();
  });

  it("does not start scheduler when scheduling.mode is external", async () => {
    await createContext({
      ...baseOptions,
      scheduling: { mode: "external" },
    } as unknown as BirrJSOptions);

    expect(mocks.startScheduler).not.toHaveBeenCalled();
  });

  it("defaults to auto when scheduling is undefined", async () => {
    await createContext({
      ...baseOptions,
    } as unknown as BirrJSOptions);

    expect(mocks.startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.any(Object) }),
      "*/5 * * * *",
      "*/10 * * * *",
    );
  });

  it("calls stopScheduler and pool.end on destroy when pool was created internally", async () => {
    const fakePool = { end: vi.fn().mockResolvedValue(undefined) };
    mocks.MockPool.mockImplementation(function () {
      return fakePool;
    });

    const ctx = await createContext({
      ...baseOptions,
      database: "postgres://localhost/mydb",
      scheduling: { mode: "auto" },
    } as unknown as BirrJSOptions);

    await ctx.destroy();

    expect(mocks.stopScheduler).toHaveBeenCalled();
    expect(fakePool.end).toHaveBeenCalledTimes(1);
  });

  it("closes pool but does not stop scheduler on destroy when scheduling is manual", async () => {
    const fakePool = { end: vi.fn().mockResolvedValue(undefined) };
    mocks.MockPool.mockImplementation(function () {
      return fakePool;
    });

    const ctx = await createContext({
      ...baseOptions,
      database: "postgres://localhost/mydb",
      scheduling: { mode: "manual" },
    } as unknown as BirrJSOptions);

    await ctx.destroy();

    expect(mocks.stopScheduler).not.toHaveBeenCalled();
    expect(fakePool.end).toHaveBeenCalledTimes(1);
  });

  it("does not call pool.end on destroy when pool was externally provided", async () => {
    const pool = { end: vi.fn().mockResolvedValue(undefined) } as unknown as Pool;

    const ctx = await createContext({
      ...baseOptions,
      database: pool,
    } as unknown as BirrJSOptions);

    await ctx.destroy();

    expect(pool.end).not.toHaveBeenCalled();
  });

  it("destroy is idempotent", async () => {
    const fakePool = { end: vi.fn().mockResolvedValue(undefined) };
    mocks.MockPool.mockImplementation(function () {
      return fakePool;
    });

    const ctx = await createContext({
      ...baseOptions,
      database: "postgres://localhost/mydb",
    } as unknown as BirrJSOptions);

    await ctx.destroy();
    await ctx.destroy();

    expect(fakePool.end).toHaveBeenCalledTimes(1);
  });

  it("calls destroy and re-throws when scheduler start fails", async () => {
    const schedulerError = new Error("Invalid cron expression");
    mocks.startScheduler.mockImplementationOnce(function () {
      throw schedulerError;
    });
    const fakePool = { end: vi.fn().mockResolvedValue(undefined) };
    mocks.MockPool.mockImplementation(function () {
      return fakePool;
    });

    await expect(
      createContext({
        ...baseOptions,
        database: "postgres://localhost/mydb",
        scheduling: { mode: "auto" },
      } as unknown as BirrJSOptions),
    ).rejects.toThrow(schedulerError);

    expect(fakePool.end).toHaveBeenCalledTimes(1);
    expect(mocks.stopScheduler).toHaveBeenCalled();
  });
});

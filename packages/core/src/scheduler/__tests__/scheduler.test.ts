import type * as nodeCronModule from "node-cron";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BirrJSContext } from "../../context";

vi.mock("node-cron", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeCronModule>();
  const callbacks: Array<() => Promise<void>> = [];
  return {
    default: {
      validate: actual.default.validate,
      schedule: vi.fn((_expression: string, cb: () => Promise<void>) => {
        callbacks.push(cb);
        return { stop: vi.fn() };
      }),
    },
  };
});

vi.mock("../../server/cron/cron.api", () => ({
  checkPendingSubscriptions: vi.fn(),
  checkExpiredSubscriptions: vi.fn(),
  sendReminders: vi.fn(),
}));

import cron from "node-cron";

import {
  checkPendingSubscriptions,
  checkExpiredSubscriptions,
  sendReminders,
} from "../../server/cron/cron.api";
import { startScheduler, stopScheduler, isSchedulerRunning } from "../index";

const cronScheduleMock = cron.schedule as unknown as ReturnType<typeof vi.fn>;

function getCallbacks(): {
  pendingCb: () => Promise<void>;
  expiryCb: () => Promise<void>;
  remindersCb: () => Promise<void>;
} {
  const pendingCb = cronScheduleMock.mock.calls[0]?.[1] as () => Promise<void>;
  const expiryCb = cronScheduleMock.mock.calls[1]?.[1] as () => Promise<void>;
  const remindersCb = cronScheduleMock.mock.calls[2]?.[1] as () => Promise<void>;
  return { pendingCb, expiryCb, remindersCb };
}

function mockContext(): BirrJSContext {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({}),
    },
  } as unknown as BirrJSContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  stopScheduler();
});

describe("startScheduler", () => {
  it("rejects invalid cron expressions using real node-cron validation", () => {
    expect(() => startScheduler(mockContext(), "not-a-cron", "*/10 * * * *", "0 8 * * *")).toThrow(
      "Invalid cron expression for pending check: not-a-cron",
    );

    expect(() => startScheduler(mockContext(), "*/5 * * * *", "bad", "0 8 * * *")).toThrow(
      "Invalid cron expression for expiry check: bad",
    );

    expect(() =>
      startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *"),
    ).not.toThrow();
  });

  it("invokes pending check via scheduled callback", async () => {
    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { pendingCb } = getCallbacks();
    await pendingCb();
    expect(checkPendingSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("invokes expiry check via scheduled callback", async () => {
    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { expiryCb } = getCallbacks();
    await expiryCb();
    expect(checkExpiredSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("invokes reminders check via scheduled callback", async () => {
    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { remindersCb } = getCallbacks();
    await remindersCb();
    expect(sendReminders).toHaveBeenCalledTimes(1);
  });
});

describe("scheduler run-locking", () => {
  it("skips pending check when previous run is still in progress", async () => {
    let resolvePending: () => void;
    (checkPendingSubscriptions as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePending = resolve;
      }),
    );

    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { pendingCb } = getCallbacks();

    const firstRun = pendingCb();
    const secondRun = pendingCb();

    resolvePending!();
    await firstRun;
    await secondRun;

    expect(checkPendingSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("skips expiry check when previous run is still in progress", async () => {
    let resolveExpiry: () => void;
    (checkExpiredSubscriptions as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveExpiry = resolve;
      }),
    );

    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { expiryCb } = getCallbacks();

    const firstRun = expiryCb();
    const secondRun = expiryCb();

    resolveExpiry!();
    await firstRun;
    await secondRun;

    expect(checkExpiredSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("logs error instead of crashing when pending check throws", async () => {
    const ctx = mockContext();
    (checkPendingSubscriptions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB connection lost"),
    );

    startScheduler(ctx, "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { pendingCb } = getCallbacks();

    await expect(pendingCb()).resolves.toBeUndefined();
    expect(ctx.logger.error).toHaveBeenCalledWith({
      msg: "Scheduler error in pending check",
      err: expect.any(Error),
    });
  });

  it("logs error instead of crashing when expiry check throws", async () => {
    const ctx = mockContext();
    (checkExpiredSubscriptions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB timeout"),
    );

    startScheduler(ctx, "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { expiryCb } = getCallbacks();

    await expect(expiryCb()).resolves.toBeUndefined();
    expect(ctx.logger.error).toHaveBeenCalledWith({
      msg: "Scheduler error in expiry check",
      err: expect.any(Error),
    });
  });

  it("resumes normal scheduling after a failed run", async () => {
    (checkPendingSubscriptions as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Fail once"))
      .mockResolvedValueOnce(undefined);

    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    const { pendingCb } = getCallbacks();

    await pendingCb();
    await pendingCb();

    expect(checkPendingSubscriptions).toHaveBeenCalledTimes(2);
  });
});

describe("stopScheduler", () => {
  it("clears all scheduled tasks", () => {
    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");

    expect(isSchedulerRunning()).toBe(true);

    stopScheduler();

    expect(isSchedulerRunning()).toBe(false);
  });

  it("is idempotent when no scheduler is running", () => {
    expect(isSchedulerRunning()).toBe(false);

    expect(() => stopScheduler()).not.toThrow();
    expect(isSchedulerRunning()).toBe(false);
  });
});

describe("isSchedulerRunning", () => {
  it("returns false before startScheduler is called", () => {
    expect(isSchedulerRunning()).toBe(false);
  });

  it("returns true after startScheduler", () => {
    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");

    expect(isSchedulerRunning()).toBe(true);
  });

  it("returns false after stopScheduler", () => {
    startScheduler(mockContext(), "*/5 * * * *", "*/10 * * * *", "0 8 * * *");
    stopScheduler();

    expect(isSchedulerRunning()).toBe(false);
  });
});

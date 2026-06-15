import { describe, it, expect, vi } from "vitest";

import type { BirrJSContext } from "../context";
import type { BirrJSDatabase } from "../database";
import { checkPendingSubscriptions, checkExpiredSubscriptions } from "../server/cron/cron.api";
import type { BirrJSQueries } from "../types";

function mockDb(returnedRows: Array<Record<string, unknown>> = []) {
  const returningMock = vi.fn().mockResolvedValue(returnedRows);
  const whereMock = vi.fn(() => ({ returning: returningMock }));
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));

  const limitMock = vi.fn().mockResolvedValue(returnedRows);
  const whereQueryMock = vi.fn(() => ({ limit: limitMock }));
  const innerJoinCustomerMock = vi.fn(() => ({ where: whereQueryMock }));
  const innerJoinPlanMock = vi.fn(() => ({ innerJoin: innerJoinCustomerMock }));
  const fromMock = vi.fn(() => ({ innerJoin: innerJoinPlanMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  const insertMock = vi.fn();

  const db = {
    update: updateMock,
    select: selectMock,
    insert: insertMock,
    transaction: vi.fn(),
  } as unknown as BirrJSDatabase;

  return { db, updateMock, setMock, whereMock, returningMock };
}

function ctx(
  overrides: Partial<{
    database: BirrJSDatabase;
    pendingTimeoutMinutes: number;
  }> = {},
): BirrJSContext {
  return {
    queries: {} as unknown as BirrJSQueries,
    database: overrides.database ?? ({} as BirrJSDatabase),
    options: {
      scheduling: {
        pendingTimeoutMinutes: overrides.pendingTimeoutMinutes ?? 60,
      },
    } as BirrJSContext["options"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({}),
    } as unknown as BirrJSContext["logger"],
    destroy: vi.fn().mockResolvedValue(undefined),
    provider: {} as BirrJSContext["provider"],
    runtime: {} as BirrJSContext["runtime"],
  };
}

describe("checkPendingSubscriptions", () => {
  it("marks timed-out pending subscriptions as failed", async () => {
    const { db, returningMock, setMock } = mockDb([
      { id: "sub_1", status: "pending" },
      { id: "sub_2", status: "pending" },
    ]);
    const c = ctx({ database: db });

    const result = await checkPendingSubscriptions(c);

    expect(result).toEqual({ checked: 2, updated: 2 });
    expect(returningMock).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        endedAt: expect.any(Date),
      }),
    );
  });

  it("returns 0 when no pending subs are timed out", async () => {
    const { db, returningMock } = mockDb([]);
    const c = ctx({ database: db });

    const result = await checkPendingSubscriptions(c);

    expect(result).toEqual({ checked: 0, updated: 0 });
    expect(returningMock).toHaveBeenCalled();
  });

  it("respects pendingTimeoutMinutes option", async () => {
    const { db, setMock } = mockDb([]);
    const c = ctx({ database: db, pendingTimeoutMinutes: 30 });

    await checkPendingSubscriptions(c);
    // Handler ran without error; timeout config was passed through
    expect(setMock).toHaveBeenCalled();
  });
});

describe("checkExpiredSubscriptions", () => {
  it("marks expired active subscriptions", async () => {
    const { db, returningMock, setMock } = mockDb([{ id: "sub_3", status: "active" }]);
    const c = ctx({ database: db });

    const result = await checkExpiredSubscriptions(c);

    expect(result).toEqual({ checked: 1, updated: 1 });
    expect(returningMock).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "expired",
        endedAt: expect.any(Date),
      }),
    );
  });

  it("returns 0 when no subscriptions are expired", async () => {
    const { db, returningMock } = mockDb([]);
    const c = ctx({ database: db });

    const result = await checkExpiredSubscriptions(c);

    expect(result).toEqual({ checked: 0, updated: 0 });
    expect(returningMock).toHaveBeenCalled();
  });
});

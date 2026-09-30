import { vi } from "vitest";

import type { BirrJSDatabase } from "../../database";

export type QueryResult = Array<Record<string, unknown>>;

export interface MockDb {
  db: BirrJSDatabase;
  selectMock: ReturnType<typeof vi.fn>;
  updateMock: ReturnType<typeof vi.fn>;
  setMock: ReturnType<typeof vi.fn>;
  deleteMock: ReturnType<typeof vi.fn>;
}

export function createMockDb(results: QueryResult[] = []): MockDb {
  const queue: QueryResult[] = [...results];

  function consume(): QueryResult {
    const item = queue.shift();
    return item !== undefined ? item : [];
  }

  function query() {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(consume()),
      then: (f?: (v: QueryResult) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(consume()).then(f, r),
    };
    return chain;
  }

  const selectMock = vi.fn(() => query());
  const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  const deleteMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));

  const db = {
    select: selectMock,
    update: updateMock,
    delete: deleteMock,
  } as unknown as BirrJSDatabase;

  return { db, selectMock, updateMock, setMock, deleteMock };
}

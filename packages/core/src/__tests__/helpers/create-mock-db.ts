import { vi } from "vitest";

import type { BirrJSDatabase } from "../../database";

export type QueryResult = Array<Record<string, unknown>>;

export interface MockDb {
  db: BirrJSDatabase;
  selectMock: ReturnType<typeof vi.fn>;
  insertMock: ReturnType<typeof vi.fn>;
  updateMock: ReturnType<typeof vi.fn>;
  setMock: ReturnType<typeof vi.fn>;
  deleteMock: ReturnType<typeof vi.fn>;
  findFirstMock: ReturnType<typeof vi.fn>;
  /** Tables a `.for("update")` row lock was taken on, in call order. */
  locksFor: (table: unknown) => number;
  /** `set` payloads recorded against a table, in call order. */
  updatesFor: (table: unknown) => Array<Record<string, unknown>>;
  /** `values` payloads recorded against a table, in call order. */
  insertsFor: (table: unknown) => Array<Record<string, unknown>>;
  deletesFor: (table: unknown) => number;
}

/**
 * Positional drizzle double: `select` pages are served from a queue in call
 * order, so a query added to a code path shifts every entry after it. Inserts
 * and relational `findFirst` reads get their own queues because they resolve
 * differently — a rejected insert is an empty `returning()` set, not an empty page.
 */
export function createMockDb(
  results: QueryResult[] = [],
  options: { insert?: QueryResult[]; findFirst?: QueryResult[] } = {},
): MockDb {
  const queue: QueryResult[] = [...results];
  const insertQueue: QueryResult[] = [...(options.insert ?? [])];
  const findFirstQueue: QueryResult[] = [...(options.findFirst ?? [])];

  const writes: Record<
    "insert" | "update" | "delete",
    Array<[unknown, Record<string, unknown>?]>
  > = { insert: [], update: [], delete: [] };
  const locks: unknown[] = [];

  function consume(): QueryResult {
    const item = queue.shift();
    return item !== undefined ? item : [];
  }

  function query() {
    let selectedTable: unknown;
    const chain: Record<string, unknown> = {
      from: (table: unknown) => {
        selectedTable = table;
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      for: () => {
        locks.push(selectedTable);
        return chain;
      },
      limit: () => Promise.resolve(consume()),
      then: (f?: (v: QueryResult) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(consume()).then(f, r),
    };
    return chain;
  }

  function nextReturning(): Promise<QueryResult> {
    const item = insertQueue.shift();
    return Promise.resolve(item ?? []);
  }

  const selectMock = vi.fn(() => query());
  const insertMock = vi.fn((table: unknown) => ({
    values: (payload: Record<string, unknown>) => {
      writes.insert.push([table, payload]);
      return {
        onConflictDoNothing: () => ({ returning: nextReturning }),
        returning: nextReturning,
      };
    },
  }));

  const whereMock = vi.fn().mockResolvedValue(undefined);
  // `update(table)` and `set(payload)` are separate builder links, and drizzle
  // always calls them in the same synchronous chain, so the table in flight is
  // enough to attribute a payload to the table it was written against.
  let updateTarget: unknown;
  const setMock = vi.fn((payload: Record<string, unknown>) => {
    writes.update.push([updateTarget, payload]);
    return { where: whereMock };
  });
  const updateMock = vi.fn((table: unknown) => {
    updateTarget = table;
    return { set: setMock };
  });
  const deleteMock = vi.fn((table: unknown) => {
    writes.delete.push([table]);
    return { where: whereMock };
  });

  const findFirstMock = vi.fn(() => {
    const item = findFirstQueue.shift();
    return Promise.resolve(item?.[0]);
  });
  // Relational reads are keyed by table name; a proxy keeps the double from
  // having to list the tables a test happens to touch.
  const relational = new Proxy({} as Record<string, { findFirst: typeof findFirstMock }>, {
    get: () => ({ findFirst: findFirstMock }),
  });

  const db = {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    query: relational,
    transaction: vi.fn(async (cb: (tx: BirrJSDatabase) => Promise<unknown>) => cb(db)),
  } as unknown as BirrJSDatabase;

  function payloadsOf(kind: "insert" | "update" | "delete", table: unknown) {
    return writes[kind].filter((entry) => entry[0] === table);
  }

  return {
    db,
    selectMock,
    insertMock,
    updateMock,
    setMock,
    deleteMock,
    findFirstMock,
    locksFor: (table) => locks.filter((locked) => locked === table).length,
    updatesFor: (table) =>
      payloadsOf("update", table).map((entry) => entry[1] as Record<string, unknown>),
    insertsFor: (table) =>
      payloadsOf("insert", table).map((entry) => entry[1] as Record<string, unknown>),
    deletesFor: (table) => payloadsOf("delete", table).length,
  };
}

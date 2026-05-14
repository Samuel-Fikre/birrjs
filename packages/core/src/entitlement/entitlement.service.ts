import { type SQL, and, eq, inArray, sql, lte } from "drizzle-orm";

import type { BirrJSDatabase, BirrJSTransaction } from "../database";
import { entitlement, planFeature, subscription } from "../database/schema";
import type { ResetInterval } from "../plans/schema";
import { activeSubscriptionCondition } from "./entitlement.conditions";
import type {
  ActiveEntitlementRow,
  StaleEntitlementRow,
  CheckEntitlementInput,
  CheckResult,
  EntitlementBalance,
  ReportEntitlementInput,
  ReportResult,
} from "./entitlement.types";

export function addResetInterval(date: Date, resetInterval: ResetInterval): Date {
  const next = new Date(date);

  switch (resetInterval) {
    case "day":
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case "week":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "month": {
      const day = next.getUTCDate();
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (next.getUTCDate() !== day) next.setUTCDate(0);
      return next;
    }
    case "year": {
      const day = next.getUTCDate();
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      if (next.getUTCDate() !== day) next.setUTCDate(0);
      return next;
    }
    default: {
      const _exhaustiveCheck: never = resetInterval;
      return next;
    }
  }
}

function getNextResetAt(currentResetAt: Date, now: Date, resetInterval: ResetInterval): Date {
  let nextResetAt = new Date(currentResetAt);

  while (nextResetAt <= now) {
    nextResetAt = addResetInterval(nextResetAt, resetInterval);
  }

  return nextResetAt;
}

function aggregateBalance(rows: ActiveEntitlementRow[]): EntitlementBalance | null {
  if (rows.length === 0) return null;

  const hasUnlimited = rows.some((row) => row.originalLimit === null);
  if (hasUnlimited) {
    return { limit: 0, remaining: 0, resetAt: null, unlimited: true };
  }

  let remaining = 0;
  let limit = 0;
  let resetAt: Date | null = null;

  for (const row of rows) {
    remaining += row.balance;
    limit += row.originalLimit!;
    if (row.nextResetAt) {
      if (!resetAt || row.nextResetAt < resetAt) {
        resetAt = row.nextResetAt;
      }
    }
  }

  return { limit, remaining, resetAt, unlimited: false };
}

async function getActiveEntitlements(
  db: BirrJSDatabase | BirrJSTransaction,
  customerId: string,
  featureId: string,
): Promise<ActiveEntitlementRow[]> {
  const rows = await db
    .select({
      id: entitlement.id,
      balance: entitlement.balance,
      nextResetAt: entitlement.nextResetAt,
      originalLimit: planFeature.limit,
      resetInterval: planFeature.resetInterval,
    })
    .from(entitlement)
    .innerJoin(subscription, eq(entitlement.subscriptionId, subscription.id))
    .innerJoin(
      planFeature,
      and(
        eq(planFeature.planId, subscription.planId),
        eq(planFeature.featureId, entitlement.featureId),
      ),
    )
    .where(
      and(
        eq(entitlement.customerId, customerId),
        eq(entitlement.featureId, featureId),
        activeSubscriptionCondition,
      ),
    );
  return rows as ActiveEntitlementRow[];
}

async function resetStaleEntitlements(
  db: BirrJSDatabase | BirrJSTransaction,
  rows: ActiveEntitlementRow[],
  now: Date,
): Promise<void> {
  // Type guard function to filter stale rows with proper typing
  const isStaleRow = (row: ActiveEntitlementRow): row is StaleEntitlementRow =>
    row.nextResetAt != null &&
    row.nextResetAt <= now &&
    row.resetInterval != null &&
    row.originalLimit != null;

  const staleRows = rows.filter(isStaleRow);
  if (staleRows.length === 0) return;

  // Process in chunks to handle large batches efficiently
  const batchSize = 500;
  for (let i = 0; i < staleRows.length; i += batchSize) {
    const batch = staleRows.slice(i, i + batchSize);
    await resetStaleEntitlementsBatch(db, batch, now);
  }
}

async function resetStaleEntitlementsBatch(
  db: BirrJSDatabase | BirrJSTransaction,
  staleRows: StaleEntitlementRow[],
  now: Date,
): Promise<void> {
  const ids: string[] = [];
  const balanceChunks: SQL[] = [sql`(case`];
  const resetAtChunks: SQL[] = [sql`(case`];

  for (const row of staleRows) {
    const nextReset = getNextResetAt(row.nextResetAt, now, row.resetInterval as ResetInterval);
    balanceChunks.push(sql`when ${entitlement.id} = ${row.id} then ${row.originalLimit}`);
    resetAtChunks.push(sql`when ${entitlement.id} = ${row.id} then ${nextReset}`);
    ids.push(row.id);
    row.balance = row.originalLimit;
    row.nextResetAt = nextReset;
  }

  balanceChunks.push(sql`end)::integer`);
  resetAtChunks.push(sql`end)::timestamp`);

  const finalBalanceSql: SQL = sql.join(balanceChunks, sql.raw(" "));
  const finalResetAtSql: SQL = sql.join(resetAtChunks, sql.raw(" "));

  await db
    .update(entitlement)
    .set({
      balance: finalBalanceSql,
      nextResetAt: finalResetAtSql,
    })
    .where(and(inArray(entitlement.id, ids), lte(entitlement.nextResetAt, now)));
}

// check — read entitlements with lazy reset

export async function checkEntitlement(
  database: BirrJSDatabase,
  input: CheckEntitlementInput,
): Promise<CheckResult> {
  const required = input.required ?? 1;

  const rows = await getActiveEntitlements(database, input.customerId, input.featureId);
  await resetStaleEntitlements(database, rows, input.now ?? new Date());

  const balance = aggregateBalance(rows);

  if (!balance) {
    return { allowed: false, balance: null };
  }

  if (balance.unlimited) {
    return { allowed: true, balance };
  }

  return { allowed: balance.remaining >= required, balance };
}

// single CTE query

type ReportQueryRow = Record<string, unknown> & {
  hasUnlimited: boolean;
  totalBalance: number;
  totalLimit: number;
  rowCount: number;
  earliestResetAt: Date | null;
  deductedId: string | null;
  newBalance: number | null;
};

export async function reportEntitlement(
  database: BirrJSDatabase,
  input: ReportEntitlementInput,
): Promise<ReportResult> {
  const amount = input.amount ?? 1;
  const now = input.now ?? new Date();

  const e = entitlement;
  const s = subscription;
  const result = await database.execute<ReportQueryRow>(sql`
    with active as (
      select ${e.id} as id,
             case when ${e.nextResetAt} <= ${now} and ${e.limit} is not null
               then ${e.limit} else ${e.balance} end as balance,
             ${e.limit} as "limit",
             ${e.nextResetAt} as next_reset_at
      from ${e}
      inner join ${s} on ${e.subscriptionId} = ${s.id}
      where ${e.customerId} = ${input.customerId}
        and ${e.featureId} = ${input.featureId}
        and ${activeSubscriptionCondition}
    ),
    deducted as (
      update ${e}
      set "balance" = ${e.balance} - ${amount},
          "updated_at" = ${now}
      where ${e.id} = (
        select id from active
        where balance >= ${amount} and "limit" is not null
        limit 1
      )
      and ${e.balance} >= ${amount}
      and not exists (select 1 from active where "limit" is null)
      returning ${e.id} as id, ${e.balance} as balance
    )
    select
      coalesce(bool_or(active."limit" is null), false) as "hasUnlimited",
      coalesce(sum(active.balance)::integer, 0) as "totalBalance",
      coalesce(sum(active."limit")::integer, 0) as "totalLimit",
      count(active.*)::integer as "rowCount",
      min(active.next_reset_at) as "earliestResetAt",
      d.id as "deductedId",
      d.balance as "newBalance"
    from active
    left join deducted d on true
    group by d.id, d.balance
  `);

  const row = result.rows[0];
  if (!row || row.rowCount === 0) {
    return { balance: null, success: false };
  }

  if (row.hasUnlimited) {
    return {
      balance: { limit: 0, remaining: 0, resetAt: null, unlimited: true },
      success: true,
    };
  }

  if (row.deductedId) {
    const remaining = row.totalBalance - amount;
    return {
      balance: {
        limit: row.totalLimit,
        remaining,
        resetAt: row.earliestResetAt,
        unlimited: false,
      },
      success: true,
    };
  }

  const balance: EntitlementBalance = {
    limit: row.totalLimit,
    remaining: row.totalBalance,
    resetAt: row.earliestResetAt,
    unlimited: false,
  };

  if (row.totalBalance < amount) {
    return { balance, success: false };
  }

  return reportEntitlementStacked(database, input);
}

async function reportEntitlementStacked(
  database: BirrJSDatabase,
  input: ReportEntitlementInput,
): Promise<ReportResult> {
  const amount = input.amount ?? 1;
  const now = input.now ?? new Date();
  return database.transaction(async (tx) => {
    const rows = (await tx
      .select({
        id: entitlement.id,
        balance: entitlement.balance,
        nextResetAt: entitlement.nextResetAt,
        originalLimit: planFeature.limit,
        resetInterval: planFeature.resetInterval,
      })
      .from(entitlement)
      .innerJoin(subscription, eq(entitlement.subscriptionId, subscription.id))
      .innerJoin(
        planFeature,
        and(
          eq(planFeature.planId, subscription.planId),
          eq(planFeature.featureId, entitlement.featureId),
        ),
      )
      .where(
        and(
          eq(entitlement.customerId, input.customerId),
          eq(entitlement.featureId, input.featureId),
          activeSubscriptionCondition,
        ),
      )
      .for("update", { of: entitlement })) as ActiveEntitlementRow[];

    await resetStaleEntitlements(tx, rows, now);

    const totalBalance = rows.reduce((sum, r) => sum + r.balance, 0);
    if (totalBalance < amount) {
      return { balance: aggregateBalance(rows), success: false };
    }

    // deduct from each row
    const ids: string[] = [];
    const chunks: SQL[] = [sql`(case`];
    let remaining = amount;

    for (const row of rows) {
      if (row.originalLimit === null || row.balance <= 0) continue;
      const deduction = Math.min(row.balance, remaining);
      const target = row.balance - deduction;
      chunks.push(sql`when ${entitlement.id} = ${row.id} then ${target}`);
      ids.push(row.id);
      row.balance = target;
      remaining -= deduction;
    }

    chunks.push(sql`end)::integer`);

    await tx
      .update(entitlement)
      .set({ balance: sql.join(chunks, sql.raw(" ")), updatedAt: now })
      .where(inArray(entitlement.id, ids));

    return { balance: aggregateBalance(rows), success: true };
  });
}

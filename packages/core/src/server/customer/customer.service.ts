import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";
import type { BirrJSDatabase } from "../../database";
import { customer, entitlement, subscription } from "../../database/schema";
import type { Customer } from "../../types/models";

export async function getCustomerById(
  database: BirrJSDatabase,
  customerId: string,
): Promise<Customer | null> {
  const customers = await database
    .select()
    .from(customer)
    .where(and(eq(customer.id, customerId), isNull(customer.deletedAt)))
    .limit(1);
  return (customers[0] as Customer | undefined) ?? null;
}

export async function getCustomerByIdOrThrow(
  database: BirrJSDatabase,
  customerId: string,
): Promise<Customer> {
  const record = await getCustomerById(database, customerId);
  if (!record) {
    throw BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.CUSTOMER_NOT_FOUND);
  }
  return record;
}

export interface CustomerEntitlement {
  featureId: string;
  balance: number;
  limit: number;
  usage: number;
  unlimited: boolean;
  nextResetAt: Date | null;
}

export interface CustomerWithDetails extends Customer {
  subscriptions: Array<{
    id: string;
    planId: string;
    status: string;
    effectiveStatus: string;
    expiresAt: Date | null;
    cancelAtPeriodEnd: boolean;
    createdAt: Date;
  }>;
  entitlements: Record<string, CustomerEntitlement>;
}

export async function getCustomerWithDetails(
  database: BirrJSDatabase,
  customerId: string,
): Promise<CustomerWithDetails | null> {
  const record = await getCustomerById(database, customerId);
  if (!record) return null;

  const subscriptions_ = await database
    .select({
      id: subscription.id,
      planId: subscription.planId,
      status: subscription.status,
      expiresAt: subscription.expiresAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      createdAt: subscription.createdAt,
    })
    .from(subscription)
    .where(and(eq(subscription.customerId, customerId), eq(subscription.status, "active")))
    .orderBy(desc(subscription.createdAt));

  const entitlementRows = await database
    .select({
      featureId: entitlement.featureId,
      balance: entitlement.balance,
      limit: entitlement.limit,
      nextResetAt: entitlement.nextResetAt,
    })
    .from(entitlement)
    .innerJoin(subscription, eq(subscription.id, entitlement.subscriptionId))
    .where(
      and(
        eq(entitlement.customerId, customerId),
        inArray(subscription.status, ["active", "trialing", "past_due"]),
        or(isNull(subscription.endedAt), sql`${subscription.endedAt} > now()`),
      ),
    );

  const entitlementsMap: Record<string, CustomerEntitlement> = {};
  for (const row of entitlementRows) {
    const existing = entitlementsMap[row.featureId];
    const isUnlimited = row.limit === null;

    if (!existing) {
      entitlementsMap[row.featureId] = {
        featureId: row.featureId,
        balance: row.balance ?? 0,
        limit: row.limit ?? 0,
        usage: isUnlimited ? 0 : (row.limit ?? 0) - (row.balance ?? 0),
        unlimited: isUnlimited,
        nextResetAt: row.nextResetAt,
      };
    } else {
      existing.balance += row.balance ?? 0;
      existing.limit += row.limit ?? 0;
      existing.usage += isUnlimited ? 0 : (row.limit ?? 0) - (row.balance ?? 0);
      existing.unlimited ||= isUnlimited;

      if (existing.unlimited) {
        existing.limit = 0;
        existing.usage = 0;
        existing.nextResetAt = null;
      } else if (
        row.nextResetAt &&
        (!existing.nextResetAt || row.nextResetAt < existing.nextResetAt)
      ) {
        existing.nextResetAt = row.nextResetAt;
      }
    }
  }

  return {
    ...record,
    subscriptions: subscriptions_.map((s) => ({
      ...s,
      effectiveStatus: s.status,
    })),
    entitlements: entitlementsMap,
  };
}

export async function syncCustomerWithDefaults(
  database: BirrJSDatabase,
  input: { id: string; email?: string | null; name?: string | null; phone?: string | null },
): Promise<Customer> {
  const existing = await database.select().from(customer).where(eq(customer.id, input.id)).limit(1);

  if (existing[0]) {
    if (
      existing[0].email !== input.email ||
      existing[0].name !== input.name ||
      existing[0].phone !== input.phone
    ) {
      const [updated] = await database
        .update(customer)
        .set({
          email: input.email,
          name: input.name,
          phone: input.phone,
          updatedAt: new Date(),
        })
        .where(eq(customer.id, input.id))
        .returning();
      return updated as Customer;
    }
    return existing[0] as Customer;
  }

  const [created] = await database
    .insert(customer)
    .values({
      id: input.id,
      email: input.email ?? null,
      name: input.name ?? null,
      phone: input.phone ?? null,
    })
    .returning();
  return created as Customer;
}

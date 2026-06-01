import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Pool } from "pg";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { generateId } from "../../packages/core/src/core/utils";
import * as schema from "../../packages/core/src/database/schema";
import { createTestBirrJS, type TestBirrJS } from "./setup";

async function insertPlanWithFeature(pool: Pool, overrides?: { featureLimit?: number | null }) {
  const db = drizzle(pool, { schema });
  const ts = Date.now();
  const planId = `plan_e2e_ent_${ts}`;
  const featureId = `feat_e2e_${ts}`;
  const limit = overrides?.featureLimit === undefined ? 100 : overrides.featureLimit;
  const now = new Date();

  await db.insert(schema.feature).values({
    id: featureId,
    type: limit === null ? "boolean" : "metered",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.plan).values({
    id: planId,
    internalId: planId,
    name: "E2E Entitlement Plan",
    group: "",
    priceAmount: 0,
    priceInterval: "monthly",
    currency: "ETB",
    features: null,
    provider: {},
    isDefault: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.planFeature).values({
    planId,
    featureId,
    limit,
    resetInterval: "month",
    createdAt: now,
    updatedAt: now,
  });

  return { db, planId, featureId, now };
}

async function createSubscriptionWithEntitlement(
  pool: Pool,
  params: {
    customerId: string;
    planId: string;
    featureId: string;
    limit: number | null;
    now: Date;
  },
) {
  const db = drizzle(pool, { schema });
  const subscriptionId = generateId("sub");

  await db.insert(schema.subscription).values({
    id: subscriptionId,
    customerId: params.customerId,
    planId: params.planId,
    status: "active",
    interval: "month",
    cancelAtPeriodEnd: false,
    startedAt: params.now,
    expiresAt: new Date(params.now.getTime() + 86_400_000),
    canceledAt: null,
    endedAt: null,
    createdAt: params.now,
    updatedAt: params.now,
  });

  await db.insert(schema.entitlement).values({
    id: generateId("ent"),
    subscriptionId,
    customerId: params.customerId,
    featureId: params.featureId,
    limit: params.limit,
    balance: params.limit ?? 0,
    nextResetAt: new Date(params.now.getTime() + 86_400_000),
  });
}

describe("entitlement deduction", () => {
  let t: TestBirrJS;

  beforeAll(async () => {
    t = await createTestBirrJS();
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("check returns allowed and report deducts balance for metered feature", async () => {
    const customer = await t.birr.createCustomer({
      email: `ent-metered-${Date.now()}@gmail.com`,
    });
    const { planId, featureId, now } = await insertPlanWithFeature(t.pool);
    await createSubscriptionWithEntitlement(t.pool, {
      customerId: customer.customer.id,
      planId,
      featureId,
      limit: 100,
      now,
    });

    const before = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId,
    });
    expect(before.allowed).toBe(true);
    expect(before.balance).not.toBeNull();
    expect(before.balance!.remaining).toBe(100);

    const reportResult = await t.birr.reportEntitlement({
      customerId: customer.customer.id,
      featureId,
      amount: 1,
    });
    expect(reportResult.success).toBe(true);
    expect(reportResult.balance).not.toBeNull();

    const after = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId,
    });
    expect(after.balance).not.toBeNull();
    expect(after.balance!.remaining).toBe(99);
  });

  it("report fails when balance is insufficient", async () => {
    const customer = await t.birr.createCustomer({
      email: `ent-insufficient-${Date.now()}@gmail.com`,
    });
    const { planId, featureId, now } = await insertPlanWithFeature(t.pool, {
      featureLimit: 5,
    });
    await createSubscriptionWithEntitlement(t.pool, {
      customerId: customer.customer.id,
      planId,
      featureId,
      limit: 5,
      now,
    });

    const reportResult = await t.birr.reportEntitlement({
      customerId: customer.customer.id,
      featureId,
      amount: 10,
    });
    expect(reportResult.success).toBe(false);
    expect(reportResult.balance).not.toBeNull();
    expect(reportResult.balance!.remaining).toBe(5);
  });

  it("boolean feature is always allowed and never depletes", async () => {
    const customer = await t.birr.createCustomer({
      email: `ent-boolean-${Date.now()}@gmail.com`,
    });
    const { planId, featureId, now } = await insertPlanWithFeature(t.pool, {
      featureLimit: null,
    });
    await createSubscriptionWithEntitlement(t.pool, {
      customerId: customer.customer.id,
      planId,
      featureId,
      limit: null,
      now,
    });

    const check = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId,
    });
    expect(check.allowed).toBe(true);
    expect(check.balance?.unlimited).toBe(true);

    const report = await t.birr.reportEntitlement({
      customerId: customer.customer.id,
      featureId,
      amount: 1000,
    });
    expect(report.success).toBe(true);
  });

  it("check returns allowed false when customer has no entitlement", async () => {
    const customer = await t.birr.createCustomer({
      email: `ent-no-ent-${Date.now()}@gmail.com`,
    });
    const { planId, featureId, now } = await insertPlanWithFeature(t.pool);
    await createSubscriptionWithEntitlement(t.pool, {
      customerId: customer.customer.id,
      planId,
      featureId,
      limit: 100,
      now,
    });

    const check = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId: "nonexistent-feature",
    });
    expect(check.allowed).toBe(false);
    expect(check.balance).toBeNull();
  });

  it("stacked entitlements aggregate balance across plans", async () => {
    const customer = await t.birr.createCustomer({
      email: `ent-stacked-${Date.now()}@gmail.com`,
    });
    const db = drizzle(t.pool, { schema });
    const ts = Date.now();
    const featureId = `feat_e2e_stk_${ts}`;
    const planAId = `plan_e2e_stk_a_${ts}`;
    const planBId = `plan_e2e_stk_b_${ts}`;
    const now = new Date();

    await db.insert(schema.feature).values({
      id: featureId,
      type: "metered",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.plan).values({
      id: planAId,
      internalId: planAId,
      name: "Stacked Plan A",
      group: "group_a",
      priceAmount: 0,
      priceInterval: "monthly",
      currency: "ETB",
      features: null,
      provider: {},
      isDefault: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.planFeature).values({
      planId: planAId,
      featureId,
      limit: 500,
      resetInterval: "month",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.plan).values({
      id: planBId,
      internalId: planBId,
      name: "Stacked Plan B",
      group: "group_b",
      priceAmount: 0,
      priceInterval: "monthly",
      currency: "ETB",
      features: null,
      provider: {},
      isDefault: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.planFeature).values({
      planId: planBId,
      featureId,
      limit: 200,
      resetInterval: "month",
      createdAt: now,
      updatedAt: now,
    });

    const subAId = generateId("sub");
    await db.insert(schema.subscription).values({
      id: subAId,
      customerId: customer.customer.id,
      planId: planAId,
      status: "active",
      interval: "month",
      cancelAtPeriodEnd: false,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      canceledAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.entitlement).values({
      id: generateId("ent"),
      subscriptionId: subAId,
      customerId: customer.customer.id,
      featureId,
      limit: 500,
      balance: 500,
      nextResetAt: new Date(now.getTime() + 86_400_000),
    });

    const subBId = generateId("sub");
    await db.insert(schema.subscription).values({
      id: subBId,
      customerId: customer.customer.id,
      planId: planBId,
      status: "active",
      interval: "month",
      cancelAtPeriodEnd: false,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      canceledAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.entitlement).values({
      id: generateId("ent"),
      subscriptionId: subBId,
      customerId: customer.customer.id,
      featureId,
      limit: 200,
      balance: 200,
      nextResetAt: new Date(now.getTime() + 86_400_000),
    });

    const before = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId,
    });
    expect(before.allowed).toBe(true);
    expect(before.balance).not.toBeNull();
    expect(before.balance!.limit).toBe(700);
    expect(before.balance!.remaining).toBe(700);

    const report = await t.birr.reportEntitlement({
      customerId: customer.customer.id,
      featureId,
      amount: 600,
    });
    expect(report.success).toBe(true);
    expect(report.balance).not.toBeNull();
    expect(report.balance!.remaining).toBe(100);

    const after = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId,
    });
    expect(after.balance).not.toBeNull();
    expect(after.balance!.remaining).toBe(100);
  });

  it("returns denied when subscription has expired", async () => {
    const customer = await t.birr.createCustomer({
      email: `ent-expired-${Date.now()}@gmail.com`,
    });
    const { planId, featureId, now } = await insertPlanWithFeature(t.pool);
    await createSubscriptionWithEntitlement(t.pool, {
      customerId: customer.customer.id,
      planId,
      featureId,
      limit: 100,
      now,
    });

    const before = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId,
    });
    expect(before.allowed).toBe(true);
    expect(before.balance).not.toBeNull();
    expect(before.balance!.remaining).toBe(100);

    const db = drizzle(t.pool, { schema });
    await db
      .update(schema.subscription)
      .set({ status: "expired", expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.subscription.customerId, customer.customer.id));

    const after = await t.birr.checkEntitlement({
      customerId: customer.customer.id,
      featureId,
    });
    expect(after.allowed).toBe(false);
    expect(after.balance).toBeNull();
  });
});

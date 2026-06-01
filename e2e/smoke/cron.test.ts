import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import * as schema from "../../packages/core/src/database/schema";
import {
  checkPendingSubscriptions,
  checkExpiredSubscriptions,
} from "../../packages/core/src/server/cron/cron.api";
import { mockChapaProvider } from "./mock-providers";
import { createTestBirrJS, type TestBirrJS } from "./setup";

const PLAN_ID = "e2e_cron_plan";

describe("cron jobs", () => {
  let t: TestBirrJS;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    t = await createTestBirrJS({
      provider: mockChapaProvider("http://localhost:3000/api/birrjs/callback"),
    });
    db = drizzle(t.pool, { schema });

    await db.insert(schema.plan).values({
      id: PLAN_ID,
      internalId: PLAN_ID,
      name: "Cron Test Plan",
      group: "",
      priceAmount: 999,
      priceInterval: "monthly",
      currency: "ETB",
      features: null,
      provider: {},
      isDefault: false,
      version: 1,
    });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("marks timed-out pending subscriptions as failed", async () => {
    const cust = await t.birr.createCustomer({
      email: `cron-pending-${Date.now()}@gmail.com`,
      name: "Cron Pending Test",
    });
    await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });

    // Set createdAt to 2 hours ago so the timeout threshold is exceeded
    await db
      .update(schema.subscription)
      .set({ createdAt: new Date(Date.now() - 120 * 60 * 1000) })
      .where(eq(schema.subscription.customerId, cust.customer.id));

    const result = await checkPendingSubscriptions(await t.birr.$context);

    expect(result).toEqual({ checked: 1, updated: 1 });

    const sub = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, cust.customer.id))
      .limit(1);
    expect(sub[0]!.status).toBe("failed");
  });

  it("marks expired subscriptions as expired", async () => {
    const cust = await t.birr.createCustomer({
      email: `cron-expired-${Date.now()}@gmail.com`,
      name: "Cron Expired Test",
    });
    const subResult = await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });

    // Activate subscription directly in DB, set expiresAt to yesterday
    await db
      .update(schema.subscription)
      .set({
        status: "active",
        startedAt: new Date(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
      .where(eq(schema.subscription.id, subResult.subscriptionId));

    const result = await checkExpiredSubscriptions(await t.birr.$context);

    expect(result).toEqual({ checked: 1, updated: 1 });

    const updated = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subResult.subscriptionId))
      .limit(1);
    expect(updated[0]!.status).toBe("expired");
  });

  it("does not touch recent pending subscriptions", async () => {
    const cust = await t.birr.createCustomer({
      email: `cron-recent-${Date.now()}@gmail.com`,
      name: "Cron Recent Test",
    });
    const subResult = await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });

    const result = await checkPendingSubscriptions(await t.birr.$context);

    expect(result).toEqual({ checked: 0, updated: 0 });

    const sub = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subResult.subscriptionId))
      .limit(1);
    expect(sub[0]!.status).toBe("pending");
  });

  it("marks only timed-out pending subs in a mixed batch", async () => {
    const old = await t.birr.createCustomer({
      email: `cron-old-${Date.now()}@gmail.com`,
      name: "Cron Old Batch",
    });
    const fresh = await t.birr.createCustomer({
      email: `cron-fresh-${Date.now()}@gmail.com`,
      name: "Cron Fresh Batch",
    });
    await t.birr.subscribe({ planId: PLAN_ID, customerId: old.customer.id });
    await t.birr.subscribe({ planId: PLAN_ID, customerId: fresh.customer.id });

    await db
      .update(schema.subscription)
      .set({ createdAt: new Date(Date.now() - 120 * 60 * 1000) })
      .where(eq(schema.subscription.customerId, old.customer.id));

    const result = await checkPendingSubscriptions(await t.birr.$context);

    expect(result).toEqual({ checked: 1, updated: 1 });

    const [oldSub, freshSub] = await Promise.all([
      db
        .select({ status: schema.subscription.status })
        .from(schema.subscription)
        .where(eq(schema.subscription.customerId, old.customer.id))
        .limit(1),
      db
        .select({ status: schema.subscription.status })
        .from(schema.subscription)
        .where(eq(schema.subscription.customerId, fresh.customer.id))
        .limit(1),
    ]);
    expect(oldSub[0]!.status).toBe("failed");
    expect(freshSub[0]!.status).toBe("pending");
  });

  it("respects custom pendingTimeoutMinutes", async () => {
    const custOver = await t.birr.createCustomer({
      email: `cron-custom-over-${Date.now()}@gmail.com`,
      name: "Cron Custom Over",
    });
    const custUnder = await t.birr.createCustomer({
      email: `cron-custom-under-${Date.now()}@gmail.com`,
      name: "Cron Custom Under",
    });
    await t.birr.subscribe({ planId: PLAN_ID, customerId: custOver.customer.id });
    await t.birr.subscribe({ planId: PLAN_ID, customerId: custUnder.customer.id });

    // 31 min ago (over the 30-min custom timeout) and 29 min ago (under it)
    await db
      .update(schema.subscription)
      .set({ createdAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(schema.subscription.customerId, custOver.customer.id));
    await db
      .update(schema.subscription)
      .set({ createdAt: new Date(Date.now() - 29 * 60 * 1000) })
      .where(eq(schema.subscription.customerId, custUnder.customer.id));

    const ctx = await t.birr.$context;
    const customCtx = {
      ...ctx,
      options: {
        ...ctx.options,
        scheduling: { ...ctx.options.scheduling, pendingTimeoutMinutes: 30 },
      },
    };
    const result = await checkPendingSubscriptions(customCtx);

    expect(result).toEqual({ checked: 1, updated: 1 });

    const [overSub, underSub] = await Promise.all([
      db
        .select({ status: schema.subscription.status })
        .from(schema.subscription)
        .where(eq(schema.subscription.customerId, custOver.customer.id))
        .limit(1),
      db
        .select({ status: schema.subscription.status })
        .from(schema.subscription)
        .where(eq(schema.subscription.customerId, custUnder.customer.id))
        .limit(1),
    ]);
    expect(overSub[0]!.status).toBe("failed");
    expect(underSub[0]!.status).toBe("pending");
  });

  it("is idempotent when re-run on already-failed pending subscriptions", async () => {
    const cust = await t.birr.createCustomer({
      email: `cron-idem-pending-${Date.now()}@gmail.com`,
      name: "Cron Idempotent Pending",
    });
    await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });
    await db
      .update(schema.subscription)
      .set({ createdAt: new Date(Date.now() - 120 * 60 * 1000) })
      .where(eq(schema.subscription.customerId, cust.customer.id));

    const ctx = await t.birr.$context;
    const first = await checkPendingSubscriptions(ctx);
    expect(first).toEqual({ checked: 1, updated: 1 });

    const second = await checkPendingSubscriptions(ctx);
    expect(second).toEqual({ checked: 0, updated: 0 });

    const sub = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, cust.customer.id))
      .limit(1);
    expect(sub[0]!.status).toBe("failed");
  });

  it("is idempotent when re-run on already-expired subscriptions", async () => {
    const cust = await t.birr.createCustomer({
      email: `cron-idem-expired-${Date.now()}@gmail.com`,
      name: "Cron Idempotent Expired",
    });
    const subResult = await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });
    await db
      .update(schema.subscription)
      .set({
        status: "active",
        startedAt: new Date(),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
      .where(eq(schema.subscription.id, subResult.subscriptionId));

    const ctx = await t.birr.$context;
    const first = await checkExpiredSubscriptions(ctx);
    expect(first).toEqual({ checked: 1, updated: 1 });

    const second = await checkExpiredSubscriptions(ctx);
    expect(second).toEqual({ checked: 0, updated: 0 });

    const sub = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subResult.subscriptionId))
      .limit(1);
    expect(sub[0]!.status).toBe("expired");
  });
});

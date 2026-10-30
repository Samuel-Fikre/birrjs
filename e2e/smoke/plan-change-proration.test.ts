import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { WebhookPayload } from "../../packages/core/src/api/schemas";
import * as schema from "../../packages/core/src/database/schema";
import { createTestBirrJS, type TestBirrJS } from "./setup";

const hasRealProvider = !!process.env.CHAPA_SECRET_KEY;

type WebhookEvent = WebhookPayload["event"];

const STARTER_PRICE = 9990;
const PRO_PRICE = 19990;
const ANNUAL_PRICE = 199900;

function webhookPayload(txRef: string, event: WebhookEvent = "charge.success") {
  return {
    tx_ref: txRef,
    event,
    currency: "ETB",
    amount: "999",
    charge: "0",
    status: "success",
    mode: "test" as const,
    reference: txRef,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    type: "API" as const,
  };
}

describe.skipIf(hasRealProvider)("plan change and proration", () => {
  let t: TestBirrJS;
  let db: ReturnType<typeof drizzle>;
  let customerId: string;
  let subscriptionId: string;
  let renewalTxRef: string;
  let periodStartAt: Date;
  let periodEndAt: Date;
  let upgradeChangeId: string;

  const plans = {} as Record<"free" | "starter" | "pro" | "annual", string>;
  const seatsFeatureId = "e2e_pc_seats";
  const apiFeatureId = "e2e_pc_api";

  async function seedPlan(
    slug: "free" | "starter" | "pro" | "annual",
    priceAmount: number,
    priceInterval: string,
    limits: Record<string, number>,
  ) {
    const planId = `e2e_pc_${slug}`;
    const now = new Date();

    await db.insert(schema.plan).values({
      id: planId,
      internalId: planId,
      name: `E2E ${slug}`,
      group: "",
      priceAmount,
      priceInterval,
      currency: "ETB",
      features: null,
      provider: {},
      isDefault: false,
      hash: `${planId}@1`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    for (const [featureId, limit] of Object.entries(limits)) {
      await db.insert(schema.planFeature).values({
        planId,
        featureId,
        limit,
        resetInterval: "month",
        createdAt: now,
        updatedAt: now,
      });
    }

    plans[slug] = planId;
  }

  async function readSubscription() {
    const rows = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subscriptionId))
      .limit(1);
    return rows[0]!;
  }

  async function readChange(id: string) {
    const rows = await db
      .select()
      .from(schema.subscriptionPlanChange)
      .where(eq(schema.subscriptionPlanChange.id, id))
      .limit(1);
    return rows[0]!;
  }

  async function countChanges() {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.subscriptionPlanChange);
    return row!.count;
  }

  async function countInvoices(planChangeId: string) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.invoice)
      .where(eq(schema.invoice.planChangeId, planChangeId));
    return row!.count;
  }

  async function readEntitlement(featureId: string) {
    const rows = await db
      .select()
      .from(schema.entitlement)
      .where(
        sql`${schema.entitlement.subscriptionId} = ${subscriptionId} AND ${schema.entitlement.featureId} = ${featureId}`,
      )
      .limit(1);
    return rows[0];
  }

  function fireWebhook(txRef: string, event: WebhookEvent = "charge.success") {
    return t.birr.handleWebhook({
      payload: webhookPayload(txRef, event),
      rawBody: JSON.stringify({ tx_ref: txRef }),
      headers: {},
    });
  }

  beforeAll(async () => {
    t = await createTestBirrJS({ planChanges: { enabled: true } });
    db = drizzle(t.pool, { schema });

    const now = new Date();
    for (const id of [seatsFeatureId, apiFeatureId]) {
      await db
        .insert(schema.feature)
        .values({ id, type: "metered", createdAt: now, updatedAt: now });
    }

    await seedPlan("free", 0, "monthly", { [seatsFeatureId]: 1 });
    await seedPlan("starter", STARTER_PRICE, "monthly", { [seatsFeatureId]: 5 });
    await seedPlan("pro", PRO_PRICE, "monthly", { [seatsFeatureId]: 20, [apiFeatureId]: 1000 });
    await seedPlan("annual", ANNUAL_PRICE, "yearly", { [seatsFeatureId]: 20 });

    const customer = await t.birr.createCustomer({
      email: `plan-change-${Date.now()}@gmail.com`,
      name: "Plan Change User",
    });
    customerId = customer.customer.id;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("activates the starting plan with a full paid period", async () => {
    const subscribed = await t.birr.subscribe({ planId: plans.starter, customerId });
    subscriptionId = subscribed.subscriptionId;

    const pending = await readSubscription();
    renewalTxRef = pending.providerTxRef!;
    await fireWebhook(renewalTxRef);

    const sub = await readSubscription();
    periodStartAt = sub.periodStartAt!;
    periodEndAt = sub.expiresAt!;

    expect(sub.status).toBe("active");
    expect(sub.planId).toBe(plans.starter);
    expect(periodEndAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("prices the unused part of the current period, not a new one", async () => {
    const before = await countChanges();

    const preview = await t.birr.previewPlanChange({
      customerId,
      subscriptionId,
      toPlanId: plans.pro,
    });

    expect(preview.fromPlanId).toBe(plans.starter);
    expect(preview.toPlanId).toBe(plans.pro);
    expect(preview.quote.direction).toBe("upgrade");
    expect(preview.quote.strategy).toBe("keep_anchor");
    expect(preview.quote.requiresPayment).toBe(true);
    expect(preview.quote.creditAmount).toBe(0);
    // The period was bought moments ago, so nearly all of the difference is due.
    expect(preview.quote.amountDue).toBeGreaterThan(PRO_PRICE - STARTER_PRICE - 100);
    expect(preview.quote.amountDue).toBeLessThanOrEqual(PRO_PRICE - STARTER_PRICE);

    // A quote is an estimate: it must not leave a row that blocks the next call.
    expect(await countChanges()).toBe(before);
    expect((await readSubscription()).pendingChangeId).toBeNull();
  });

  it("withholds the new limits until the prorated payment lands", async () => {
    const change = await t.birr.changeSubscription({
      customerId,
      subscriptionId,
      toPlanId: plans.pro,
    });
    upgradeChangeId = change.planChangeId;

    expect(change.status).toBe("pending");
    expect(change.checkoutUrl).toBeTruthy();

    const row = await readChange(change.planChangeId);
    expect(row.status).toBe("pending");
    expect(row.dueNowAmount).toBe(change.quote.amountDue);
    // The change pays under its own reference so the renewal reference survives.
    expect(row.providerTxRef).toBeTruthy();
    expect(row.providerTxRef).not.toBe(renewalTxRef);

    const sub = await readSubscription();
    expect(sub.planId).toBe(plans.starter);
    expect(sub.providerTxRef).toBe(renewalTxRef);
    expect(sub.pendingChangeId).toBe(change.planChangeId);
    expect((await readEntitlement(seatsFeatureId))?.limit).toBe(5);
  });

  it("rejects a second change while one is in flight", async () => {
    await expect(
      t.birr.changeSubscription({ customerId, subscriptionId, toPlanId: plans.annual }),
    ).rejects.toMatchObject({ code: "PLAN_CHANGE_IN_PROGRESS" });

    expect((await readSubscription()).planId).toBe(plans.starter);
  });

  it("applies the change and records the charge once the payment lands", async () => {
    const row = await readChange(upgradeChangeId);
    const settled = await fireWebhook(row.providerTxRef!);
    expect(settled.message).toBe("Plan change applied");

    const sub = await readSubscription();
    expect(sub.planId).toBe(plans.pro);
    expect(sub.status).toBe("active");
    expect(sub.providerTxRef).toBe(renewalTxRef);
    expect(sub.pendingChangeId).toBeNull();
    // Keep-anchor keeps the period already paid for instead of starting a new one.
    expect(sub.periodStartAt).toEqual(periodStartAt);
    expect(sub.expiresAt).toEqual(periodEndAt);

    expect((await readChange(upgradeChangeId)).status).toBe("applied");
    expect((await readChange(upgradeChangeId)).settledAt).toBeTruthy();

    const [invoice] = await db
      .select()
      .from(schema.invoice)
      .where(eq(schema.invoice.planChangeId, upgradeChangeId))
      .limit(1);
    expect(invoice!.kind).toBe("proration");
    expect(invoice!.amount).toBe(row.dueNowAmount);
    expect(invoice!.status).toBe("paid");
    expect(invoice!.providerTxRef).toBe(row.providerTxRef);
    expect(invoice!.lines).toHaveLength(1);

    expect((await readEntitlement(seatsFeatureId))?.limit).toBe(20);
    expect((await readEntitlement(apiFeatureId))?.limit).toBe(1000);
  });

  it("ignores a replayed webhook", async () => {
    const row = await readChange(upgradeChangeId);
    const replayed = await fireWebhook(row.providerTxRef!);

    expect(replayed).toMatchObject({ success: true, message: "Webhook already processed" });
    expect(await countInvoices(upgradeChangeId)).toBe(1);
    expect((await readSubscription()).planId).toBe(plans.pro);
  });

  it("rebases the cycle when the interval changes", async () => {
    const preview = await t.birr.previewPlanChange({
      customerId,
      subscriptionId,
      toPlanId: plans.annual,
    });

    expect(preview.quote.strategy).toBe("rebase");
    expect(preview.quote.debitAmount).toBe(ANNUAL_PRICE);
    // The month already paid for is credited against the year being bought.
    expect(preview.quote.creditAmount).toBeGreaterThan(PRO_PRICE - 100);
    expect(preview.quote.amountDue).toBe(ANNUAL_PRICE - preview.quote.creditAmount);
    expect(preview.quote.lines.map((line: { kind: string }) => line.kind)).toEqual([
      "new_period_charged",
      "unused_period_credited",
    ]);
  });

  it("leaves the plan untouched when the change payment fails", async () => {
    const change = await t.birr.changeSubscription({
      customerId,
      subscriptionId,
      toPlanId: plans.annual,
    });
    const row = await readChange(change.planChangeId);

    const result = await fireWebhook(row.providerTxRef!, "charge.failed/cancelled");
    expect(result.message).toBe("Plan change voided");

    const sub = await readSubscription();
    expect(sub.planId).toBe(plans.pro);
    expect(sub.expiresAt).toEqual(periodEndAt);
    expect(sub.pendingChangeId).toBeNull();

    expect((await readChange(change.planChangeId)).status).toBe("voided");
    expect(await countInvoices(change.planChangeId)).toBe(0);
  });

  it("defers a period-end downgrade until it can be withdrawn", async () => {
    const change = await t.birr.changeSubscription({
      customerId,
      subscriptionId,
      toPlanId: plans.starter,
      prorationBehavior: "next_period",
    });

    // Nothing is collected now, so the change waits for renewal instead of paying.
    expect(change.status).toBe("pending");
    expect(change.quote.amountDue).toBe(0);
    expect(change.checkoutUrl).toBeUndefined();
    expect((await readChange(change.planChangeId)).providerTxRef).toBeNull();

    const cancelled = await t.birr.cancelPlanChange({ customerId, subscriptionId });
    expect(cancelled).toMatchObject({ cancelled: true, planChangeId: change.planChangeId });
    expect((await readChange(change.planChangeId)).status).toBe("voided");
    expect((await readSubscription()).pendingChangeId).toBeNull();

    // Withdrawing releases the one-open-change guard, so the customer can reschedule.
    const again = await t.birr.changeSubscription({
      customerId,
      subscriptionId,
      toPlanId: plans.starter,
      prorationBehavior: "next_period",
    });
    expect(again.status).toBe("pending");

    const dropped = await t.birr.cancelPlanChange({ customerId, subscriptionId });
    expect(dropped.cancelled).toBe(true);
    expect((await readSubscription()).planId).toBe(plans.pro);
  });

  it("settles a move that owes nothing in the same call", async () => {
    const change = await t.birr.changeSubscription({
      customerId,
      subscriptionId,
      toPlanId: plans.free,
    });

    expect(change.status).toBe("applied");
    expect(change.checkoutUrl).toBeUndefined();
    // A downgrade mid-period earns credit, and there is no refund API to pay it out.
    expect(change.quote.bankedCredit).toBeGreaterThan(0);

    const sub = await readSubscription();
    expect(sub.planId).toBe(plans.free);
    expect(sub.expiresAt).toEqual(periodEndAt);

    expect(await countInvoices(change.planChangeId)).toBe(0);
    expect((await readEntitlement(seatsFeatureId))?.limit).toBe(1);
    expect(await readEntitlement(apiFeatureId)).toBeUndefined();

    const check = await t.birr.checkSubscription({ customerId });
    expect(check).toMatchObject({ allowed: true, effectiveStatus: "active" });
  });
});

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import * as schema from "../../packages/core/src/database/schema";
import { createTestBirrJS, type TestBirrJS } from "./setup";

const hasRealProvider = !!process.env.CHAPA_SECRET_KEY;

function webhookPayload(txRef: string) {
  return {
    tx_ref: txRef,
    event: "charge.success" as const,
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

describe.skipIf(hasRealProvider)("subscription lifecycle", () => {
  let t: TestBirrJS;
  let db: ReturnType<typeof drizzle>;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestBirrJS();
    db = drizzle(t.pool, { schema });

    await db.insert(schema.plan).values({
      id: "e2e_lifecycle_plan",
      internalId: "e2e_lifecycle_plan",
      name: "E2E Lifecycle Plan",
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

  it("subscribes and returns checkout URL", async () => {
    const customer = await t.birr.createCustomer({
      email: `lifecycle-${Date.now()}@gmail.com`,
      name: "Lifecycle User",
    });
    customerId = customer.customer.id;

    const result = await t.birr.subscribe({
      planId: "e2e_lifecycle_plan",
      customerId,
    });

    expect(result.checkoutUrl).toBeTruthy();
    expect(result.subscriptionId).toBeTruthy();
    expect(result.customerId).toBe(customerId);
  });

  it("activates subscription via webhook", async () => {
    const subs = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customerId))
      .orderBy(schema.subscription.createdAt)
      .limit(1);
    const sub = subs[0]!;
    const txRef = sub.providerTxRef!;

    const whResult = await t.birr.handleWebhook({
      payload: webhookPayload(txRef),
      rawBody: JSON.stringify({ tx_ref: txRef }),
      headers: {},
    });

    expect(whResult.success).toBe(true);

    const check = await t.birr.checkSubscription({ customerId });
    expect(check.allowed).toBe(true);
    expect(check.effectiveStatus).toBe("active");
  });

  it("cancels active subscription at period end", async () => {
    const subs = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customerId))
      .limit(1);
    const sub = subs[0]!;

    const cancelResult = await t.birr.cancelSubscription({
      subscriptionId: sub.id,
      customerId,
    });

    expect(cancelResult.subscription).toBeDefined();

    // Cancel-at-period-end: subscription stays active until expiresAt
    const updated = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, sub.id))
      .limit(1);
    expect(updated[0]!.cancelAtPeriodEnd).toBe(true);
    expect(updated[0]!.endedAt).toEqual(updated[0]!.expiresAt);

    const check = await t.birr.checkSubscription({ customerId });
    expect(check.allowed).toBe(true);
    expect(check.effectiveStatus).toBe("active");
  });

  it("returns no access for customer with no subscription", async () => {
    const customer = await t.birr.createCustomer({
      email: `no-sub-${Date.now()}@gmail.com`,
    });

    const check = await t.birr.checkSubscription({
      customerId: customer.customer.id,
    });

    expect(check.allowed).toBe(false);
    expect(check.effectiveStatus).toBe("none");
  });
});

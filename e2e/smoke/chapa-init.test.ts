import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import * as schema from "../../packages/core/src/database/schema";
import { createTestBirrJS, type TestBirrJS } from "./setup";

const hasRealProvider = !!process.env.CHAPA_SECRET_KEY;

describe.skipIf(!hasRealProvider)("Chapa transaction init", () => {
  let t: TestBirrJS;

  beforeAll(async () => {
    t = await createTestBirrJS();
    const db = drizzle(t.pool, { schema });

    await db.insert(schema.plan).values({
      id: "e2e_chapa_init_plan",
      internalId: "e2e_chapa_init_plan",
      name: "Chapa Init Test Plan",
      group: "",
      priceAmount: 1000,
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

  it("initializes a real transaction with Chapa", async () => {
    const customer = await t.birr.createCustomer({
      email: `chapa-init-${Date.now()}@gmail.com`,
      name: "Chapa Init Test",
    });

    const result = await t.birr.subscribe({
      planId: "e2e_chapa_init_plan",
      customerId: customer.customer.id,
    });

    expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.chapa\.co\//);
    expect(result.subscriptionId).toBeTruthy();
    expect(result.customerId).toBe(customer.customer.id);
  }, 60_000);

  it("creates a pending subscription with provider tx ref", async () => {
    const customer = await t.birr.createCustomer({
      email: `chapa-pending-${Date.now()}@gmail.com`,
      name: "Chapa Pending Test",
    });

    await t.birr.subscribe({
      planId: "e2e_chapa_init_plan",
      customerId: customer.customer.id,
    });

    const db = drizzle(t.pool, { schema });
    const subs = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customer.customer.id))
      .limit(1);

    const sub = subs[0]!;
    expect(sub.status).toBe("pending");
    expect(sub.providerTxRef).toBeTruthy();
    expect(sub.planId).toBe("e2e_chapa_init_plan");
  });
});

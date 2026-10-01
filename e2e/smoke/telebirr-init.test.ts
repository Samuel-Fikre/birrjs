import { readFileSync } from "node:fs";

import { telebirr } from "@birrjs/telebirr";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import * as schema from "../../packages/core/src/database/schema";
import { createTestBirrJS, type TestBirrJS } from "./setup";

const hasRealProvider = !!(
  process.env.TELEBIRR_GATEWAY_URL &&
  process.env.TELEBIRR_CHECKOUT_URL &&
  process.env.TELEBIRR_FABRIC_APP_ID &&
  process.env.TELEBIRR_APP_SECRET &&
  process.env.TELEBIRR_MERCHANT_APP_ID &&
  process.env.TELEBIRR_MERCHANT_CODE &&
  (process.env.TELEBIRR_PRIVATE_KEY || process.env.TELEBIRR_PRIVATE_KEY_PATH)
);

describe.skipIf(!hasRealProvider)("Telebirr transaction init", () => {
  let t: TestBirrJS;

  beforeAll(async () => {
    const privateKeyPem =
      process.env.TELEBIRR_PRIVATE_KEY ??
      readFileSync(process.env.TELEBIRR_PRIVATE_KEY_PATH!, "utf-8");
    const callbackUrl = process.env.CALLBACK_URL ?? "http://localhost:3000/api/birrjs/callback";

    t = await createTestBirrJS({
      provider: telebirr({
        gatewayUrl: process.env.TELEBIRR_GATEWAY_URL!,
        checkoutUrl: process.env.TELEBIRR_CHECKOUT_URL!,
        fabricAppId: process.env.TELEBIRR_FABRIC_APP_ID!,
        appSecret: process.env.TELEBIRR_APP_SECRET!,
        merchantAppId: process.env.TELEBIRR_MERCHANT_APP_ID!,
        merchantCode: process.env.TELEBIRR_MERCHANT_CODE!,
        privateKeyPem,
        telebirrPublicKeyPem: process.env.TELEBIRR_PUBLIC_KEY || undefined,
        notifyUrl: callbackUrl,
        redirectUrl: process.env.TELEBIRR_REDIRECT_URL || callbackUrl,
      }),
    });
    const db = drizzle(t.pool, { schema });

    await db.insert(schema.plan).values({
      id: "e2e_telebirr_init_plan",
      internalId: "e2e_telebirr_init_plan",
      name: "Telebirr Init Test Plan",
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

  it("initializes a real transaction with Telebirr", async () => {
    const customer = await t.birr.createCustomer({
      email: `telebirr-init-${Date.now()}@gmail.com`,
      name: "Telebirr Init Test",
    });

    const result = await t.birr.subscribe({
      planId: "e2e_telebirr_init_plan",
      customerId: customer.customer.id,
    });

    expect(result.checkoutUrl).toMatch(/^https:\/\//);
    expect(result.subscriptionId).toBeTruthy();
    expect(result.customerId).toBe(customer.customer.id);
  }, 60_000);

  it("creates a pending subscription with provider tx ref", async () => {
    const customer = await t.birr.createCustomer({
      email: `telebirr-pending-${Date.now()}@gmail.com`,
      name: "Telebirr Pending Test",
    });

    await t.birr.subscribe({
      planId: "e2e_telebirr_init_plan",
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
    expect(sub.planId).toBe("e2e_telebirr_init_plan");
  });
});

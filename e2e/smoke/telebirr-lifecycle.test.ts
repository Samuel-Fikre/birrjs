import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import * as schema from "../../packages/core/src/database/schema";
import { mockTelebirrProvider } from "./mock-providers";
import {
  createTestBirrJS,
  startWebhookServer,
  type TestBirrJS,
  type WebhookTestServer,
} from "./setup";

const PLAN_ID = "e2e_telebirr_plan";

function telebirrNotifyPayload(txRef: string, tradeStatus = "Completed") {
  return {
    merch_order_id: txRef,
    trade_status: tradeStatus,
    total_amount: "9.99",
    trans_currency: "ETB",
    payment_order_id: `tele_${txRef}`,
    result: "SUCCESS",
  };
}

describe("telebirr subscription lifecycle", () => {
  let t: TestBirrJS;
  let ws: WebhookTestServer;
  let db: ReturnType<typeof drizzle>;
  let setOrderStatus: (merchantOrderId: string, status: string) => void;
  let customerId: string;
  let subscriptionTxRef: string;

  async function createSubscriber(prefix: string): Promise<{ customerId: string; txRef: string }> {
    const customer = await t.birr.createCustomer({
      email: `${prefix}-${Date.now()}@gmail.com`,
      name: `Telebirr ${prefix}`,
    });
    await t.birr.subscribe({
      planId: PLAN_ID,
      customerId: customer.customer.id,
    });
    const txRef = await txRefOf(customer.customer.id);
    return { customerId: customer.customer.id, txRef };
  }

  async function subStatus(customerId_: string): Promise<string> {
    const subs = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customerId_))
      .limit(1);
    return subs[0]!.status;
  }

  async function txRefOf(customerId_: string): Promise<string> {
    const subs = await db
      .select({ providerTxRef: schema.subscription.providerTxRef })
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customerId_))
      .limit(1);
    return subs[0]!.providerTxRef!;
  }

  async function postNotify(txRef: string, tradeStatus?: string): Promise<Response> {
    return fetch(`http://localhost:${ws.port}/api/birrjs/handle-webhook`, {
      method: "POST",
      body: JSON.stringify(telebirrNotifyPayload(txRef, tradeStatus)),
      headers: { "content-type": "application/json" },
    });
  }

  async function getCallback(txRef: string, tradeStatus: string): Promise<Response> {
    const query = new URLSearchParams({ merch_order_id: txRef, trade_status: tradeStatus });
    return fetch(`http://localhost:${ws.port}/api/birrjs/handle-webhook?${query}`);
  }

  beforeAll(async () => {
    const mock = mockTelebirrProvider("http://localhost:3000/api/birrjs/callback");
    setOrderStatus = mock.setOrderStatus;

    t = await createTestBirrJS({ provider: mock.config });
    db = drizzle(t.pool, { schema });
    ws = await startWebhookServer(t.birr);

    await db.insert(schema.plan).values({
      id: PLAN_ID,
      internalId: PLAN_ID,
      name: "Telebirr Lifecycle Plan",
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
    ws?.close();
    await t?.cleanup();
  });

  it("subscribes and returns Telebirr checkout URL", async () => {
    const customer = await t.birr.createCustomer({
      email: `telebirr-lifecycle-${Date.now()}@gmail.com`,
      name: "Telebirr Lifecycle User",
    });
    customerId = customer.customer.id;

    const result = await t.birr.subscribe({
      planId: PLAN_ID,
      customerId,
    });

    expect(result.checkoutUrl).toContain("checkout.ethiomobilemoney.et");
    expect(result.subscriptionId).toBeTruthy();
    expect(result.customerId).toBe(customerId);

    subscriptionTxRef = await txRefOf(customerId);
    expect(subscriptionTxRef).toBeTruthy();
    expect(await subStatus(customerId)).toBe("pending");
  });

  it("activates via Telebirr notify POST (re-queries provider)", async () => {
    const response = await postNotify(subscriptionTxRef);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Webhook processed successfully");

    expect(await subStatus(customerId)).toBe("active");

    const check = await t.birr.checkSubscription({ customerId });
    expect(check.allowed).toBe(true);
    expect(check.effectiveStatus).toBe("active");
  });

  it("activates via GET redirect query dialect (merch_order_id + trade_status)", async () => {
    const { customerId: freshId, txRef } = await createSubscriber("telebirr-get");

    const response = await getCallback(txRef, "PAY_SUCCESS");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Callback processed successfully");

    expect(await subStatus(freshId)).toBe("active");
  });

  it("skips non-succes  s GET callback, subscription stays pending", async () => {
    const { customerId: freshId, txRef } = await createSubscriber("telebirr-skip");

    const response = await getCallback(txRef, "PAY_FAILED");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Callback received");

    expect(await subStatus(freshId)).toBe("pending");
  });

  it("marks subscription failed when payment verification fails", async () => {
    const { customerId: freshId, txRef } = await createSubscriber("telebirr-fail");

    setOrderStatus(txRef, "PAY_FAILED");
    const response = await postNotify(txRef, "PAY_FAILED");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Webhook processed successfully");

    expect(await subStatus(freshId)).toBe("failed");
  });

  it("duplicate notify is idempotent", async () => {
    const response = await postNotify(subscriptionTxRef);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Webhook already processed");

    expect(await subStatus(customerId)).toBe("active");
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
});

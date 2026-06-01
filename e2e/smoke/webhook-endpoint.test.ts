import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import * as schema from "../../packages/core/src/database/schema";
import { mockChapaProvider } from "./mock-providers";
import {
  createTestBirrJS,
  startWebhookServer,
  type TestBirrJS,
  type WebhookTestServer,
} from "./setup";

const PLAN_ID = "e2e_webhook_http_plan";

function chapaWebhookPayload(txRef: string, eventType?: string) {
  return {
    tx_ref: txRef,
    event: eventType ?? "charge.success",
    currency: "ETB",
    amount: "999",
    charge: "0",
    status: eventType?.startsWith("charge.failed") ? "failed" : "success",
    mode: "test" as const,
    reference: txRef,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    type: "API" as const,
  };
}

describe("webhook HTTP endpoint", () => {
  let t: TestBirrJS;
  let ws: WebhookTestServer;
  let db: ReturnType<typeof drizzle>;
  let customerId: string;
  let subscriptionTxRef: string;

  beforeAll(async () => {
    t = await createTestBirrJS({
      provider: mockChapaProvider("http://localhost:3000/api/birrjs/callback"),
    });
    db = drizzle(t.pool, { schema });
    ws = await startWebhookServer(t.birr);

    // Insert a plan
    await db.insert(schema.plan).values({
      id: PLAN_ID,
      internalId: PLAN_ID,
      name: "Webhook HTTP Test Plan",
      group: "",
      priceAmount: 999,
      priceInterval: "monthly",
      currency: "ETB",
      features: null,
      provider: {},
      isDefault: false,
      version: 1,
    });

    // Create customer + subscribe → creates pending subscription
    const customer = await t.birr.createCustomer({
      email: `webhook-http-${Date.now()}@gmail.com`,
      name: "Webhook HTTP User",
    });
    customerId = customer.customer.id;

    await t.birr.subscribe({
      planId: PLAN_ID,
      customerId,
    });

    // Read providerTxRef from DB for correlation
    const subs = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customerId))
      .limit(1);
    const sub = subs[0]!;
    subscriptionTxRef = sub.providerTxRef!;
  });

  afterAll(async () => {
    ws?.close();
    await t?.cleanup();
  });

  it("activates pending subscription via HTTP endpoint", async () => {
    const response = await fetch(`http://localhost:${ws.port}/api/handle-webhook`, {
      method: "POST",
      body: JSON.stringify(chapaWebhookPayload(subscriptionTxRef)),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message?: string };
    expect(body.success).toBe(true);

    const subs = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customerId))
      .limit(1);
    expect(subs[0]!.status).toBe("active");
  });

  it("duplicate webhook is idempotent", async () => {
    const response = await fetch(`http://localhost:${ws.port}/api/handle-webhook`, {
      method: "POST",
      body: JSON.stringify(chapaWebhookPayload(subscriptionTxRef)),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.message).toBe("Webhook already processed");

    const subs = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.customerId, customerId))
      .limit(1);
    expect(subs[0]!.status).toBe("active");
  });

  it("rejects malformed JSON body", async () => {
    const response = await fetch(`http://localhost:${ws.port}/api/handle-webhook`, {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
  });

  it("marks subscription as failed on charge.failed/cancelled webhook", async () => {
    const cust = await t.birr.createCustomer({
      email: `webhook-failed-${Date.now()}@gmail.com`,
      name: "Webhook Failed Test",
    });
    const subResult = await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });

    const subs = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subResult.subscriptionId))
      .limit(1);
    const sub = subs[0]!;

    const response = await fetch(`http://localhost:${ws.port}/api/handle-webhook`, {
      method: "POST",
      body: JSON.stringify(chapaWebhookPayload(sub.providerTxRef!, "charge.failed/cancelled")),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);

    const updated = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.id, sub.id))
      .limit(1);
    expect(updated[0]!.status).toBe("failed");
  });

  it("cancels subscription on charge.reversed webhook", async () => {
    const cust = await t.birr.createCustomer({
      email: `webhook-reversed-${Date.now()}@gmail.com`,
      name: "Webhook Reversed Test",
    });
    const subResult = await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });

    const subs = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subResult.subscriptionId))
      .limit(1);
    const sub = subs[0]!;

    const response = await fetch(`http://localhost:${ws.port}/api/handle-webhook`, {
      method: "POST",
      body: JSON.stringify(chapaWebhookPayload(sub.providerTxRef!, "charge.reversed")),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);

    const updated = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.id, sub.id))
      .limit(1);
    expect(updated[0]!.status).toBe("cancelled");
  });

  it("cancels subscription on charge.refunded webhook", async () => {
    const cust = await t.birr.createCustomer({
      email: `webhook-refunded-${Date.now()}@gmail.com`,
      name: "Webhook Refunded Test",
    });
    const subResult = await t.birr.subscribe({ planId: PLAN_ID, customerId: cust.customer.id });

    const subs = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subResult.subscriptionId))
      .limit(1);
    const sub = subs[0]!;

    const response = await fetch(`http://localhost:${ws.port}/api/handle-webhook`, {
      method: "POST",
      body: JSON.stringify(chapaWebhookPayload(sub.providerTxRef!, "charge.refunded")),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);

    const updated = await db
      .select({ status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.id, sub.id))
      .limit(1);
    expect(updated[0]!.status).toBe("cancelled");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestBirrJS, type TestBirrJS } from "./setup";

describe("subscription status checks", () => {
  let t: TestBirrJS;

  beforeAll(async () => {
    t = await createTestBirrJS();
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("checks subscription status for a customer with no subscription", async () => {
    const customer = await t.birr.createCustomer({
      email: "status-test@gmail.com",
    });

    const result = await t.birr.checkSubscription({
      customerId: customer.customer.id,
    });

    expect(result.allowed).toBe(false);
    expect(typeof result.effectiveStatus).toBe("string");
  });

  it("lists subscriptions for a customer with no subscriptions", async () => {
    const customer = await t.birr.createCustomer({
      email: "list-empty@gmail.com",
    });

    const result = await t.birr.listSubscriptions({
      customerId: customer.customer.id,
      limit: 20,
      offset: 0,
    });

    expect(result.subscriptions).toHaveLength(0);
  });
});

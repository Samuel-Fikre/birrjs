import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestBirrJS, type TestBirrJS } from "./setup";

describe("customer lifecycle", () => {
  let t: TestBirrJS;

  beforeAll(async () => {
    t = await createTestBirrJS();
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("creates a customer", async () => {
    const result = await t.birr.createCustomer({
      email: "test@gmail.com",
      name: "Test User",
    });

    expect(result.customer).toBeDefined();
    expect(result.customer.email).toBe("test@gmail.com");
    expect(result.customer.name).toBe("Test User");
  });

  it("creates and retrieves a customer", async () => {
    const created = await t.birr.createCustomer({
      email: "get-test@gmail.com",
      name: "Get Test",
    });

    const result = await t.birr.getCustomer({
      customerId: created.customer.id,
    });

    expect(result.customer.id).toBe(created.customer.id);
    expect(result.customer.email).toBe("get-test@gmail.com");
  });

  it("gets customer with details (subscriptions + entitlements)", async () => {
    const created = await t.birr.createCustomer({
      email: "details@test.com",
    });

    const result = await t.birr.getCustomerWithDetails({
      customerId: created.customer.id,
    });

    expect(result.customer.id).toBe(created.customer.id);
    expect(result.customer.subscriptions).toEqual([]);
    expect(result.customer.entitlements).toEqual({});
  });

  it("soft-deletes a customer", async () => {
    const created = await t.birr.createCustomer({
      email: "delete@test.com",
    });

    await t.birr.deleteCustomer({
      customerId: created.customer.id,
    });

    await expect(t.birr.getCustomer({ customerId: created.customer.id })).rejects.toThrow();
  });

  it("updates customer email and name", async () => {
    const created = await t.birr.createCustomer({
      email: "before-update@test.com",
      name: "Before",
    });

    const updated = await t.birr.updateCustomer({
      customerId: created.customer.id,
      email: "after-update@test.com",
      name: "After",
    });

    expect(updated.customer.email).toBe("after-update@test.com");
    expect(updated.customer.name).toBe("After");
  });

  it("throws when updating non-existent customer", async () => {
    await expect(
      t.birr.updateCustomer({
        customerId: "cus_nonexistent",
        email: "ghost@test.com",
      }),
    ).rejects.toThrow();
  });

  it("throws when creating customer with duplicate email", async () => {
    await t.birr.createCustomer({ email: "duplicate@test.com" });

    await expect(t.birr.createCustomer({ email: "duplicate@test.com" })).rejects.toThrow();
  });

  it("throws when getting non-existent customer", async () => {
    await expect(t.birr.getCustomer({ customerId: "cus_nonexistent" })).rejects.toThrow();
  });

  it("throws when email is invalid", async () => {
    await expect(t.birr.createCustomer({ email: "not-an-email" })).rejects.toThrow();
  });

  it("throws when name exceeds 100 characters", async () => {
    await expect(
      t.birr.createCustomer({
        email: "longname@test.com",
        name: "a".repeat(101),
      }),
    ).rejects.toThrow();
  });
});

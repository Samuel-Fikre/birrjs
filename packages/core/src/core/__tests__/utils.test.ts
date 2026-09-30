import { describe, it, expect } from "vitest";

import { generateId, generateTxRef } from "../utils";

describe("generateId", () => {
  it("generates an id with the given prefix", () => {
    const id = generateId("cust");
    expect(id).toMatch(/^cust_[0-9A-Za-z]{24}$/);
  });

  it("generates unique ids for sequential calls", () => {
    const a = generateId("sub");
    const b = generateId("sub");
    expect(a).not.toBe(b);
  });

  it("throws when prefix is empty", () => {
    expect(() => generateId("")).toThrow("prefix is required");
  });
});

describe("generateTxRef", () => {
  it("generates a Telebirr-safe ref (letters and digits only)", () => {
    const txRef = generateTxRef();
    expect(txRef).toMatch(/^tx[0-9A-Za-z]{24}$/);
    expect(txRef).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("generates unique refs for sequential calls", () => {
    const a = generateTxRef();
    const b = generateTxRef();
    expect(a).not.toBe(b);
  });
});

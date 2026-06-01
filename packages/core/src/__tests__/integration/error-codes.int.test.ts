import { describe, it, expect } from "vitest";

import { BirrJSError, BIRRJS_ERROR_CODES } from "../../core/error-codes";

describe("BirrJSError", () => {
  it("carries the error code from BIRRJS_ERROR_CODES", () => {
    const err = BirrJSError.from("NOT_FOUND", BIRRJS_ERROR_CODES.PLAN_NOT_FOUND);
    expect(err.code).toBe("PLAN_NOT_FOUND");
  });

  it("accepts custom message override", () => {
    const err = BirrJSError.from("BAD_REQUEST", BIRRJS_ERROR_CODES.INVALID_INPUT, "Custom msg");
    expect(err.message).toBe("Custom msg");
    expect(err.code).toBe("INVALID_INPUT");
  });
});

describe("BIRRJS_ERROR_CODES", () => {
  it("each code has a non-empty message", () => {
    for (const entry of Object.values(BIRRJS_ERROR_CODES)) {
      expect(entry.message).toBeTruthy();
    }
  });
});

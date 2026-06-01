import { describe, it, expect, vi } from "vitest";
import * as z from "zod";

import { defineBirrJSMethod } from "../../api/endpoint";
import type { BirrJSDatabase } from "../../database";
import { createTestContext } from "../helpers/create-test-context";

describe("defineBirrJSMethod call chain", () => {
  it("passes parsed input to the handler", async () => {
    const method = defineBirrJSMethod(
      {
        input: z.object({ name: z.string() }),
      },
      async (ctx) => ctx.input.name,
    );

    const result = await method(createTestContext(), { name: "Sam" });
    expect(result).toBe("Sam");
  });

  it.each([
    ["undefined", undefined],
    ["empty object", {}],
  ])("passes %s through when no input schema", async (_, input) => {
    const method = defineBirrJSMethod({ input: undefined }, async (ctx) => ctx.input);

    const result = await method(createTestContext(), input as never);
    expect(result).toEqual(input);
  });

  it("rejects invalid input", async () => {
    const method = defineBirrJSMethod(
      {
        input: z.object({ name: z.string().min(1) }),
      },
      async (ctx) => ctx.input.name,
    );

    await expect(method(createTestContext(), { name: "" } as never)).rejects.toThrow();
  });

  it("strips customerId from input before handler and resolves full customer", async () => {
    const mockCustomer = {
      id: "cus_abc",
      email: "test@example.com",
      name: "Test User",
      metadata: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockLimit = vi.fn().mockResolvedValue([mockCustomer]);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    const method = defineBirrJSMethod(
      {
        input: z.object({ planId: z.string() }).loose(),
        requireCustomer: true,
      },
      async (ctx) => {
        const hasCustomerId = "customerId" in (ctx.input as Record<string, unknown>);
        return {
          input: ctx.input,
          hasCustomerId,
          customerId: (ctx as Record<string, unknown>).customer
            ? (((ctx as Record<string, unknown>).customer as Record<string, unknown>).id as string)
            : undefined,
        };
      },
    );

    const ctx = createTestContext({
      database: { select: mockSelect } as unknown as BirrJSDatabase,
    });

    const result = await method(ctx, {
      customerId: "cus_abc",
      planId: "plan_1",
    });

    expect(result.input).toEqual({ planId: "plan_1" });
    expect(result.hasCustomerId).toBe(false);
    expect(result.customerId).toBe("cus_abc");
  });
});

describe("defineBirrJSMethod stamps endpoint metadata", () => {
  it("stamps .endpoint when route config is provided", () => {
    const method = defineBirrJSMethod(
      {
        input: z.object({}),
        route: { method: "POST", path: "/test" },
      },
      async () => "done",
    );

    expect(method.endpoint).toBeDefined();
    expect(typeof method.endpoint).toBe("function");
  });

  it("does not stamp .endpoint when no route config", () => {
    const method = defineBirrJSMethod({ input: undefined }, async () => "done");

    expect(method.endpoint).toBeUndefined();
  });
});

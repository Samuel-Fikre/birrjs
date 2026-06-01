import { describe, it, expect, vi, beforeEach } from "vitest";

import { createBirrJSClient } from "../../client";

const mockFetch = vi.fn();

vi.mock("@better-fetch/fetch", () => ({
  createFetch: () => mockFetch,
}));

beforeEach(() => {
  mockFetch.mockClear();
});

type BirrJSClientProxy = Record<string, (input?: Record<string, unknown>) => Promise<unknown>>;

describe("createBirrJSClient proxy", () => {
  it("converts camelCase path to kebab-case", async () => {
    const client = createBirrJSClient({
      baseURL: "http://test.local/api",
    }) as unknown as BirrJSClientProxy;

    await client.listPlans!({});

    expect(mockFetch).toHaveBeenCalledWith("/list-plans", { method: "POST", body: {} });
  });

  it("sends POST method", async () => {
    const client = createBirrJSClient({
      baseURL: "http://test.local/api",
    }) as unknown as BirrJSClientProxy;

    await client.checkEntitlement!({});

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends first argument as request body", async () => {
    const body = { planId: "pro", customerId: "cus_test" };
    const client = createBirrJSClient({
      baseURL: "http://test.local/api",
    }) as unknown as BirrJSClientProxy;

    await client.subscribe!(body);

    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body }));
  });

  it("sends empty object when no argument", async () => {
    const client = createBirrJSClient({
      baseURL: "http://test.local/api",
    }) as unknown as BirrJSClientProxy;

    await client.listPlans!();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: {} }),
    );
  });
});

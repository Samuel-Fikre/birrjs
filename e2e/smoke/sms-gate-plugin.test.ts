import type { BirrJSContext } from "@birrjs/core";
import { smsGate, type SmsGateConfig } from "@birrjs/sms-gate";
import { describe, it, expect, vi, beforeEach } from "vitest";

const config: SmsGateConfig = {
  username: "testuser",
  password: "testpass",
  deviceId: "dev-123",
};

function mockFetch(status: number, body: unknown) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}

function jwtResponse() {
  return {
    access_token: "jwt",
    refresh_token: "refresh",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
}

function mockContext(overrides?: Partial<BirrJSContext>): BirrJSContext {
  return {
    options: {} as any,
    queries: { getCustomer: vi.fn(), getSubscription: vi.fn() },
    database: {} as any,
    provider: {} as any,
    runtime: {} as any,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    } as any,
    destroy: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockReset();
});

describe("smsGate() plugin integration", () => {
  describe("subscription.activated", () => {
    it("sends payment received SMS to customer phone", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const plugin = smsGate(config);
      const ctx = mockContext({
        queries: {
          getCustomer: vi.fn().mockResolvedValue({ id: "c1", phone: "+251900000001" }),
          getSubscription: vi.fn(),
        },
      });

      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "c1",
          planName: "Pro",
          planId: "pro",
          subscriptionId: "s1",
          customerEmail: "a@b.com",
          startedAt: new Date(),
          expiresAt: null,
        },
        ctx,
      );

      const body = sentBody("/messages");
      expect(body.phoneNumbers).toEqual(["+251900000001"]);
      expect(body.textMessage.text).toMatch(/payment.*received/i);
    });

    it("skips if customer has no phone", async () => {
      const plugin = smsGate(config);
      const ctx = mockContext({
        queries: {
          getCustomer: vi.fn().mockResolvedValue({ id: "c1", phone: null }),
          getSubscription: vi.fn(),
        },
      });

      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "c1",
          planName: "Pro",
          planId: "pro",
          subscriptionId: "s1",
          customerEmail: "a@b.com",
          startedAt: new Date(),
          expiresAt: null,
        },
        ctx,
      );

      expect(fetch).not.toHaveBeenCalled();
    });

    it("skips if customer not found", async () => {
      const plugin = smsGate(config);
      const ctx = mockContext({
        queries: { getCustomer: vi.fn().mockResolvedValue(null), getSubscription: vi.fn() },
      });

      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "missing",
          planName: "Pro",
          planId: "pro",
          subscriptionId: "s1",
          customerEmail: "a@b.com",
          startedAt: new Date(),
          expiresAt: null,
        },
        ctx,
      );

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("subscription.cancelled", () => {
    it("sends payment failed SMS", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const plugin = smsGate(config);
      const ctx = mockContext({
        queries: {
          getCustomer: vi.fn().mockResolvedValue({ id: "c1", phone: "+251900000001" }),
          getSubscription: vi.fn(),
        },
      });

      await plugin.onEvent!["subscription.cancelled"]!(
        {
          customerId: "c1",
          planName: "Basic",
          planId: "basic",
          subscriptionId: "s1",
          customerEmail: null,
          canceledAt: new Date(),
          endedAt: null,
        },
        ctx,
      );

      expect(sentBody("/messages").textMessage.text).toContain("payment failed");
    });
  });

  describe("subscription.expired", () => {
    it("sends expired SMS", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const plugin = smsGate(config);
      const ctx = mockContext({
        queries: {
          getCustomer: vi.fn().mockResolvedValue({ id: "c1", phone: "+251900000001" }),
          getSubscription: vi.fn(),
        },
      });

      await plugin.onEvent!["subscription.expired"]!(
        {
          customerId: "c1",
          planName: "Pro",
          planId: "pro",
          subscriptionId: "s1",
          customerEmail: null,
          expiredAt: new Date(),
        },
        ctx,
      );

      expect(sentBody("/messages").textMessage.text).toContain("expired");
    });
  });

  describe("subscription.reminder", () => {
    it("uses customerPhone from payload, not getCustomer", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const plugin = smsGate(config);
      const getCustomer = vi.fn();
      const ctx = mockContext({ queries: { getCustomer, getSubscription: vi.fn() } });

      await plugin.onEvent!["subscription.reminder"]!(
        {
          customerId: "c1",
          planName: "Pro",
          planId: "pro",
          subscriptionId: "s1",
          customerEmail: null,
          customerPhone: "+251900000001",
          expiresAt: new Date(),
          daysUntilExpiry: 3,
        },
        ctx,
      );

      expect(getCustomer).not.toHaveBeenCalled();
      const body = sentBody("/messages");
      expect(body.phoneNumbers).toEqual(["+251900000001"]);
      expect(body.textMessage.text).toContain("expires in 3 days");
    });

    it("skips if payload has no customerPhone", async () => {
      const plugin = smsGate(config);
      const ctx = mockContext();

      await plugin.onEvent!["subscription.reminder"]!(
        {
          customerId: "c1",
          planName: "Pro",
          planId: "pro",
          subscriptionId: "s1",
          customerEmail: null,
          customerPhone: null,
          expiresAt: new Date(),
          daysUntilExpiry: 3,
        },
        ctx,
      );

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("custom message templates", () => {
    it("uses custom messages from config", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const custom: SmsGateConfig = {
        ...config,
        messages: {
          paymentReceived: "Thanks {planName} subscriber!",
          paymentFailed: "Oops {planName}",
        },
      };

      const plugin = smsGate(custom);
      const ctx = mockContext({
        queries: {
          getCustomer: vi.fn().mockResolvedValue({ id: "c1", phone: "+251900000001" }),
          getSubscription: vi.fn(),
        },
      });

      await plugin.onEvent!["subscription.activated"]!(
        {
          customerId: "c1",
          planName: "Gold",
          planId: "gold",
          subscriptionId: "s1",
          customerEmail: null,
          startedAt: new Date(),
          expiresAt: null,
        },
        ctx,
      );

      expect(sentBody("/messages").textMessage.text).toBe("Thanks Gold subscriber!");
    });
  });

  describe("plugin shape", () => {
    it("has id sms-gate", () => {
      expect(smsGate(config).id).toBe("sms-gate");
    });

    it("has no lifecycle hooks (only onEvent)", () => {
      const plugin = smsGate(config);
      expect(plugin.onBeforeSubscribe).toBeUndefined();
      expect(plugin.onCheckoutReady).toBeUndefined();
      expect(plugin.onPaymentReady).toBeUndefined();
      expect(plugin.endpoints).toBeUndefined();
    });
  });
});

function sentBody(
  pathPart: string,
): { textMessage: { text: string }; phoneNumbers: string[] } & Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.find(([u]) => (u as string).includes(pathPart));
  if (!call) throw new Error(`No fetch call to ${pathPart}`);
  return JSON.parse((call[1] as RequestInit).body as string);
}

import {
  SmsGateClient,
  SmsGateAuthError,
  SmsGateDeviceError,
  SmsGateQueueError,
  SmsGateValidationError,
  type SmsGateConfig,
} from "@birrjs/sms-gate";
import { describe, it, expect, vi, beforeEach } from "vitest";

const config: SmsGateConfig = {
  username: "testuser",
  password: "testpass",
  deviceId: "dev-123",
  simNumber: 1,
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
    access_token: "jwt-token",
    refresh_token: "refresh-token",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockReset();
});

describe("SmsGateClient", () => {
  describe("auth", () => {
    it("authenticates with Basic then uses Bearer JWT", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const client = new SmsGateClient(config);
      await client.send("+251700000000", "Hello!");

      const authCall = vi
        .mocked(fetch)
        .mock.calls.find(([u]) => (u as string).includes("/auth/token"));
      expect((authCall![1] as RequestInit).headers).toMatchObject({
        Authorization: `Basic ${btoa("testuser:testpass")}`,
      });

      const msgCall = vi
        .mocked(fetch)
        .mock.calls.find(([u]) => (u as string).includes("/messages"));
      expect((msgCall![1] as RequestInit).headers).toMatchObject({
        Authorization: "Bearer jwt-token",
      });
    });

    it("throws SmsGateAuthError on 401", async () => {
      mockFetch(401, { message: "Bad credentials" });

      const client = new SmsGateClient(config);
      await expect(client.send("+251700000000", "test")).rejects.toThrow(SmsGateAuthError);
    });
  });

  describe("send()", () => {
    it("sends textMessage with phone number", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const client = new SmsGateClient(config);
      await client.send("+251700000000", "Hello world");

      const body = sentBody("/messages");
      expect(body).toMatchObject({
        textMessage: { text: "Hello world" },
        phoneNumbers: ["+251700000000"],
      });
    });

    it("includes deviceId and simNumber when configured", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const client = new SmsGateClient(config);
      await client.send("+251700000000", "test");

      const body = sentBody("/messages");
      expect(body.deviceId).toBe("dev-123");
      expect(body.simNumber).toBe(1);
    });

    it("omits optional fields when not configured", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const client = new SmsGateClient({ username: "u", password: "p" });
      await client.send("+251700000000", "test");

      const body = sentBody("/messages");
      expect(body.deviceId).toBeUndefined();
      expect(body.simNumber).toBeUndefined();
    });

    it("uses custom baseUrl", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m1", state: "Pending", recipients: [] });

      const client = new SmsGateClient({ ...config, baseUrl: "http://localhost:8080" });
      await client.send("+251700000000", "test");

      const urls = vi.mocked(fetch).mock.calls.map(([u]) => u as string);
      expect(urls.some((u) => u.startsWith("http://localhost:8080"))).toBe(true);
    });
  });

  describe("error handling", () => {
    it("retries once on 401", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(401, {});
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m2", state: "Pending", recipients: [] });

      const client = new SmsGateClient(config);
      await client.send("+251700000000", "retry");

      const sends = vi
        .mocked(fetch)
        .mock.calls.filter(([u]) => (u as string).includes("/messages"));
      expect(sends).toHaveLength(2);
    });

    it("throws SmsGateValidationError on 400", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(400, { message: "Invalid phone" });

      const client = new SmsGateClient(config);
      await expect(client.send("bad", "test")).rejects.toThrow(SmsGateValidationError);
    });

    it("throws SmsGateAuthError on 403", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(403, { message: "Scope required" });

      const client = new SmsGateClient(config);
      await expect(client.send("+251700000000", "test")).rejects.toThrow(SmsGateAuthError);
    });

    it("throws SmsGateQueueError on 503 with QueueLimitExceeded", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(503, { error: "QueueLimitExceeded", message: "too many pending" });

      const client = new SmsGateClient(config);
      await expect(client.send("+251700000000", "test")).rejects.toThrow(SmsGateQueueError);
    });

    it("throws SmsGateDeviceError on recipient failure", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, {
        id: "m3",
        recipients: [
          { phoneNumber: "+251700000000", state: "Failed", error: "SEND_SMS permission" },
        ],
      });

      const client = new SmsGateClient(config);
      await expect(client.send("+251700000000", "test")).rejects.toThrow(SmsGateDeviceError);
    });

    it("succeeds without error on Sent", async () => {
      mockFetch(201, jwtResponse());
      mockFetch(201, { id: "m4", recipients: [{ phoneNumber: "+251700000000", state: "Sent" }] });

      const client = new SmsGateClient(config);
      await expect(client.send("+251700000000", "test")).resolves.not.toThrow();
    });
  });
});

function sentBody(pathPart: string): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.find(([u]) => (u as string).includes(pathPart));
  return JSON.parse((call![1] as RequestInit).body as string);
}

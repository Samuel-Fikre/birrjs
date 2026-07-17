import { SmsGateClient, SmsGateError } from "@birrjs/sms-gate";
import { describe, it, expect, beforeAll } from "vitest";

const hasCredentials = !!(process.env.SMS_GATE_USERNAME && process.env.SMS_GATE_PASSWORD);
const testNumber = process.env.SMS_GATE_TO ?? "+251704207309";

describe.skipIf(!hasCredentials)("SMS-Gate send", () => {
  let client: SmsGateClient;

  beforeAll(() => {
    client = new SmsGateClient({
      username: process.env.SMS_GATE_USERNAME!,
      password: process.env.SMS_GATE_PASSWORD!,
      deviceId: process.env.SMS_GATE_DEVICE_ID || undefined,
    });
  });

  it("sends a real SMS and returns a message ID", async () => {
    const result = await client.send(testNumber, "Smoke test from birrjs sms-gate plugin");
    expect(result.id).toBeTruthy();
    expect(result.state).toBe("Pending");
    expect(result.recipients[0]?.state).toBe("Pending");
  }, 30_000);

  it("throws SmsGateError with wrong credentials", async () => {
    const bad = new SmsGateClient({
      username: "invalid",
      password: "invalid",
    });
    await expect(bad.send(testNumber, "should fail")).rejects.toThrow(SmsGateError);
  }, 15_000);
});

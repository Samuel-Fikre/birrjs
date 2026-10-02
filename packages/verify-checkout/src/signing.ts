import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SIGNATURE_AGE_SECONDS = 300;

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function verifyWebhookSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  const timestamp = getHeader(headers, "VerifyCheckout-Timestamp");
  const signature = getHeader(headers, "VerifyCheckout-Signature");
  if (!timestamp || !signature) return false;

  if (!/^\d{10,13}$/.test(timestamp)) return false;

  const ageSeconds = Math.abs(nowMs / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_SIGNATURE_AGE_SECONDS) return false;

  const received = signature.startsWith("v1=") ? signature.slice(3) : "";
  if (!/^[a-f0-9]{64}$/.test(received)) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  return timingSafeEqual(hexToBytes(received), hexToBytes(expected));
}

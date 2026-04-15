import type { ChapaWebhookEvent } from "./types";

/**
 * Type guard to validate Chapa webhook payload
 */
export function isChapaWebhookEvent(payload: unknown): payload is ChapaWebhookEvent {
  if (!payload || typeof payload !== "object") return false;
  const event = payload as Record<string, unknown>;
  return (
    typeof event.event === "string" &&
    typeof event.tx_ref === "string" &&
    typeof event.status === "string" &&
    typeof event.amount === "string" &&
    typeof event.currency === "string"
  );
}

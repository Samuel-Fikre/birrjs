import { VerifyEtApiError } from "./errors";
import type { VerifyEtVerifyResponse, VerifyEtStatusResponse } from "./types";

const BASE_URL = "https://verify.et";

export interface VerifyEtClient {
  verify(
    reference: string,
    options?: { waitMs?: number; subscriptionId?: string; settlementAccount?: string },
  ): Promise<VerifyEtVerifyResponse>;
  status(): Promise<VerifyEtStatusResponse>;
}

async function createIdempotencyKey(
  reference: string,
  subscriptionId?: string,
  settlementAccount?: string,
): Promise<string> {
  const parts = [reference];
  if (subscriptionId) parts.push(subscriptionId);
  if (settlementAccount) parts.push(settlementAccount);
  const data = new TextEncoder().encode(parts.join("::"));
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

export function createVerifyEtClient(config: { apiKey: string }): VerifyEtClient {
  const { apiKey } = config;

  async function request<T>(
    path: string,
    body?: unknown,
    method = "POST",
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "x-api-key": apiKey,
          ...(body ? { "content-type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        throw new VerifyEtApiError(
          (data as { message?: string })?.message ?? "Authentication failed",
          response.status,
          "invalid_api_key",
        );
      }

      if (response.status === 402) {
        const data = await response.json().catch(() => ({}));
        throw new VerifyEtApiError(
          (data as { message?: string })?.message ?? "Insufficient credits",
          response.status,
          "insufficient_credits",
        );
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new VerifyEtApiError(
          "Rate limit exceeded",
          response.status,
          "rate_limited",
          retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
        );
      }

      if (response.status >= 500) {
        throw new VerifyEtApiError(
          `Upstream error: ${response.statusText}`,
          response.status,
          "upstream_error",
        );
      }

      const data = await response.json().catch(() => ({}));
      throw new VerifyEtApiError(
        (data as { message?: string })?.message ?? `Request failed: ${response.status}`,
        response.status,
        (data as { error?: { code?: string } })?.error?.code ?? "unknown_error",
      );
    } catch (error) {
      if (error instanceof VerifyEtApiError) throw error;
      if (
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new VerifyEtApiError("Request timed out after 30s", 504, "timeout_error");
      }
      throw new VerifyEtApiError(
        error instanceof Error ? error.message : "Network error",
        0,
        "network_error",
      );
    }
  }

  return {
    async verify(reference, options) {
      const body: Record<string, unknown> = { reference };
      if (options?.settlementAccount) {
        body.settlementAccount = options.settlementAccount;
      }

      const key = await createIdempotencyKey(
        reference,
        options?.subscriptionId,
        options?.settlementAccount,
      );
      const waitMs = options?.waitMs ?? 15000;
      const path = `/api/verify?waitMs=${Math.min(waitMs, 30000)}`;

      return request<VerifyEtVerifyResponse>(path, body, "POST", { "Idempotency-Key": key });
    },

    async status() {
      return request<VerifyEtStatusResponse>("/api/uptime", undefined, "GET");
    },
  };
}

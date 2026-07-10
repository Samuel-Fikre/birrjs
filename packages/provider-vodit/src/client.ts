import { VoditApiError } from "./errors";
import type { VoditVerifyResponse, VoditStatusResponse } from "./types";

const BASE_URL = "https://v.odit.et";

export interface VoditClient {
  verify(receiptUrl: string, options?: { waitMs?: number }): Promise<VoditVerifyResponse>;
  pollResult(requestId: string): Promise<VoditVerifyResponse>;
  status(): Promise<VoditStatusResponse>;
}

export function createVoditClient(config: { apiKey: string }): VoditClient {
  const { apiKey } = config;

  async function request<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "x-api-key": apiKey,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok || response.status === 502 || response.status === 202) {
        return (await response.json()) as T;
      }

      if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        const errorCode = (data as { error?: { code?: string } })?.error?.code ?? "invalid_key";
        throw new VoditApiError(
          (data as { error?: { message?: string } })?.error?.message ?? "Authentication failed",
          response.status,
          errorCode,
        );
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new VoditApiError(
          "Rate limit exceeded",
          response.status,
          "rate_limited",
          retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
        );
      }

      if (response.status >= 500) {
        throw new VoditApiError(
          `Upstream error: ${response.statusText}`,
          response.status,
          "upstream_error",
        );
      }

      const data = await response.json().catch(() => ({}));
      throw new VoditApiError(
        (data as { error?: { message?: string } })?.error?.message ??
          `Request failed: ${response.status}`,
        response.status,
        (data as { error?: { code?: string } })?.error?.code ?? "unknown_error",
      );
    } catch (error) {
      if (error instanceof VoditApiError) throw error;
      if (
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new VoditApiError("Request timed out after 30s", 504, "network_error");
      }
      throw new VoditApiError(
        error instanceof Error ? error.message : "Network error",
        0,
        "network_error",
      );
    }
  }

  return {
    async verify(receiptUrl: string, options?: { waitMs?: number }) {
      const body: Record<string, unknown> = { url: receiptUrl };
      if (options?.waitMs != null) {
        body.waitMs = Math.min(options.waitMs, 30000);
      }
      const response = await request<VoditVerifyResponse>("/api/verify", body);

      if (response.processingStatus === "queued" && response.requestId) {
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const polled = await request<VoditVerifyResponse>(
            `/api/verify/${response.requestId}`,
            undefined,
            "GET",
          );
          if (polled.processingStatus === "completed" || polled.processingStatus === "failed") {
            return polled;
          }
        }
      }

      return response;
    },

    async pollResult(requestId: string) {
      return request<VoditVerifyResponse>(`/api/verify/${requestId}`, undefined, "GET");
    },

    async status() {
      return request<VoditStatusResponse>("/api/status", undefined, "GET");
    },
  };
}

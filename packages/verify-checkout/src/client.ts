import { VerifyCheckoutApiError } from "./errors";
import type { CreateDepositInput, ListDepositsParams, VerifyCheckoutDeposit } from "./types";
import { DEFAULT_VERIFY_CHECKOUT_BASE_URL, VERIFY_CHECKOUT_API_VERSION } from "./types";

export interface VerifyCheckoutClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface VerifyCheckoutClient {
  createDeposit: (
    input: CreateDepositInput,
    idempotencyKey: string,
  ) => Promise<VerifyCheckoutDeposit>;
  getDeposit: (depositId: string) => Promise<VerifyCheckoutDeposit>;
  listDeposits: (params?: ListDepositsParams) => Promise<VerifyCheckoutDeposit[]>;
}

type ApiEnvelope = {
  data?: unknown;
  error?: { code?: string; message?: string; retryable?: boolean };
  meta?: { requestId?: string };
};

type RequestOptions = {
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

export function createVerifyCheckoutClient(
  config: VerifyCheckoutClientConfig,
): VerifyCheckoutClient {
  const baseUrl = (config.baseUrl ?? DEFAULT_VERIFY_CHECKOUT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  async function request(path: string, options: RequestOptions): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
      "VerifyCheckout-Version": VERIFY_CHECKOUT_API_VERSION,
    };
    if (options.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers,
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      throw new VerifyCheckoutApiError(
        `Verify Checkout returned non-JSON HTTP ${response.status}`,
        response.status,
        { body: text.slice(0, 500) },
      );
    }

    const envelope: ApiEnvelope =
      typeof parsed === "object" && parsed !== null ? (parsed as ApiEnvelope) : {};

    if (!response.ok) {
      throw new VerifyCheckoutApiError(
        envelope.error?.message ?? `Verify Checkout request failed with HTTP ${response.status}`,
        response.status,
        {
          errorCode: envelope.error?.code,
          requestId: envelope.meta?.requestId,
          retryable: envelope.error?.retryable,
          body: parsed,
        },
      );
    }

    if (envelope.data === undefined || envelope.data === null) {
      throw new VerifyCheckoutApiError(
        "Verify Checkout response did not include data",
        response.status,
        { body: parsed },
      );
    }

    return envelope.data;
  }

  async function createDeposit(
    input: CreateDepositInput,
    idempotencyKey: string,
  ): Promise<VerifyCheckoutDeposit> {
    const body: Record<string, unknown> = {
      merchant_customer_id: input.merchantCustomerId,
      currency: (input.currency ?? "ETB").toUpperCase(),
      return_url: input.returnUrl,
    };
    if (input.amount !== undefined) body.amount = input.amount;
    if (input.paymentMethod !== undefined) body.payment_method = input.paymentMethod;

    const data = await request("/v1/deposits", {
      method: "POST",
      body,
      idempotencyKey,
    });
    return data as VerifyCheckoutDeposit;
  }

  async function getDeposit(depositId: string): Promise<VerifyCheckoutDeposit> {
    const data = await request(`/v1/deposits/${encodeURIComponent(depositId)}`, {
      method: "GET",
    });
    return data as VerifyCheckoutDeposit;
  }

  async function listDeposits(params: ListDepositsParams = {}): Promise<VerifyCheckoutDeposit[]> {
    const query = new URLSearchParams();
    if (params.merchantOrderId !== undefined) {
      query.set("merchant_order_id", params.merchantOrderId);
    }
    if (params.status !== undefined) query.set("status", params.status);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const queryString = query.toString();

    const data = await request(`/v1/deposits${queryString ? `?${queryString}` : ""}`, {
      method: "GET",
    });
    if (!Array.isArray(data)) {
      throw new VerifyCheckoutApiError("Verify Checkout list response was not an array", 200, {
        body: data,
      });
    }
    return data as VerifyCheckoutDeposit[];
  }

  return {
    createDeposit,
    getDeposit,
    listDeposits,
  };
}

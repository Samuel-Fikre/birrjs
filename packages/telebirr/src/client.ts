import { randomBytes, randomUUID } from "node:crypto";

import { TelebirrApiError } from "./errors";
import { signRequest } from "./signing";
import type {
  CreatedPayment,
  CreatePaymentInput,
  SignedRequest,
  TelebirrConfig,
  TelebirrResponse,
} from "./types";

export interface TelebirrClient {
  getFabricToken: () => Promise<string>;
  createPayment: (input: CreatePaymentInput) => Promise<CreatedPayment>;
  queryOrder: (merchantOrderId: string) => Promise<TelebirrResponse>;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const RETRY_BACKOFF_MS = 500;
const QUERY_CACHE_TTL_MS = 30_000;
const QUERY_CACHE_MAX_ENTRIES = 500;

function timestamp(): string {
  return Math.floor(Date.now() / 1_000).toString();
}

function nonce(): string {
  return randomBytes(16).toString("hex").toUpperCase().slice(0, 32);
}

function parseExpirationDate(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(4, 6)) - 1;
  const day = Number(dateStr.slice(6, 8));
  const hour = Number(dateStr.slice(8, 10));
  const min = Number(dateStr.slice(10, 12));
  const sec = Number(dateStr.slice(12, 14));
  return new Date(year, month, day, hour, min, sec).getTime();
}

function normalizeAmount(amount: string): string {
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    throw new TypeError("amount must be a positive decimal string with at most 2 places");
  }
  return amount;
}

function normalizeMerchantOrderId(merchantOrderId: string): string {
  if (!/^[A-Za-z0-9]+$/.test(merchantOrderId)) {
    throw new TypeError(
      "merchantOrderId must contain only ASCII letters and digits (Telebirr rejects underscores and hyphens)",
    );
  }
  return merchantOrderId;
}

export function isSuccessfulPayment(response: TelebirrResponse): boolean {
  const status = response.biz_content?.order_status ?? response.biz_content?.trade_status;
  return response.result === "SUCCESS" && (status === "PAY_SUCCESS" || status === "Completed");
}

export function createTelebirrClient(config: TelebirrConfig): TelebirrClient {
  const resolvedConfig = { ...config, timeoutMs: config.timeoutMs ?? 30_000 };
  let tokenCache: TokenCache | null = null;
  let tokenInFlight: Promise<TokenCache> | null = null;
  const queryCache = new Map<string, { response: TelebirrResponse; expiresAt: number }>();

  async function post(
    path: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<TelebirrResponse> {
    const response = await fetch(
      `${resolvedConfig.gatewayUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(resolvedConfig.timeoutMs),
      },
    );

    if (response.status === 401) {
      tokenCache = null;
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new TelebirrApiError(
        `Telebirr returned non-JSON HTTP ${response.status}`,
        response.status,
        text.slice(0, 500),
      );
    }

    if (!response.ok || typeof body !== "object" || body === null) {
      throw new TelebirrApiError(
        `Telebirr request failed with HTTP ${response.status}`,
        response.status,
        body,
      );
    }

    return body as TelebirrResponse;
  }

  function isTransientError(error: unknown): boolean {
    if (error instanceof TelebirrApiError) return error.statusCode >= 500;
    if (error instanceof Error) {
      return error.name === "TimeoutError" || error.name === "TypeError";
    }
    return false;
  }

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
      return await fn();
    }
  }

  function fetchToken(): Promise<TokenCache> {
    return withRetry(async () => {
      const response = await post(
        "payment/v1/token",
        { appSecret: resolvedConfig.appSecret },
        { "X-APP-Key": resolvedConfig.fabricAppId },
      );

      const token = response.token;
      if (typeof token !== "string" || token.length === 0) {
        throw new TelebirrApiError("Token response did not include token", 200, response);
      }

      // Use expirationDate from response if available, fallback to 50 minutes
      const expiresAt = response.expirationDate
        ? parseExpirationDate(response.expirationDate)
        : Date.now() + 50 * 60 * 1_000;

      return { token, expiresAt };
    });
  }

  async function getFabricToken(): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
      return tokenCache.token;
    }

    // Single-flight: concurrent callers share one token fetch
    if (!tokenInFlight) {
      tokenInFlight = fetchToken().then(
        (cache) => {
          tokenCache = cache;
          tokenInFlight = null;
          return cache;
        },
        (error: unknown) => {
          tokenInFlight = null;
          throw error;
        },
      );
    }

    const cache = await tokenInFlight;
    return cache.token;
  }

  function signedRequest(method: string, bizContent: SignedRequest["biz_content"]): SignedRequest {
    const request: SignedRequest = {
      nonce_str: nonce(),
      method,
      timestamp: timestamp(),
      version: "1.0",
      biz_content: bizContent,
      sign_type: "SHA256WithRSA",
    };
    request.sign = signRequest(
      request as unknown as Record<string, unknown>,
      resolvedConfig.privateKeyPem,
    );
    return request;
  }

  async function createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const merchantOrderId = normalizeMerchantOrderId(
      input.merchantOrderId ?? randomUUID().replaceAll("-", ""),
    );

    const request = signedRequest("payment.preorder", {
      notify_url: resolvedConfig.notifyUrl,
      appid: resolvedConfig.merchantAppId,
      merch_code: resolvedConfig.merchantCode,
      merch_order_id: merchantOrderId,
      trade_type: "Checkout",
      title: input.title,
      total_amount: normalizeAmount(input.amount),
      trans_currency: "ETB",
      timeout_express: "120m",
      business_type: "BuyGoods",
      payee_identifier: resolvedConfig.merchantCode,
      payee_identifier_type: "04",
      payee_type: "5000",
      redirect_url: resolvedConfig.redirectUrl,
      callback_info: "web-checkout",
    });

    const token = await getFabricToken();
    const response = await post(
      "payment/v1/merchant/preOrder",
      request as unknown as Record<string, unknown>,
      {
        "X-APP-Key": resolvedConfig.fabricAppId,
        Authorization: token,
      },
    );

    const prepayId = response.biz_content?.prepay_id;
    if (typeof prepayId !== "string" || prepayId.length === 0) {
      throw new TelebirrApiError("Pre-order response did not include prepay_id", 200, response);
    }

    return {
      merchantOrderId,
      prepayId,
      checkoutUrl: buildCheckoutUrl(prepayId),
    };
  }

  function buildCheckoutUrl(prepayId: string): string {
    const signed = {
      appid: resolvedConfig.merchantAppId,
      merch_code: resolvedConfig.merchantCode,
      nonce_str: nonce(),
      prepay_id: prepayId,
      timestamp: timestamp(),
    };
    const url = new URL(resolvedConfig.checkoutUrl);
    const query = {
      ...signed,
      sign: signRequest(signed, resolvedConfig.privateKeyPem),
      sign_type: "SHA256WithRSA",
      version: "1.0",
      trade_type: "Checkout",
    };
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async function queryOrder(merchantOrderId: string): Promise<TelebirrResponse> {
    const cached = queryCache.get(merchantOrderId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.response;
    }

    const request = signedRequest("payment.queryorder", {
      appid: resolvedConfig.merchantAppId,
      merch_code: resolvedConfig.merchantCode,
      merch_order_id: merchantOrderId,
    });
    const token = await getFabricToken();
    const response = await withRetry(() =>
      post("payment/v1/merchant/queryOrder", request as unknown as Record<string, unknown>, {
        "X-APP-Key": resolvedConfig.fabricAppId,
        Authorization: token,
      }),
    );

    // Cache only terminal success — a pending/failed answer must not go stale,
    // or a real payment landing within 30s would read as "still pending"
    if (isSuccessfulPayment(response)) {
      if (queryCache.size >= QUERY_CACHE_MAX_ENTRIES) {
        const oldest = queryCache.keys().next().value;
        if (oldest !== undefined) queryCache.delete(oldest);
      }
      queryCache.set(merchantOrderId, {
        response,
        expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
      });
    }

    return response;
  }

  return {
    getFabricToken,
    createPayment,
    queryOrder,
  };
}

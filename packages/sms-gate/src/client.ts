import type { SmsGateConfig } from "./types";

const DEFAULT_BASE_URL = "https://api.sms-gate.app";

interface TokenResponse {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface SendResponse {
  id: string;
  deviceId: string;
  state: string;
  recipients: Array<{
    phoneNumber: string;
    state: string;
    error?: string;
  }>;
}

export class SmsGateError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly details?: string,
  ) {
    super(message);
    this.name = "SmsGateError";
  }
}

export class SmsGateAuthError extends SmsGateError {
  constructor(message: string, status?: number) {
    super(message, "AUTH_ERROR", status);
    this.name = "SmsGateAuthError";
  }
}

export class SmsGateDeviceError extends SmsGateError {
  constructor(
    message: string,
    public readonly phoneNumber: string,
    public readonly deviceError: string,
    status?: number,
  ) {
    super(message, "DEVICE_ERROR", status, deviceError);
    this.name = "SmsGateDeviceError";
  }
}

export class SmsGateQueueError extends SmsGateError {
  constructor(message: string) {
    super(message, "QUEUE_LIMIT_EXCEEDED", 503);
    this.name = "SmsGateQueueError";
  }
}

export class SmsGateValidationError extends SmsGateError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "SmsGateValidationError";
  }
}

export class SmsGateClient {
  private config: SmsGateConfig;
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(config: SmsGateConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async send(to: string, message: string, retried?: boolean): Promise<SendResponse> {
    await this.ensureToken();

    const body: Record<string, unknown> = {
      textMessage: { text: message },
      phoneNumbers: [to],
    };
    if (this.config.deviceId) body.deviceId = this.config.deviceId;
    if (this.config.simNumber) body.simNumber = this.config.simNumber;

    const response = await fetch(`${this.baseUrl}/3rdparty/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      if (retried) {
        this.accessToken = null;
        throw new SmsGateAuthError("Authentication failed after retry", 401);
      }
      this.accessToken = null;
      await this.ensureToken();
      return this.send(to, message, true);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw parseError(response.status, text);
    }

    const data = (await response.json()) as SendResponse;

    for (const recipient of data.recipients) {
      if (recipient.state === "Failed" && recipient.error) {
        throw new SmsGateDeviceError(
          `SMS to ${recipient.phoneNumber} failed: ${recipient.error}`,
          recipient.phoneNumber,
          recipient.error,
        );
      }
    }

    return data;
  }

  private async ensureToken(): Promise<void> {
    if (this.accessToken && this.tokenExpiresAt) {
      const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
      if (this.tokenExpiresAt > fiveMinutesFromNow) return;
    }

    if (this.refreshToken) {
      try {
        await this.refresh();
        return;
      } catch {
        this.refreshToken = null;
      }
    }

    await this.authenticate();
  }

  private async authenticate(): Promise<void> {
    const credentials = btoa(`${this.config.username}:${this.config.password}`);
    const response = await fetch(`${this.baseUrl}/3rdparty/v1/auth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl: 86400,
        scopes: ["messages:send"],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      if (response.status === 401) {
        throw new SmsGateAuthError("Invalid SMS-Gate credentials", 401);
      }
      throw new SmsGateAuthError(
        `Authentication failed (${response.status}): ${text}`,
        response.status,
      );
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = new Date(data.expires_at);
  }

  private async refresh(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/3rdparty/v1/auth/token/refresh`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.refreshToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) throw new SmsGateAuthError("Token refresh failed", response.status);

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = new Date(data.expires_at);
  }
}

function parseError(status: number, body: string): SmsGateError {
  let parsed: { error?: string; message?: string } = {};
  try {
    parsed = JSON.parse(body);
  } catch {}

  if (parsed.error === "QueueLimitExceeded") {
    return new SmsGateQueueError(parsed.message ?? "Device queue limit exceeded");
  }

  switch (status) {
    case 400:
      return new SmsGateValidationError(parsed.message ?? "Invalid request");
    case 401:
      return new SmsGateAuthError(parsed.message ?? "Unauthorized", 401);
    case 403:
      return new SmsGateAuthError(
        parsed.message ?? "Scope required - token lacks messages:send scope",
        403,
      );
    case 503:
      return new SmsGateQueueError(parsed.message ?? "Service unavailable");
    default:
      return new SmsGateError(parsed.message ?? `API error (${status})`, "API_ERROR", status, body);
  }
}

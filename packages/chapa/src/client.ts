import type {
  ChapaTransactionRequest,
  ChapaTransactionResponse,
  ChapaVerifyResponse,
} from "./types";
import type { PaymentProviderConfig } from "@birrjs/core";
import { ChapaApiError } from "./errors";

const CHAPA_API_BASE_URL = "https://api.chapa.co/v1";

export interface ChapaClient {
  initializeTransaction: (data: ChapaTransactionRequest) => Promise<ChapaTransactionResponse>;
  verifyTransaction: (txRef: string) => Promise<ChapaVerifyResponse>;
}

export function createChapaClient(config: PaymentProviderConfig): ChapaClient {
  const headers = {
    Authorization: `Bearer ${config.secretKey}`,
    "Content-Type": "application/json",
  };

  return {
    async initializeTransaction(data: ChapaTransactionRequest): Promise<ChapaTransactionResponse> {
      const response = await fetch(`${CHAPA_API_BASE_URL}/transaction/initialize`, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorBody: unknown;
        try {
          errorBody = JSON.parse(errorText);
        } catch {
          errorBody = errorText;
        }
        throw new ChapaApiError(
          `Chapa API error: ${response.status} - ${errorText}`,
          response.status,
          errorBody,
        );
      }

      const result = (await response.json()) as ChapaTransactionResponse;
      return result;
    },

    async verifyTransaction(txRef: string): Promise<ChapaVerifyResponse> {
      const response = await fetch(`${CHAPA_API_BASE_URL}/transaction/verify/${txRef}`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorBody: unknown;
        try {
          errorBody = JSON.parse(errorText);
        } catch {
          errorBody = errorText;
        }
        throw new ChapaApiError(
          `Chapa API error: ${response.status} - ${errorText}`,
          response.status,
          errorBody,
        );
      }

      const result = (await response.json()) as ChapaVerifyResponse;
      return result;
    },
  };
}

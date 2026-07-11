import { APIError } from "better-call/error";

type UpperLetter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";

type IsValidUpperSnakeCase<S extends string> = S extends `${infer F}${infer R}`
  ? F extends UpperLetter | "_"
    ? IsValidUpperSnakeCase<R>
    : false
  : true;

type InvalidKeyError<K extends string> =
  `Invalid error code key: "${K}" — must only contain uppercase letters (A-Z) and underscores (_)`;

type ValidateErrorCodes<T> = {
  [K in keyof T]: K extends string
    ? IsValidUpperSnakeCase<K> extends false
      ? InvalidKeyError<K>
      : T[K]
    : T[K];
};

export type RawError<K extends string = string> = {
  readonly code: K;
  message: string;
};

export function defineErrorCodes<
  const T extends Record<string, string>,
  R extends {
    [K in keyof T & string]: RawError<K>;
  },
>(codes: ValidateErrorCodes<T>): R {
  return Object.fromEntries(
    Object.entries(codes).map(([key, value]) => [
      key,
      {
        code: key,
        message: value,
        toString: () => key,
      },
    ]),
  ) as R;
}

export const BIRRJS_ERROR_CODES = defineErrorCodes({
  CUSTOMER_NOT_FOUND: "Customer not found",
  CUSTOMER_CREATE_FAILED: "Failed to create customer",
  CUSTOMER_UPDATE_FAILED: "Failed to update customer",

  PLAN_NOT_FOUND: "Plan not found",
  PLAN_CREATE_FAILED: "Failed to create plan",

  SUBSCRIPTION_CREATE_FAILED: "Failed to create subscription",
  SUBSCRIPTION_NOT_FOUND: "Subscription not found",
  SUBSCRIPTION_CANCEL_FAILED: "Failed to cancel subscription",

  PROVIDER_REQUIRED: "A provider is required",
  PROVIDER_TRANSACTION_FAILED: "Provider transaction failed",
  PROVIDER_VERIFICATION_FAILED: "Provider verification failed",
  PROVIDER_WEBHOOK_INVALID: "Provider webhook payload is invalid",
  TRANSACTION_INVALID_RESPONSE: "Provider returned invalid transaction response",
  RECEIPT_VERIFICATION_FAILED: "Receipt verification failed",
  RECEIPT_AMOUNT_MISMATCH: "Receipt amount is less than plan price",
  DUPLICATE_RECEIPT: "This receipt has already been used to activate a subscription",

  DATABASE_ERROR: "Database error",
  INVALID_INPUT: "Invalid input",
  IDENTIFY_REQUIRED: "Customer identification required",
  CUSTOMER_ID_MISMATCH: "Customer ID mismatch",
});

export type BirrJSErrorCode = keyof typeof BIRRJS_ERROR_CODES;

type APIErrorStatus = ConstructorParameters<typeof APIError>[0];

export class BirrJSError extends APIError {
  code: string;

  constructor(status: APIErrorStatus, error: RawError, message?: string) {
    super(status, {
      message: message ?? error.message,
      code: error.code,
    });
    this.code = error.code;
    this.name = "BirrJSError";
  }

  static from(status: APIErrorStatus, error: RawError, message?: string) {
    return new BirrJSError(status, error, message);
  }
}

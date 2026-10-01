import { constants, createSign, createVerify } from "node:crypto";

import type { Scalar } from "./types";

const EXCLUDED_KEYS = new Set([
  "sign",
  "sign_type",
  "header",
  "refund_info",
  "openType",
  "raw_request",
]);

type Signable = Record<string, unknown>;

function scalarPair(key: string, value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new TypeError(`Telebirr signing field ${key} must be a scalar`);
  }

  return `${key}=${String(value satisfies Scalar)}`;
}

export function canonicalizeRequest(request: Signable): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(request)) {
    if (EXCLUDED_KEYS.has(key) || value === undefined || value === null) continue;

    if (key === "biz_content") {
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("biz_content must be an object");
      }

      for (const [businessKey, businessValue] of Object.entries(value)) {
        pairs.push(scalarPair(businessKey, businessValue));
      }
      continue;
    }

    pairs.push(scalarPair(key, value));
  }

  return pairs.sort().join("&");
}

export function signRequest(request: Signable, privateKeyPem: string): string {
  const signer = createSign("sha256");
  signer.update(canonicalizeRequest(request), "utf8");
  signer.end();

  return signer
    .sign({
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
    .toString("base64");
}

export function verifyRequestSignature(
  request: Signable,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  const verifier = createVerify("sha256");
  verifier.update(canonicalizeRequest(request), "utf8");
  verifier.end();

  return verifier.verify(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    },
    Buffer.from(signatureBase64, "base64"),
  );
}

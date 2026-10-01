import { createPrivateKey } from "node:crypto";

import { TELEBIRR_ERROR_CODES, TelebirrError } from "./errors";

function exportPkcs8Pem(key: ReturnType<typeof createPrivateKey>): string {
  return key.export({ format: "pem", type: "pkcs8" }).toString();
}

export function normalizePrivateKey(value: string): string {
  const normalizedNewlines = value.trim().replace(/\\n/g, "\n");
  const header = normalizedNewlines.match(/-----BEGIN (RSA )?PRIVATE KEY-----/);

  if (header) {
    const label = header[1] ? "RSA PRIVATE KEY" : "PRIVATE KEY";
    const footer = `-----END ${label}-----`;
    const footerIndex = normalizedNewlines.indexOf(footer);
    if (footerIndex === -1) {
      throw new TelebirrError(
        `Private key is missing ${footer}`,
        TELEBIRR_ERROR_CODES.INVALID_PRIVATE_KEY,
      );
    }

    const body = normalizedNewlines
      .slice((header.index ?? 0) + header[0].length, footerIndex)
      .replace(/\s+/g, "");
    const lines = body.match(/.{1,64}/g)?.join("\n") ?? "";
    const pem = `${header[0]}\n${lines}\n${footer}\n`;

    try {
      return exportPkcs8Pem(createPrivateKey(pem));
    } catch (cause) {
      const error = new TelebirrError(
        "Unable to decode the PEM private key",
        TELEBIRR_ERROR_CODES.INVALID_PRIVATE_KEY,
      );
      error.cause = cause;
      throw error;
    }
  }

  const compact = normalizedNewlines.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new TelebirrError(
      "Private key must be PEM or base64-encoded DER",
      TELEBIRR_ERROR_CODES.INVALID_PRIVATE_KEY,
    );
  }

  const der = Buffer.from(compact, "base64");
  for (const type of ["pkcs8", "pkcs1"] as const) {
    try {
      return exportPkcs8Pem(createPrivateKey({ key: der, format: "der", type }));
    } catch {
      // Try the other common RSA private-key container.
    }
  }

  throw new TelebirrError(
    "Unable to decode the base64 DER private key as PKCS#8 or PKCS#1",
    TELEBIRR_ERROR_CODES.INVALID_PRIVATE_KEY,
  );
}

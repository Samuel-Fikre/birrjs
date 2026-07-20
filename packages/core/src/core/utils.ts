import { customAlphabet } from "nanoid";

const randomId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24,
);

export function generateId(prefix: string): string {
  if (!prefix) throw new TypeError("prefix is required");
  return `${prefix}_${randomId()}`;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `251${digits.slice(1)}`;
  return digits;
}

export function normalizeEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex === -1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  const stripped = local.split("+")[0]!;
  return `${stripped}${domain}`.toLowerCase();
}

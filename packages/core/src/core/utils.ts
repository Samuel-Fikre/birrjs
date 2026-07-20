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
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const stripped = local.split("+")[0]!;
  return `${stripped}${domain}`;
}

import { customAlphabet } from "nanoid";

const randomId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24,
);

export function generateId(prefix: string): string {
  if (!prefix) throw new TypeError("prefix is required");
  return `${prefix}_${randomId()}`;
}

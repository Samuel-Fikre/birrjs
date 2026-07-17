export const DEFAULT_PAYMENT_RECEIVED = "Your payment has been received. Thank you!";
export const DEFAULT_PAYMENT_FAILED = "Your payment failed. Please update your payment method.";
export const DEFAULT_SUBSCRIPTION_EXPIRED =
  "Your subscription has expired. Renew now to continue access.";
export const DEFAULT_SUBSCRIPTION_REMINDER =
  "Reminder: your subscription expires in {daysUntil} days. Renew now!";

export function formatMessage(
  template: string | undefined,
  fallback: string,
  vars: Record<string, string>,
): string {
  const tpl = template ?? fallback;
  return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

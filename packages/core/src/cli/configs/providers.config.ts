export const PROVIDERS = [
  {
    id: "chapa",
    name: "Chapa",
    package: "@birrjs/chapa",
    importName: "chapa",
    envVars: [
      { key: "DATABASE_URL", line: "DATABASE_URL=" },
      { key: "CHAPA_SECRET_KEY", line: "CHAPA_SECRET_KEY=" },
      { key: "CHAPA_WEBHOOK_SECRET", line: "CHAPA_WEBHOOK_SECRET=" },
      { key: "CALLBACK_URL", line: "CALLBACK_URL=" },
      { key: "RETURN_URL", line: "RETURN_URL=" },
    ],
    generateConfig(): string {
      return `chapa({
      secretKey: process.env.CHAPA_SECRET_KEY!,
      webhookSecret: process.env.CHAPA_WEBHOOK_SECRET!,
      callbackUrl: process.env.CALLBACK_URL!,
      returnUrl: process.env.RETURN_URL!,
    })`;
    },
  },
  {
    id: "vodit",
    name: "Vodit (receipt verification)",
    package: "@birrjs/vodit",
    importName: "vodit",
    envVars: [
      { key: "DATABASE_URL", line: "DATABASE_URL=" },
      { key: "VODIT_API_KEY", line: "VODIT_API_KEY=" },
    ],
    generateConfig(): string {
      return `vodit({
      apiKey: process.env.VODIT_API_KEY!,
      channels: [
        { type: "telebirr", value: "+251911111111", name: "My Account" },
        // TODO: configure your payment channels
        // type: "telebirr" | "cbe" | "awash"
      ],
    })`;
    },
  },
  {
    id: "verifyet",
    name: "Verify.et (transaction verification)",
    package: "@birrjs/verifyet",
    importName: "verifyEt",
    envVars: [
      { key: "DATABASE_URL", line: "DATABASE_URL=" },
      { key: "VERIFY_ET_API_KEY", line: "VERIFY_ET_API_KEY=" },
    ],
    generateConfig(): string {
      return `verifyEt({
      apiKey: process.env.VERIFY_ET_API_KEY!,
      channels: [
        { type: "cbe", value: "1000200030004000", name: "My Account" },
        { type: "telebirr", value: "0912345678", name: "My Account" },
        // TODO: configure your payment channels
        // type: "telebirr" | "cbe" | "mpesa" | "dashen" | "boa" | "cbebirr" | "awash" | "siinqee" | "kaafiebirr"
      ],
    })`;
    },
  },
  {
    id: "telebirr",
    name: "Telebirr",
    package: "@birrjs/telebirr",
    importName: "telebirr",
    envVars: [
      { key: "DATABASE_URL", line: "DATABASE_URL=" },
      { key: "TELEBIRR_GATEWAY_URL", line: "TELEBIRR_GATEWAY_URL=" },
      { key: "TELEBIRR_CHECKOUT_URL", line: "TELEBIRR_CHECKOUT_URL=" },
      { key: "TELEBIRR_FABRIC_APP_ID", line: "TELEBIRR_FABRIC_APP_ID=" },
      { key: "TELEBIRR_APP_SECRET", line: "TELEBIRR_APP_SECRET=" },
      { key: "TELEBIRR_MERCHANT_APP_ID", line: "TELEBIRR_MERCHANT_APP_ID=" },
      { key: "TELEBIRR_MERCHANT_CODE", line: "TELEBIRR_MERCHANT_CODE=" },
      { key: "TELEBIRR_PRIVATE_KEY", line: "TELEBIRR_PRIVATE_KEY=" },
      { key: "TELEBIRR_NOTIFY_URL", line: "TELEBIRR_NOTIFY_URL=" },
      { key: "TELEBIRR_REDIRECT_URL", line: "TELEBIRR_REDIRECT_URL=" },
      { key: "TELEBIRR_PUBLIC_KEY", line: "TELEBIRR_PUBLIC_KEY=" },
    ],
    generateConfig(): string {
      return `telebirr({
      gatewayUrl: process.env.TELEBIRR_GATEWAY_URL!,
      checkoutUrl: process.env.TELEBIRR_CHECKOUT_URL!,
      fabricAppId: process.env.TELEBIRR_FABRIC_APP_ID!,
      appSecret: process.env.TELEBIRR_APP_SECRET!,
      merchantAppId: process.env.TELEBIRR_MERCHANT_APP_ID!,
      merchantCode: process.env.TELEBIRR_MERCHANT_CODE!,
      privateKeyPem: process.env.TELEBIRR_PRIVATE_KEY!,
      notifyUrl: process.env.TELEBIRR_NOTIFY_URL!,
      redirectUrl: process.env.TELEBIRR_REDIRECT_URL!,
      telebirrPublicKeyPem: process.env.TELEBIRR_PUBLIC_KEY || undefined,
    })`;
    },
  },
] as const satisfies {
  id: string;
  name: string;
  package: string;
  importName: string;
  envVars: { key: string; line: string }[];
  generateConfig: () => string;
}[];

export type Provider = (typeof PROVIDERS)[number];

export function getProviderById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

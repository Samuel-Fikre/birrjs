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

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/chapa/vitest.config.ts",
      "packages/provider-vodit/vitest.config.ts",
      "packages/sms-afromessage/vitest.config.ts",
      "packages/sms-gate/vitest.config.ts",
      "packages/email-resend/vitest.config.ts",
      "packages/trial/vitest.config.ts",
      "packages/fingerprint/vitest.config.ts",
      "e2e/smoke/vitest.config.ts",
      "e2e/cli/vitest.config.ts",
    ],
  },
});

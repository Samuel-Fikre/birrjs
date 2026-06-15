import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/chapa/vitest.config.ts",
      "packages/sms-afromessage/vitest.config.ts",
      "packages/email-resend/vitest.config.ts",
      "e2e/smoke/vitest.config.ts",
      "e2e/cli/vitest.config.ts",
    ],
  },
});

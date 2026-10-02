import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "verify-checkout",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});

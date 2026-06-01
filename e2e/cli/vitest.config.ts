import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["cli/**/*.test.ts"],
    env: { NODE_ENV: "production" },
    testTimeout: 120_000,
    hookTimeout: 60_000,
    sequence: { concurrent: false },
  },
});

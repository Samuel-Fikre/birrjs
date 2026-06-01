import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["smoke/**/*.test.ts"],
    env: { NODE_ENV: "production" },
    envDir: resolve(__dirname, "../../"),
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    testTimeout: 600_000,
    hookTimeout: 180_000,
  },
});

import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: resolve(__dirname, "../../"),
  test: {
    name: "e2e",

    env: { NODE_ENV: "production" },
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    testTimeout: 600_000,
    hookTimeout: 180_000,
  },
});

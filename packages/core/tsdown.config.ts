import { defineConfig } from "tsdown";

import { createPackageTsdownConfig } from "../../tsdown.base.ts";

export default defineConfig(
  createPackageTsdownConfig({
    copy: [
      {
        flatten: false,
        from: "src/database/migrations/**/*",
      },
    ],
    entry: {
      index: "src/index.ts",
      "cli/index": "src/cli/index.ts",
      "handlers/next": "src/handlers/next.ts",
      "client/index": "src/client/index.ts",
    },
  }),
);

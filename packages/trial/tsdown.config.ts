import { defineConfig } from "tsdown";

import { createPackageTsdownConfig } from "../../tsdown.base.ts";

export default defineConfig(
  createPackageTsdownConfig({
    entry: {
      index: "src/index.ts",
    },
  }),
);

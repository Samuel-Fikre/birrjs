import { createEnv } from "@t3-oss/env-nextjs";

export const env = createEnv({
  client: {},
  runtimeEnv: {},
  emptyStringAsUndefined: true,
});

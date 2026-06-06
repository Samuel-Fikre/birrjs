import { createBirrJSClient } from "@birrjs/core/client";

import type { birrjs } from "./birrjs";

export const client = createBirrJSClient<typeof birrjs>();

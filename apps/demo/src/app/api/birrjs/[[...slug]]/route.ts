import { birrHandler } from "@birrjs/core";

import { birrjs } from "@/lib/birrjs";

export const { GET, POST } = birrHandler(birrjs);

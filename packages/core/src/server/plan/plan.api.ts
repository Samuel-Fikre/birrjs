import { desc, count } from "drizzle-orm";
import * as z from "zod";

import { defineBirrJSMethod } from "../../api/endpoint";
import { plan } from "../../database/schema";

/**
 * List plans
 */
export const listPlans = defineBirrJSMethod(
  {
    input: z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
    route: {
      method: "GET",
      path: "/list-plans",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const { limit = 20, offset = 0 } = ctx.input;
    // Run count and plans queries in parallel
    const [[totalResult], plans] = await Promise.all([
      database.select({ count: count() }).from(plan),
      database.query.plan.findMany({
        orderBy: [desc(plan.version)],
        limit,
        offset,
      }),
    ]);
    const total = totalResult?.count ?? 0;

    return {
      plans,
      total,
      limit,
      offset,
    };
  },
);

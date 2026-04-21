import type { Plan } from "../../types/models";
import { defineBirrJSMethod } from "../../api/endpoint";
import { plan } from "../../database/schema";
import { desc, count } from "drizzle-orm";
import * as z from "zod";

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
    const { limit = 20, offset = 0 } = ctx.input as { limit?: number; offset?: number };

    const plans = await database
      .select()
      .from(plan)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(plan.createdAt));

    const totalResult = await database.select({ value: count() }).from(plan);
    const total = totalResult[0]?.value || 0;

    return {
      plans: plans as Plan[],
      total,
      limit,
      offset,
    };
  },
);

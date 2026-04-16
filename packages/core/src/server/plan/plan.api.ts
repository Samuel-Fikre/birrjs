import type { Plan } from "../../types/models";
import { defineBirrJSMethod } from "../../api/endpoint";
import { plan } from "../../database/schema";

/**
 * List plans
 */
export const listPlans = defineBirrJSMethod(
  {
    route: {
      method: "GET",
      path: "/plans",
    },
  },
  async (ctx) => {
    const { database } = ctx.birrjs;
    const plans = await database.select().from(plan);
    return {
      plans: plans as Plan[],
      total: plans.length,
    };
  },
);

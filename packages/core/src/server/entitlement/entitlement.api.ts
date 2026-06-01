import { z } from "zod";

import { defineBirrJSMethod } from "../../api/endpoint";
import { checkEntitlement, reportEntitlement } from "../../entitlement";

const entitlementCheckSchema = z.object({
  featureId: z.string(),
  required: z.number().positive().optional(),
});

const entitlementReportSchema = z.object({
  featureId: z.string(),
  amount: z.number().positive().optional(),
});

export const check = defineBirrJSMethod(
  {
    input: entitlementCheckSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/check-entitlement",
    },
  },
  async (ctx) =>
    checkEntitlement(ctx.birrjs.database, {
      customerId: ctx.customer.id,
      featureId: ctx.input.featureId,
      now: new Date(),
      required: ctx.input.required,
    }),
);

export const report = defineBirrJSMethod(
  {
    input: entitlementReportSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/report-entitlement",
    },
  },
  async (ctx) =>
    reportEntitlement(ctx.birrjs.database, {
      amount: ctx.input.amount,
      customerId: ctx.customer.id,
      featureId: ctx.input.featureId,
      now: new Date(),
    }),
);

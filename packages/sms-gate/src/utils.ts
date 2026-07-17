import type { BirrJSContext } from "@birrjs/core";

export async function getPhone(
  customerId: string,
  ctx: BirrJSContext,
): Promise<string | undefined> {
  const customer = await ctx.queries.getCustomer(customerId);
  return customer?.phone ?? undefined;
}

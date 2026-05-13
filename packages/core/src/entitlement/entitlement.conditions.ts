import { sql } from "drizzle-orm";

import { subscription } from "../database/schema";

export const activeSubscriptionCondition = sql`
  ${subscription.status} in ('active', 'trialing')
  and (${subscription.endedAt} is null or ${subscription.endedAt} > now())
`;

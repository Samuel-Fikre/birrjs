import { feature, plan } from "@birrjs/core";

const storage = feature({ id: "storage", type: "metered" });
const apiCalls = feature({ id: "api_calls", type: "metered" });
const advancedReports = feature({ id: "advanced_reports", type: "boolean" });

export const free = plan({
  id: "free",
  name: "Free",
  group: "tier",
  default: true,
  includes: [storage({ limit: 100, reset: "month" }), apiCalls({ limit: 1000, reset: "month" })],
});

export const pro = plan({
  id: "pro",
  name: "Pro",
  group: "tier",
  price: { amount: 1500, interval: "monthly" },
  includes: [
    storage({ limit: 5000, reset: "month" }),
    apiCalls({ limit: 50000, reset: "month" }),
    advancedReports(),
  ],
});

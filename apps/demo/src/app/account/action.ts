"use server";

import { auth } from "@demo/auth";
import { headers } from "next/headers";

import { birrjs } from "@/lib/birrjs";

export async function generateReport() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");

  // 1. CHECK guard before acting
  const { allowed } = await birrjs.check({
    featureId: "api_calls",
    required: 100,
    customerId: session.user.id,
  });

  if (!allowed) {
    return { success: false, error: "API call limit reached" };
  }

  // 2. ACT simulate generating a report
  await new Promise((r) => setTimeout(r, 500));

  // 3. REPORT deduct only after work succeeds
  await birrjs.report({
    featureId: "api_calls",
    amount: 100,
    customerId: session.user.id,
  });

  return { success: true };
}

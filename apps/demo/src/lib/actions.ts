"use server";

import { customer } from "@birrjs/core";
import { auth } from "@demo/auth";
import { headers } from "next/headers";

import { birrjs } from "@/lib/birrjs";

export async function setPhone(phone: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");

  const ctx = await birrjs.$context;
  await ctx.database
    .insert(customer)
    .values({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      phone,
    })
    .onConflictDoUpdate({
      target: customer.id,
      set: { phone },
    });

  return { success: true };
}

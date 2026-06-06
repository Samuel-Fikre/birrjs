import { auth } from "@demo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CustomerCard } from "@/components/customer-card";
import { EntitlementsCard } from "@/components/entitlements-card";

export default async function AccountPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">Account</h1>
      <p className="mt-1 text-muted-foreground">Manage your subscription and account details</p>
      <CustomerCard
        customerId={session.user.id}
        name={session.user.name ?? undefined}
        email={session.user.email}
      />
      <EntitlementsCard customerId="session.user.id" />
    </div>
  );
}

import { auth } from "@demo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-1 text-muted-foreground">Welcome, {session.user.name}</p>
      <section className="mt-8 rounded-lg border p-6">
        <h2 className="text-lg font-medium">Subscriptions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No subscriptions yet. View available plans to get started.
        </p>
      </section>
    </div>
  );
}

"use client";

import { Button } from "@demo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@demo/ui/components/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { client } from "@/lib/birrjs-client";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
  expired: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100",
  canceled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
};

export function CustomerCard({
  customerId,
  name,
  email,
}: {
  customerId: string;
  name?: string;
  email?: string;
}) {
  const queryClient = useQueryClient();
  const { data: subsData, isLoading } = useQuery({
    queryKey: ["subscriptions", customerId],
    queryFn: () => client.listSubscriptions({ limit: 10, offset: 0 }),
  });
  const { data: plansData } = useQuery({
    queryKey: ["plans"],
    queryFn: () => client.listPlans({ limit: 20, offset: 0 }),
  });

  if (isLoading) {
    return <div className="mt-8">Loading...</div>;
  }

  const planMap = new Map(
    (plansData?.plans ?? []).map((p: { internalId: string; name: string }) => [
      p.internalId,
      p.name,
    ]),
  );
  const subscriptions = (subsData?.subscriptions ?? []).filter(
    (s: { status: string }) => s.status !== "failed",
  );

  return (
    <div className="mt-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{name ?? "Customer"}</CardTitle>
          <CardDescription>
            {email && <span>{email}</span>}
            {email && <br />}
            <span className="text-xs text-muted-foreground">ID: {customerId}</span>
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
          <CardDescription>
            {subscriptions.length === 0
              ? "No subscriptions yet"
              : `${subscriptions.length} active subscription${subscriptions.length > 1 ? "s" : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {subscriptions.map((sub) => (
            <div key={sub.id} className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{planMap.get(sub.planId) ?? sub.planId}</p>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[sub.effectiveStatus ?? sub.status] ?? ""}`}
                >
                  {sub.effectiveStatus ?? sub.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {sub.expiresAt && (
                  <span>Expires {new Date(sub.expiresAt).toLocaleDateString()}</span>
                )}
                {(sub.effectiveStatus ?? sub.status) === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await client.cancelSubscription({ subscriptionId: sub.id });
                      queryClient.invalidateQueries({ queryKey: ["subscriptions", customerId] });
                      toast.success("Subscription canceled at period end");
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

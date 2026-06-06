"use client";

import { Button } from "@demo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@demo/ui/components/card";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { client } from "@/lib/birrjs-client";

const FEATURES = [
  { id: "advanced_reports" as const, label: "Advanced Reports", type: "boolean" as const },
  { id: "storage" as const, label: "Storage", type: "metered" as const, unit: "MB" },
  { id: "api_calls" as const, label: "API Calls", type: "metered" as const, unit: "calls" },
];

export function EntitlementsCard({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();

  const checks = useQueries({
    queries: FEATURES.map((f) => ({
      queryKey: ["entitlement", customerId, f.id],
      queryFn: () => client.check({ featureId: f.id }),
    })),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entitlements</CardTitle>
        <CardDescription>Feature access and usage across your subscriptions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FEATURES.map((feature, i) => {
          const { data } = checks[i];
          const balance = data?.balance;

          return (
            <div key={feature.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{feature.label}</span>

                {feature.type === "boolean" ? (
                  <span className={data?.allowed ? "text-green-600" : "text-red-500"}>
                    {data?.allowed ? "✅" : "❌"}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {balance
                      ? `${balance.remaining} / ${balance.unlimited ? "∞" : balance.limit}`
                      : "—"}
                    {balance && !balance.unlimited && ` ${feature.unit}`}
                  </span>
                )}
              </div>

              {feature.type === "metered" && balance && !balance.unlimited && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-secondary">
                    <div
                      className="h-2 rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min((balance.remaining / balance.limit) * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const result = await client.report({ featureId: feature.id, amount: 100 });
                      queryClient.invalidateQueries({ queryKey: ["entitlement", customerId] });
                      if (result.success) {
                        toast.success(`Used 100 ${feature.unit}`);
                      } else {
                        toast.error("Insufficient balance");
                      }
                    }}
                  >
                    Use 100
                  </Button>
                </div>
              )}

              {feature.type === "metered" && balance?.unlimited && (
                <p className="text-xs text-muted-foreground">Unlimited</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

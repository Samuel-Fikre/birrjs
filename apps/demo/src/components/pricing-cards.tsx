"use client";

import { Button } from "@demo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@demo/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { client } from "@/lib/birrjs-client";

export function PricingCards() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => client.listPlans({ limit: 10, offset: 0 }),
  });

  if (isLoading) {
    return <div className="mt-4">Loading plans...</div>;
  }

  const plans = (data?.plans ?? []).filter((p) => !p.isDefault);

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {plans.length === 0 ? (
        <p className="text-muted-foreground">No plans available.</p>
      ) : (
        plans.map((plan) => (
          <Card key={plan.internalId}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription>{plan.group ? `Group: ${plan.group}` : null}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {plan.priceAmount ? (
                <p className="text-2xl font-bold">
                  {plan.priceAmount / 100}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    {plan.currency}/{plan.priceInterval}
                  </span>
                </p>
              ) : (
                <p className="text-2xl font-bold">Free</p>
              )}
              <Button onClick={() => router.push(`/checkout/${plan.id}` as any)} className="w-full">
                Subscribe
              </Button>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

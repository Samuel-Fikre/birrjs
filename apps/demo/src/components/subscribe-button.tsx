"use client";

import { Button } from "@demo/ui/components/button";

import { client } from "@/lib/birrjs-client";

type SubscribePlanId = Parameters<typeof client.subscribe>[0]["planId"];

export function SubscribeButton({ planId }: { planId: SubscribePlanId }) {
  return (
    <Button
      onClick={async () => {
        const { checkoutUrl } = await client.subscribe({ planId });
        if (checkoutUrl) window.location.href = checkoutUrl;
      }}
      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
      Subscribe to {planId === "pro" ? "Pro" : planId}
    </Button>
  );
}

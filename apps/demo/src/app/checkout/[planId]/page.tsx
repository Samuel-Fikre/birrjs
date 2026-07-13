"use client";

import { Button } from "@demo/ui/components/button";
import { Input } from "@demo/ui/components/input";
import { Label } from "@demo/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { client } from "@/lib/birrjs-client";

export default function CheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const planId = params.planId as string;

  const [subResult, setSubResult] = useState<Awaited<ReturnType<typeof client.subscribe>> | null>(
    null,
  );
  const [receiptUrl, setReceiptUrl] = useState("");
  const [verifying, setVerifying] = useState(false);

  const subscribe = useMutation({
    mutationFn: () =>
      client.subscribe({ planId: planId as Parameters<typeof client.subscribe>[0]["planId"] }),
    onSuccess: (res) => {
      setSubResult(res);
    },
    onError: () => {
      toast.error("Subscribe failed");
    },
  });

  const handleVerify = async () => {
    if (!subResult) return;
    setVerifying(true);
    try {
      const res = await client.verifyReceipt({
        subscriptionId: subResult.subscriptionId,
        receiptUrl,
      });
      if (res.alreadyActive) {
        toast.info("Subscription already active");
      } else {
        toast.success("Subscription activated!");
      }
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      router.push("/dashboard");
    } catch (e) {
      const err = e as { error?: { message?: string }; message?: string };
      const msg = err.error?.message ?? (e instanceof Error ? e.message : "Verification failed");
      toast.error(msg);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Checkout</h1>

      {!subResult ? (
        <div className="space-y-4 rounded-lg border p-6">
          <p className="text-muted-foreground">Plan ID: {planId}</p>
          <Button
            onClick={() => subscribe.mutate()}
            disabled={subscribe.isPending}
            className="w-full"
          >
            {subscribe.isPending ? "Subscribing..." : "Subscribe"}
          </Button>
        </div>
      ) : subResult.paymentInstructions ? (
        <div className="space-y-4 rounded-lg border p-6">
          <p className="text-sm font-medium">
            Pay <span className="font-bold">{subResult.paymentInstructions.amount} ETB</span> to
            any:
          </p>
          <div className="space-y-2">
            {subResult.paymentInstructions.channels.map((ch) => (
              <div key={ch.type} className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="font-medium">{ch.label}:</span>{" "}
                <code className="text-xs">{ch.value}</code>
                {ch.accountHolder && (
                  <span className="ml-2 text-muted-foreground">({ch.accountHolder})</span>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="receipt">Receipt URL</Label>
            <Input
              id="receipt"
              placeholder=""
              value={receiptUrl}
              onChange={(e) => setReceiptUrl(e.target.value)}
            />
          </div>
          <Button onClick={handleVerify} disabled={verifying || !receiptUrl} className="w-full">
            {verifying ? "Verifying..." : "Verify Payment"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border p-6">
          <p>Subscribed successfully! No payment required.</p>
          <Button onClick={() => router.push("/dashboard")} className="w-full">
            Go to Dashboard
          </Button>
        </div>
      )}
    </div>
  );
}

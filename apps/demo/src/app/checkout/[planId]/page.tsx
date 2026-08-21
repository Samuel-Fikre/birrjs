"use client";

import { collectFingerprint } from "@birrjs/fingerprint";
import { Button } from "@demo/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { client } from "@/lib/birrjs-client";

import { PaymentBlock } from "../../../../components/ui/payment-block";
import type { PaymentChannelType } from "../../../../components/ui/payment-block";

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
  const [selectedChannel, setSelectedChannel] = useState<PaymentChannelType | null>(null);

  const handleSubscribe = async (useTrial?: boolean) => {
    const fingerprint = await collectFingerprint();
    try {
      const res = await client.subscribe({
        planId: planId as Parameters<typeof client.subscribe>[0]["planId"],
        fingerprint: fingerprint ?? undefined,
        useTrial,
      });
      setSubResult(res);
    } catch {
      toast.error("Subscribe failed");
    }
  };

  const handleVerify = async () => {
    if (!subResult) return;
    setVerifying(true);
    try {
      const res = await client.verifyReceipt({
        subscriptionId: subResult.subscriptionId,
        receiptUrl,
        ...(selectedChannel && { channelType: selectedChannel }),
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
          <div className="flex flex-col gap-3">
            <Button onClick={() => handleSubscribe(true)} className="w-full">
              Start 7-day free trial
            </Button>
            <Button onClick={() => handleSubscribe()} variant="outline" className="w-full">
              Pay now
            </Button>
          </div>
        </div>
      ) : subResult.checkoutUrl ? (
        <div className="space-y-4 rounded-lg border p-6">
          <p>Complete payment via your bank to activate your subscription.</p>
          <a
            href={subResult.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 w-full"
          >
            Pay Now
          </a>
        </div>
      ) : subResult.paymentInstructions ? (
        <PaymentBlock
          channels={subResult.paymentInstructions.channels.map((ch) => ({
            type: ch.type as PaymentChannelType,
            label: ch.label,
            value: ch.value,
            accountHolder: ch.accountHolder,
          }))}
          selected={selectedChannel}
          onSelect={setSelectedChannel}
          receiptUrl={receiptUrl}
          onReceiptUrlChange={setReceiptUrl}
          onVerify={handleVerify}
          verifying={verifying}
          amount={subResult.paymentInstructions.amount}
        />
      ) : subResult.trialEndsAt ? (
        <div className="space-y-4 rounded-lg border p-6">
          <p>Trial active — expires {new Date(subResult.trialEndsAt).toLocaleDateString()}</p>
          <Button onClick={() => handleSubscribe()} variant="outline" className="w-full">
            Pay now to upgrade
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

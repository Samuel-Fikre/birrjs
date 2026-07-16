"use client";

import { useState } from "react";

import { PaymentBlock, type PaymentChannel } from "@/components/ui/payment-block";

const demoChannels: PaymentChannel[] = [
  { type: "telebirr", label: "Telebirr", value: "251911223344", accountHolder: "Abebe Kebede" },
  { type: "cbe", label: "CBE", value: "100013456789", accountHolder: "BirrJS Demo" },
  { type: "awash", label: "Awash", value: "0132456789", accountHolder: "Demo Account" },
];

export function PaymentBlockDemo() {
  const [selected, setSelected] = useState<PaymentChannel["type"] | null>(null);
  const [url, setUrl] = useState("");

  return (
    <div className="not-prose my-6">
      <PaymentBlock
        channels={demoChannels}
        selected={selected}
        onSelect={setSelected}
        receiptUrl={url}
        onReceiptUrlChange={setUrl}
        amount={249.99}
      />
    </div>
  );
}

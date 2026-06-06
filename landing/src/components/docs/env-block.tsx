"use client";

import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Check } from "lucide-react";
import { useState } from "react";
import { twMerge } from "tailwind-merge";

function generateHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ROW_CLASS = "flex items-center gap-2 px-4 py-0 font-mono text-xs leading-relaxed";

export function EnvRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="not-prose overflow-hidden rounded-lg border bg-muted">
      <div className="border-b border-border bg-muted/80 px-4 py-1.5 text-xs font-medium text-muted-foreground">
        .env
      </div>
      <div className={ROW_CLASS}>
        <span className="text-muted-foreground">{name}=</span>
        <span className="text-foreground">{value}</span>
      </div>
    </div>
  );
}

export function EnvBlock() {
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    const value = generateHex(32);
    setSecret(value);
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="not-prose overflow-hidden rounded-lg border bg-muted">
      <div className="border-b border-border bg-muted/80 px-4 py-1.5 text-xs font-medium text-muted-foreground">
        .env
      </div>
      <div className={ROW_CLASS}>
        <span className="text-muted-foreground">CHAPA_SECRET_KEY=</span>
        <span className="text-foreground">your-chapa-secret-key</span>
      </div>
      <div className={ROW_CLASS}>
        <span className="text-muted-foreground">CHAPA_WEBHOOK_SECRET=</span>
        <span className="text-foreground">{secret ?? "your-webhook-secret"}</span>
      </div>
      <div className={ROW_CLASS}>
        <span className="text-muted-foreground">CALLBACK_URL=</span>
        <span className="text-foreground">https://your-app.com/api/webhook</span>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={handleGenerate}
          className={twMerge(buttonVariants({ variant: "outline" }), "gap-1.5")}
        >
          Generate Secret
        </button>
        {copied && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3" />
            Copied
          </span>
        )}
      </div>
    </div>
  );
}

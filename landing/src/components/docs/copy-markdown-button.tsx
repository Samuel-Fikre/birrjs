"use client";

import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Check, Clipboard } from "lucide-react";
import { useState } from "react";
import { twMerge } from "tailwind-merge";

export function CopyMarkdownButton({ rawContent }: { rawContent: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(rawContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy page content as Markdown"
      className={twMerge(
        buttonVariants({ variant: "outline" }),
        "relative gap-1.5 text-sm transition-colors",
      )}
    >
      <span className="relative inline-flex size-3.5">
        <Clipboard
          className={`absolute inset-0 size-3.5 transition-opacity duration-200 ${
            copied ? "opacity-0" : "opacity-100"
          }`}
        />
        <Check
          className={`absolute inset-0 size-3.5 transition-opacity duration-200 ${
            copied ? "opacity-100" : "opacity-0"
          }`}
        />
      </span>
      {copied ? "Copied!" : "Copy Markdown"}
    </button>
  );
}

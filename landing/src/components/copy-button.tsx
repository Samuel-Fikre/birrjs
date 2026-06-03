"use client";

import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

type CopyButtonProps = {
  text: string;
  className?: string;
  variant?: "ghost";
  size?: "icon-sm";
  onCopySuccess?: (text: string) => void;
  onCopyError?: (error: Error) => void;
};

export function CopyButton({ text, className, onCopySuccess, onCopyError }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        onCopySuccess?.(text);
        setTimeout(() => setCopied(false), 1500);
      },
      (err) => {
        onCopyError?.(err instanceof Error ? err : new Error(String(err)));
      },
    );
  }, [text, onCopySuccess, onCopyError]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-label="Copy command"
    >
      {copied ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

"use client";

import { BankLogoDisplay } from "./_logos";
import { BankPaymentCard } from "./bank-payment-card";
import type { PaymentChannel, PaymentChannelType } from "./bank-payment-card";
import { ReferenceInput } from "./reference-input";
import { cn } from "./utils";

export type { PaymentChannel, PaymentChannelType };

interface PaymentBlockProps {
  channels: PaymentChannel[];
  selected: PaymentChannelType | null;
  onSelect: (type: PaymentChannelType) => void;
  receiptUrl?: string;
  onReceiptUrlChange?: (value: string) => void;
  onVerify?: () => void;
  verifying?: boolean;
  className?: string;
  amount?: number;
}

function BankIcon({ type, className }: { type: PaymentChannelType; className?: string }) {
  return (
    <div className="flex h-12 w-full items-center justify-center">
      <BankLogoDisplay
        type={type}
        className={cn("max-h-full max-w-full object-contain", className)}
        alt={type}
      />
    </div>
  );
}

export function PaymentBlock({
  channels,
  selected,
  onSelect,
  receiptUrl,
  onReceiptUrlChange,
  onVerify,
  verifying,
  className,
  amount,
}: PaymentBlockProps) {
  const ch = selected ? channels.find((c) => c.type === selected) : undefined;

  return (
    <div className={cn("rounded-lg border bg-card p-4 space-y-3", className)}>
      <h3 className="font-semibold text-sm">Select Payment Method</h3>
      <div className="grid grid-cols-3 gap-3">
        {channels.map((c) => (
          <button
            key={c.type}
            type="button"
            onClick={() => onSelect(c.type)}
            className={
              "transition-opacity cursor-pointer rounded-md " +
              (selected === c.type
                ? "opacity-100 ring-2 ring-primary/20"
                : "opacity-60 hover:opacity-100")
            }
          >
            <div className="rounded-md bg-white dark:bg-neutral-50 p-2">
              <BankIcon type={c.type} />
            </div>
          </button>
        ))}
      </div>
      {ch ? (
        <>
          <BankPaymentCard channel={ch} variant="mono" />
          {amount !== undefined ? (
            <div className="rounded-xl border bg-card shadow-md p-4 space-y-2">
              <h3 className="font-semibold text-sm text-muted-foreground">Order Summary</h3>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>ETB {amount.toFixed(2)}</span>
              </div>
              <hr className="border-t" />
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span>ETB {amount.toFixed(2)}</span>
              </div>
            </div>
          ) : null}
          <ReferenceInput
            channel={ch.type}
            value={receiptUrl ?? ""}
            onChange={(v) => onReceiptUrlChange?.(v)}
          />
          <button
            type="button"
            onClick={onVerify}
            disabled={verifying || !receiptUrl}
            className={cn(
              "flex h-9 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-xs transition-all hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
              verifying && "cursor-wait",
            )}
          >
            {verifying ? (
              <svg className="size-4 animate-spin" viewBox="0 0 16 16" fill="none">
                <g clipPath="url(#birrjs-loader)">
                  <path d="M8 0V4" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 16V12" opacity="0.5" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M3.3 1.53l2.35 3.24"
                    opacity="0.9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M12.7 1.53l-2.35 3.24"
                    opacity="0.1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M12.7 14.47l-2.35-3.24"
                    opacity="0.4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M3.3 14.47l2.35-3.24"
                    opacity="0.6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M15.61 5.53l-3.8 1.23"
                    opacity="0.2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M.39 10.47l3.8-1.23"
                    opacity="0.7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M15.61 10.47l-3.8-1.23"
                    opacity="0.3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M.39 5.53l3.8 1.23"
                    opacity="0.8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </g>
                <defs>
                  <clipPath id="birrjs-loader">
                    <rect width="16" height="16" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            ) : (
              "Verify Payment"
            )}
          </button>
        </>
      ) : (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Select a payment method to continue
        </div>
      )}
    </div>
  );
}

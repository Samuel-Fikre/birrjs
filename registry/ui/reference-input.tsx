"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { BankLogoDisplay } from "./_logos";
import type { PaymentChannelType } from "./bank-payment-card";

interface ReferenceInputProps {
  channel?: PaymentChannelType;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ReferenceInput({
  channel,
  value,
  onChange,
  disabled,
  placeholder = "Paste receipt URL",
  className,
}: ReferenceInputProps) {
  const [prevChannel, setPrevChannel] = useState<PaymentChannelType | undefined>(channel);
  const [anim, setAnim] = useState<"idle" | "exit" | "enter">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (channel === prevChannel) return;
    setAnim("exit");
    timer.current = setTimeout(() => {
      setPrevChannel(channel);
      setAnim("enter");
    }, 300);
    return () => clearTimeout(timer.current);
  }, [channel, prevChannel]);

  useEffect(() => {
    if (anim === "enter") {
      timer.current = setTimeout(() => setAnim("idle"), 300);
      return () => clearTimeout(timer.current);
    }
  }, [anim]);

  return (
    <div
      className={cn(
        "flex h-12 w-full items-center gap-3 rounded-xl border bg-card px-4 shadow-sm",
        className,
      )}
    >
      <div className="relative size-9 overflow-hidden">
        {prevChannel && anim === "exit" && (
          <BankLogoDisplay
            type={prevChannel}
            className="absolute inset-0 size-full object-contain animate-[birrjs-logo-exit_300ms_ease_forwards]"
          />
        )}
        {channel && anim !== "exit" && (
          <BankLogoDisplay
            type={channel}
            className={
              "absolute inset-0 size-full object-contain " +
              (anim === "enter" ? "animate-[birrjs-logo-enter_300ms_ease_forwards]" : "")
            }
          />
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
      <style>{`
        @keyframes birrjs-logo-exit {
          0% { transform: translateY(0); filter: blur(0); opacity: 1; }
          100% { transform: translateY(-30px); filter: blur(4px); opacity: 0; }
        }
        @keyframes birrjs-logo-enter {
          0% { transform: translateY(30px); filter: blur(4px); opacity: 0; }
          100% { transform: translateY(0); filter: blur(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

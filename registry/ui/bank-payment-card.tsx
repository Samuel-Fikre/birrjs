"use client";

import React, { useCallback, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { BankLogoDisplay } from "./_logos";

export type PaymentChannelType = "telebirr" | "cbe" | "awash";

export interface PaymentChannel {
  type: PaymentChannelType;
  label: string;
  value: string;
  accountHolder?: string;
}

interface BankPaymentCardProps {
  channel: PaymentChannel;
  variant?: "mono" | "dither" | "gradient";
  className?: string;
}

const palettes: Record<PaymentChannelType, string> = {
  telebirr: "linear-gradient(135deg, #014a8e 0%, #0172bb 60%, #4a9ed6 100%)",
  cbe: "linear-gradient(135deg, #5c0e63 0%, #821489 60%, #b849b0 100%)",
  awash: "linear-gradient(135deg, #c2410c 0%, #ea580c 60%, #f7923a 100%)",
};

function CopyIcon() {
  return (
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
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
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
  );
}

export function BankPaymentCard({ channel, variant = "mono", className }: BankPaymentCardProps) {
  const [copied, setCopied] = useState(false);
  const colored = variant === "gradient" || variant === "dither";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(channel.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const cardRef = useRef<HTMLDivElement>(null);
  const [tiltTransform, setTiltTransform] = useState(
    "perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
  );
  const [spotlightPos, setSpotlightPos] = useState({ x: 50, y: 50 });
  const [isTiltHovered, setIsTiltHovered] = useState(false);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const xRot = (py - 0.5) * 16;
    const yRot = (px - 0.5) * -16;
    setTiltTransform(
      `perspective(1200px) rotateX(${xRot}deg) rotateY(${yRot}deg) scale3d(1.02, 1.02, 1.02)`,
    );
    setSpotlightPos({ x: px * 100, y: py * 100 });
  }, []);

  const handlePointerEnter = useCallback(() => setIsTiltHovered(true), []);
  const handlePointerLeave = useCallback(() => {
    setTiltTransform("perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)");
    setIsTiltHovered(false);
  }, []);

  return (
    <div
      ref={cardRef}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={cn(
        "relative h-44 w-full overflow-hidden rounded-xl shadow-md will-change-transform",
        !colored && "bg-card border border-border",
        className,
      )}
      style={{
        transform: tiltTransform,
        transition: "transform 0.2s ease-out",
        ...(colored ? { background: palettes[channel.type] } : {}),
      }}
    >
      {variant === "dither" && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          opacity: colored ? 0.3 : 0.07,
          backgroundImage:
            "radial-gradient(80% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%), radial-gradient(60% 60% at 100% 100%, rgba(0,0,0,0.4), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
        style={{ opacity: isTiltHovered ? 1 : 0, transition: "opacity 0.3s" }}
      >
        <div
          className="absolute w-[200%] h-[200%] rounded-full opacity-100 dark:opacity-50"
          style={{
            left: `${spotlightPos.x}%`,
            top: `${spotlightPos.y}%`,
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 40%)",
          }}
        />
      </div>
      <div className="relative flex h-full flex-col justify-between p-5">
        <div className="flex items-start justify-between">
          <span
            className={
              "font-mono text-xs uppercase tracking-widest " +
              (colored ? "text-white/80" : "text-card-foreground/60")
            }
          >
            {channel.label}
          </span>
          <div className="rounded-md bg-white p-0.5">
            <BankLogoDisplay
              type={channel.type}
              className="h-9 w-auto object-contain"
              alt={channel.type}
            />
          </div>
        </div>
        <div
          className={
            "font-mono text-lg tracking-[0.2em] " +
            (colored ? "text-white" : "text-card-foreground")
          }
        >
          {channel.value}
        </div>
        <div className="flex items-end justify-between">
          {channel.accountHolder && (
            <span
              className={
                "font-mono text-xs tracking-wider " +
                (colored ? "text-white/70" : "text-card-foreground/60")
              }
            >
              {channel.accountHolder}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleCopy}
            className={
              "transition-colors " +
              (colored
                ? "text-white/70 hover:text-white"
                : "text-card-foreground/60 hover:text-card-foreground")
            }
            aria-label={copied ? "Copied" : "Copy account number"}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

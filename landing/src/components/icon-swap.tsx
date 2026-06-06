"use client";

import type { ReactNode } from "react";

type IconSwapProps = {
  children: ReactNode;
};

type IconSwapItemProps = {
  children: ReactNode;
  className?: string;
  key?: string | number;
};

export function IconSwap({ children }: IconSwapProps) {
  return <>{children}</>;
}

export function IconSwapItem({ children, className }: IconSwapItemProps) {
  return <span className={className}>{children}</span>;
}

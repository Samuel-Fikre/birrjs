import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

function DashedLine({ orientation }: { orientation: "horizontal" | "vertical" }) {
  const isH = orientation === "horizontal";
  return (
    <svg
      className={cn(
        "pointer-events-none absolute stroke-foreground/20",
        isH ? "left-0 h-px w-full" : "top-0 h-full w-px",
      )}
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1="0"
        x2={isH ? "100%" : "0"}
        y2={isH ? "0" : "100%"}
        stroke="inherit"
        strokeWidth="1"
        strokeDasharray="6 8"
      />
    </svg>
  );
}

export function Section({
  children,
  className,
  last,
}: {
  children: ReactNode;
  className?: string;
  last?: boolean;
}) {
  return (
    <div className={cn("relative mx-auto w-full max-w-[76rem]", className)}>
      <div className="hidden min-[76rem]:block">
        <DashedLine orientation="vertical" />
      </div>
      <div className="absolute right-0 top-0 hidden h-full min-[76rem]:block">
        <DashedLine orientation="vertical" />
      </div>
      {!last && (
        <div className="absolute bottom-0 left-0 w-full">
          <DashedLine orientation="horizontal" />
        </div>
      )}
      {children}
    </div>
  );
}

export function SectionContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-8 sm:px-8 sm:py-10 lg:p-12", className)}>{children}</div>;
}

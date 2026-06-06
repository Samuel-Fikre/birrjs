"use client";

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

function ContextMenuWrapper({ children }: { children: ReactNode }) {
  return <BaseContextMenu.Root>{children}</BaseContextMenu.Root>;
}

function ContextMenuTrigger({
  children,
  className,
  render,
}: {
  children?: ReactNode;
  className?: string;
  render?: ReactElement;
}) {
  if (render) {
    return <BaseContextMenu.Trigger className={className} render={render} />;
  }
  return <BaseContextMenu.Trigger className={className}>{children}</BaseContextMenu.Trigger>;
}

function ContextMenuContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        align="start"
        sideOffset={4}
        positionMethod="fixed"
        className="z-[100]"
      >
        <BaseContextMenu.Popup
          className={cn(
            "min-w-[180px] overflow-hidden rounded-lg border border-border/50 bg-neutral-950 p-1 shadow-xl",
            className,
          )}
        >
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

function ContextMenuItem({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <BaseContextMenu.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm text-neutral-300 outline-none transition-colors hover:bg-neutral-800 hover:text-white data-active:bg-neutral-800 data-active:text-white",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </BaseContextMenu.Item>
  );
}

function ContextMenuSeparator() {
  return <BaseContextMenu.Separator className="my-1 h-px bg-border/30" />;
}

export {
  ContextMenuWrapper as ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
};

"use client";

import type { Separator } from "fumadocs-core/page-tree";

export function DocsSidebarSeparator({ item }: { item: Separator }) {
  return (
    <p className="px-4 pt-6 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase border-b border-border">
      {item.name}
    </p>
  );
}

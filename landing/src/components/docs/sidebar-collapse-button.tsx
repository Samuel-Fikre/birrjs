"use client";

import { useSidebar } from "fumadocs-ui/components/sidebar/base";
import { PanelLeft } from "lucide-react";

export function SidebarCollapseButton() {
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <button
      type="button"
      aria-label="Collapse Sidebar"
      data-collapsed={collapsed}
      className="docs-sidebar-collapse-button text-fd-muted-foreground hover:text-fd-accent-foreground max-md:hidden"
      onClick={() => {
        setCollapsed((prev) => !prev);
      }}
    >
      <PanelLeft className="size-4" aria-hidden="true" />
    </button>
  );
}

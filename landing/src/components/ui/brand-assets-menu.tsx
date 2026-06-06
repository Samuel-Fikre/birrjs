"use client";

import { Image } from "lucide-react";
import type { ReactElement } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function BrandAssetsMenu({
  logoSVG,
  children,
}: {
  logoSVG: string;
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex" render={children} />

      <ContextMenuContent className="w-fit">
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(logoSVG);
            toast.success("Logo copied as SVG");
          }}
        >
          <Image className="size-4" />
          Copy Logo as SVG
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

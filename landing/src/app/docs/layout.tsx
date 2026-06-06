import type { Node } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { Github } from "lucide-react";
import { cloneElement } from "react";
import type { ReactElement, ReactNode } from "react";

import { getDocsCategoryIcon, getDocsPageIcon } from "@/components/docs/docs-icons";
import { SidebarCollapseButton } from "@/components/docs/sidebar-collapse-button";
import { BirrjsLogo } from "@/components/icons/birrjs-logo";
import { URLs } from "@/lib/consts";
import { source } from "@/lib/source";

function addIcons(nodes: Node[]): Node[] {
  return nodes.map((node) => {
    if (node.type === "page" && typeof node.name === "string") {
      const slug = node.url.split("/").pop() ?? "";
      const icon = getDocsPageIcon(slug);
      if (icon) {
        return { ...node, icon: cloneElement(icon as ReactElement, { key: `icon-${node.url}` }) };
      }
    }
    if (node.type === "folder" && node.children) {
      const name = typeof node.name === "string" ? node.name : "";
      let icon = getDocsCategoryIcon(name);
      if (!icon && node.index) {
        const slug = node.index.url.split("/").pop() ?? "";
        icon = getDocsPageIcon(slug);
      }
      return {
        ...node,
        children: addIcons(node.children),
        icon: icon || undefined,
      };
    }
    return node;
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto scroll-smooth">
      <DocsLayout
        themeSwitch={{ enabled: false }}
        tree={{ ...source.pageTree, children: addIcons(source.pageTree.children) }}
        nav={{
          title: (
            <div className="flex items-center gap-1.5">
              <BirrjsLogo className="w-auto h-4.5" />
              <span className="text-xl font-semibold">BirrJS</span>
            </div>
          ),
          url: "/",
          children: <SidebarCollapseButton />,
        }}
        sidebar={{
          footer: (
            <div key="sidebar-footer" className="flex w-full items-center justify-between gap-2">
              <a
                href={URLs.githubRepo}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub repository"
                className="text-muted-foreground hover:text-accent-foreground"
              >
                <Github className="size-4.5" aria-hidden="true" />
              </a>
              <ThemeSwitch />
            </div>
          ),
        }}
      >
        {children}
      </DocsLayout>
    </div>
  );
}

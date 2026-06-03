import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { Github } from "lucide-react";
import type { ReactNode } from "react";

import { URLs, VERSION_TEXT } from "@/lib/consts";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <div className="flex items-center gap-3">
            <span>BirrJS</span>
            {VERSION_TEXT ? (
              <span className="rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                {VERSION_TEXT}
              </span>
            ) : null}
          </div>
        ),
        url: "/",
      }}
      links={[
        {
          text: "GitHub",
          type: "main",
          url: URLs.githubRepo,
          external: true,
        },
      ]}
      sidebar={{
        footer: (
          <div className="flex w-full items-center justify-between gap-2">
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
  );
}

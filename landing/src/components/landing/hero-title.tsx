"use client";

import { ChromeButton } from "@/components/evil-buttons/chrome-button";
import { CodeBlockCommand } from "@/components/ui/code-block-command";

export function HeroTitle() {
  return (
    <div className="relative flex w-full flex-col items-center text-center lg:items-start lg:text-left">
      <div className="space-y-2.5 sm:space-y-4">
        <h1 className="max-w-4xl text-3xl leading-tight tracking-tight text-neutral-800 sm:text-3xl md:text-3xl lg:text-[2.5rem] dark:text-neutral-200">
          Billing framework <br />
          for <span className="border-b border-dashed border-foreground/20">Ethiopian apps</span>
        </h1>
        <p className="max-w-md text-[13px] leading-relaxed text-foreground/50 sm:text-base">
          Define plans and features in code. BirrJS handles subscriptions, webhooks, and
          entitlements — with usage tracking, all inside your codebase.
        </p>
        <div className="mt-6 flex flex-col items-center gap-4 sm:mt-8 lg:items-start lg:mt-12">
          <CodeBlockCommand
            pnpm="pnpm dlx birrjs init"
            yarn="yarn dlx birrjs init"
            npm="npx birrjs init"
            bun="bunx --bun birrjs init"
          />
          <ChromeButton href="/docs">Read Docs</ChromeButton>
        </div>
      </div>
    </div>
  );
}

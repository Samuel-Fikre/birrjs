"use client";

import { useState, type ReactNode } from "react";

import {
  TerminalAnimationBackgroundGradient,
  TerminalAnimationBlinkingCursor,
  TerminalAnimationCommandBar,
  TerminalAnimationContainer,
  TerminalAnimationContent,
  TerminalAnimationOutput,
  TerminalAnimationRoot,
  TerminalAnimationTabList,
  TerminalAnimationTabTrigger,
  TerminalAnimationTrailingPrompt,
  TerminalAnimationWindow,
  useTerminalAnimation,
  type TabContent,
  type TerminalLine,
} from "@/components/ui/terminal-animation";
import { cn } from "@/lib/utils";

const plansCode = `import { plan } from "@birrjs/core";

export const free = plan({
  id: "free",
  name: "Free",
  group: "base",
  default: true,
});

export const pro = plan({
  id: "pro",
  name: "Pro",
  group: "base",
  price: { amount: 29, interval: "monthly" },
});`;

const configCode = `import { chapa } from "@birrjs/chapa";
import { createBirr } from "@birrjs/core";
import { free, pro } from "./plans";

export const birrjs = createBirr({
  database: process.env.DATABASE_URL!,
  provider: chapa({
    secretKey: process.env.CHAPA_SECRET_KEY!,
    webhookSecret: process.env.CHAPA_WEBHOOK_SECRET!,
    callbackUrl: process.env.CALLBACK_URL!,
    returnUrl: process.env.RETURN_URL!,
  }),
  plans: [free, pro],
});`;

function toLines(code: string): TerminalLine[] {
  return [
    { text: "", delay: 60 },
    ...code.split("\n").map((text, i) => ({
      text,
      delay: i === 0 ? 350 : text.length > 55 ? 110 : 75,
    })),
  ];
}

const tabs: TabContent[] = [
  {
    label: "init",
    kind: "terminal",
    command: "npx @birrjs/cli init",
    lines: [
      { text: "", delay: 80 },
      {
        text: "◇  Welcome to BirrJS! Let's set up billing, one birr at a time.",
        color: "text-[#32f3e9]",
        delay: 400,
      },
      {
        text: "●  Detected framework: Next.js",
        color: "text-[#22ff73]",
        delay: 300,
      },
      { text: "", delay: 80 },
      {
        text: "◇  Select payment provider",
        color: "text-[#32f3e9]",
        delay: 350,
      },
      { text: "│  ● Chapa", color: "text-white", delay: 150 },
      { text: "│  ○ Telebirr", color: "text-slate-500", delay: 100 },
      { text: "│  ○ Vodit (receipt verification)", color: "text-slate-500", delay: 100 },
      { text: "│  ○ Verify.et (transaction verification)", color: "text-slate-500", delay: 100 },
      { text: "│  ○ Verify Checkout (hosted checkout)", color: "text-slate-500", delay: 100 },
      { text: "", delay: 200 },
      {
        text: "◇  Created .env with 2 variables",
        color: "text-[#22ff73]",
        delay: 250,
      },
      {
        text: "◇  Installing @birrjs/core, @birrjs/chapa via pnpm",
        color: "text-slate-400",
        delay: 300,
      },
      {
        text: "◇  Installed @birrjs/core, @birrjs/chapa via pnpm",
        color: "text-[#22ff73]",
        delay: 300,
      },
      { text: "", delay: 80 },
      {
        text: "◇  Created 4 files:",
        color: "text-[#22ff73]",
        delay: 250,
      },
      { text: "   birrjs.ts", color: "text-slate-400", delay: 100 },
      { text: "   birrjs-plans.ts", color: "text-slate-400", delay: 100 },
      { text: "   app/api/birrjs/[...all]/route.ts", color: "text-slate-400", delay: 100 },
      { text: "   birrjs-client.ts", color: "text-slate-400", delay: 100 },
      { text: "", delay: 200 },
      {
        text: "└  BirrJS setup completed!",
        color: "text-[#22ff73]",
        delay: 400,
      },
      {
        text: "   Next steps",
        color: "text-slate-400",
        delay: 200,
      },
      {
        text: "   1. Fill in .env variables",
        color: "text-slate-400",
        delay: 150,
      },
      {
        text: "   2. Sync your products pnpm birrjs push",
        color: "text-[#32f3e9]",
        delay: 200,
      },
      {
        text: "   You're good to use BirrJS!",
        color: "text-slate-400",
        delay: 300,
      },
    ],
  },
  {
    label: "plans.ts",
    kind: "code",
    filename: "plans.ts",
    command: "",
    lines: toLines(plansCode),
  },
  {
    label: "birrjs.ts",
    kind: "code",
    filename: "birrjs.ts",
    command: "",
    lines: toLines(configCode),
  },
];

const CODE_TOKEN_RE =
  /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(import|export|from|const|let|return|await|async|function|new|true|false|null|undefined|default)\b|(\b\d+(?:\.\d+)?\b)/g;

function renderCodeLine(text: string): ReactNode[] {
  if (!text) {
    return [<span key="blank">{" "}</span>];
  }
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  CODE_TOKEN_RE.lastIndex = 0;
  while ((match = CODE_TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const [full, comment, str, keyword, num] = match;
    const color = comment
      ? "text-[#7a7f87] italic"
      : str
        ? "text-[#98c379]"
        : keyword
          ? "text-[#c678dd]"
          : num
            ? "text-[#d19a66]"
            : undefined;
    nodes.push(
      <span className={color} key={`${match.index}-${full.slice(0, 8)}`}>
        {full}
      </span>,
    );
    last = match.index + full.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

function SectionBody() {
  const { currentTab } = useTerminalAnimation();
  const isCode = currentTab.kind === "code";

  return (
    <TerminalAnimationContent className="min-h-[20rem] px-4 py-5 sm:min-h-[26rem] sm:px-10 sm:py-8">
      {isCode ? (
        <div className="border-b border-white/10 pb-2">
          <span className="font-mono text-xs text-[#98c379] sm:text-sm">{currentTab.filename}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 leading-relaxed">
          <span className="text-muted-foreground font-mono text-xs select-none sm:text-sm">$</span>
          <TerminalAnimationCommandBar
            className="text-foreground font-mono text-xs sm:text-sm"
            cursor={<TerminalAnimationBlinkingCursor />}
          />
        </div>
      )}

      <TerminalAnimationOutput
        className={cn(isCode ? "mt-3 overflow-x-auto whitespace-pre" : "mt-1 leading-relaxed")}
        renderLine={(line: TerminalLine, _i: number, visible: boolean) => {
          if (!visible) {
            return null;
          }
          return (
            <div className="leading-relaxed">
              <span
                className={cn(
                  "font-mono text-xs sm:text-sm",
                  isCode ? "text-[#d4d4d4]" : (line.color ?? "text-muted-foreground"),
                )}
              >
                {isCode ? renderCodeLine(line.text) : line.text || " "}
              </span>
            </div>
          );
        }}
      />
      {!isCode && (
        <TerminalAnimationTrailingPrompt className="mt-1 flex items-center gap-2 leading-relaxed">
          <span className="text-muted-foreground font-mono text-sm select-none">$</span>
          <TerminalAnimationBlinkingCursor />
        </TerminalAnimationTrailingPrompt>
      )}
    </TerminalAnimationContent>
  );
}

export function CliSection() {
  const [animationKey, setAnimationKey] = useState(0);

  return (
    <section className="mx-auto w-full max-w-[76rem] px-5 pb-8 pt-8 sm:px-8 sm:pb-10 sm:pt-10 lg:pb-12 lg:pt-8">
      <div className="mb-6 max-w-lg space-y-2 lg:mb-10">
        <h2 className="text-xl font-semibold tracking-tight text-foreground/90 sm:text-2xl">
          Scaffold, configure, ship.
        </h2>
        <p className="text-sm leading-relaxed text-foreground/45 sm:text-base">
          One command scaffolds your provider, plans, and config — real files you can open, edit,
          and deploy.
        </p>
      </div>
      <TerminalAnimationRoot
        key={animationKey}
        alwaysDark={true}
        className="bg-background relative flex w-full justify-center overflow-clip"
        defaultActiveTab={0}
        hideCursorOnComplete={false}
        tabs={tabs}
      >
        <TerminalAnimationBackgroundGradient />
        <button
          className="absolute top-3 left-3 z-20 rounded-md border border-white/25 bg-black/45 px-2.5 py-1 font-mono text-[10px] tracking-wide text-white/90 uppercase transition hover:bg-black/65 sm:top-4 sm:left-4 sm:px-3 sm:py-1.5 sm:text-[11px]"
          onClick={() => setAnimationKey((prev) => prev + 1)}
          type="button"
        >
          Refresh
        </button>
        <TerminalAnimationContainer className="max-w-[43rem] pt-14 md:pt-28">
          <TerminalAnimationWindow className="outline-1 outline-offset-[2px] outline-white/30">
            <SectionBody />

            <div className="flex justify-center pb-6">
              <TerminalAnimationTabList className="border-border bg-muted/50 inline-flex items-center gap-0 rounded-lg border px-1 py-1">
                {tabs.map((tab, i) => (
                  <TerminalAnimationTabTrigger
                    className={cn(
                      "cursor-pointer rounded-md px-2.5 py-1 font-mono text-xs transition-all duration-150 sm:px-3.5 sm:text-sm",
                      "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-medium",
                      "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground",
                    )}
                    index={i}
                    key={tab.label}
                  >
                    {tab.label}
                  </TerminalAnimationTabTrigger>
                ))}
              </TerminalAnimationTabList>
            </div>
          </TerminalAnimationWindow>
        </TerminalAnimationContainer>
      </TerminalAnimationRoot>
    </section>
  );
}

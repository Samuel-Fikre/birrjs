"use client";

import { ChevronLeft, Loader2, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";

type View = "code" | "terminal";
type Tab = "plans" | "config";

const pushSteps = [
  { text: "❯ npx @birrjs/cli push", delay: 200 },
  { text: "", delay: 100, type: "pause" },
  { text: "│", delay: 150 },
  { text: "● Connected", delay: 200 },
  { text: "│  Database · postgresql://localhost:5432/birrjs", delay: 150 },
  { text: "│  Chapa    · BirrJS (sandbox)", delay: 150 },
  { text: "│", delay: 100 },
  { text: "◆ Schema is up to date", delay: 200 },
  { text: "│", delay: 100 },
  { text: "◇ Plan changes", delay: 200 },
  { text: "│  + free ($0)     new", delay: 150 },
  { text: "│  + pro ($4.99/mo) new", delay: 150 },
  { text: "│", delay: 100 },
  { text: "◆ Plans synced", delay: 200 },
  { text: "│", delay: 100 },
  { text: "● Done · 2 plans synced", delay: 200 },
];

export function HeroCodeBlock({
  plansCodeBlock,
  configCodeBlock,
}: {
  plansCodeBlock: ReactNode;
  configCodeBlock: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("plans");
  const [view, setView] = useState<View>("code");
  const [terminalLines, setTerminalLines] = useState<typeof pushSteps>([]);
  const [pushing, setPushing] = useState(false);

  const runPush = useCallback(async () => {
    if (pushing) return;
    setPushing(true);
    setView("terminal");
    setTerminalLines([]);

    for (const step of pushSteps) {
      const delay = step.type === "pause" ? 800 : (step.delay ?? 150);

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (step.type !== "pause") {
            setTerminalLines((prev) => [...prev, step]);
          }
          resolve();
        }, delay);
      });
    }

    setPushing(false);
  }, [pushing]);

  const backToCode = useCallback(() => {
    setView("code");
    setTerminalLines([]);
  }, []);

  return (
    <div className="w-full shrink rounded-[10px] border border-border p-[4px] lg:flex-1">
      <div className="flex flex-col overflow-hidden rounded-[6px] border border-foreground/[0.1] bg-card">
        <div className="flex items-center border-b border-foreground/[0.08]">
          <div className="flex flex-1 pl-0.5">
            {view === "code" ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab("plans")}
                  className={
                    "relative px-3.5 py-2 text-sm transition-colors " +
                    (activeTab === "plans"
                      ? "text-foreground/80"
                      : "text-foreground/40 hover:text-foreground/60")
                  }
                >
                  plans.ts
                  {activeTab === "plans" && (
                    <span className="absolute bottom-0 left-2 right-2 h-px bg-foreground/50" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("config")}
                  className={
                    "relative px-3.5 py-2 text-sm transition-colors " +
                    (activeTab === "config"
                      ? "text-foreground/80"
                      : "text-foreground/40 hover:text-foreground/60")
                  }
                >
                  birrjs.ts
                  {activeTab === "config" && (
                    <span className="absolute bottom-0 left-2 right-2 h-px bg-foreground/50" />
                  )}
                </button>
              </>
            ) : (
              <span className="px-4 py-2 font-mono text-sm text-foreground/50">Terminal</span>
            )}
          </div>
        </div>

        <div className="relative h-[18rem] sm:h-[24rem] lg:h-[32rem]">
          <div className="absolute bottom-2.5 right-2.5 z-10">
            <button
              type="button"
              onClick={view === "code" ? () => void runPush() : backToCode}
              disabled={pushing}
              className="not-hover:bg-secondary/80! inline-flex h-8 items-center gap-1.5 rounded-md border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
            >
              {view === "code" ? (
                <>
                  <Terminal className="size-3.5" />
                  Terminal
                </>
              ) : (
                <>
                  <ChevronLeft className="-ml-1 size-3.5" />
                  Back to code
                </>
              )}
            </button>
          </div>
          <div className="h-full overflow-y-auto">
            {view === "code" ? (
              <>
                <div className={activeTab === "plans" ? "block" : "hidden"}>{plansCodeBlock}</div>
                <div className={activeTab === "config" ? "block" : "hidden"}>{configCodeBlock}</div>
              </>
            ) : (
              <div className="h-full bg-[#0e0e0e] p-4 font-mono text-xs leading-relaxed">
                {terminalLines.map((line, i) => (
                  <div key={i} className="min-h-[1.4em] whitespace-pre text-white/85">
                    {line.text}
                  </div>
                ))}
                {pushing && terminalLines.length > 0 && (
                  <Loader2 className="mt-1 size-3 animate-spin text-white/30" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

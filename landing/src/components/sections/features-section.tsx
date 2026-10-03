import { Cable, Database, FileCode2, Puzzle, ScrollText, ShieldCheck, Webhook } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Feature {
  title: string;
  description: string;
  icon: ReactNode;
}

const pluginFeature: Feature = {
  title: "Plugin System",
  description:
    "Extend BirrJS with plugins. Drop in SMS, email, Slack, trials, or custom logic — all through one simple plugin interface.",
  icon: <Puzzle className="size-5" />,
};

const providerFeature: Feature = {
  title: "Provider Agnostic",
  description:
    "Built-in support for Chapa, Telebirr, Links.et, and Verify.et — or bring any provider via the provider interface.",
  icon: <Cable className="size-5" />,
};

const smallFeatures: Feature[] = [
  {
    title: "Type-Safe",
    description:
      "Full TypeScript inference from your plan schema. Plan IDs, feature keys — all typed.",
    icon: <ShieldCheck className="size-5" />,
  },
  {
    title: "Webhooks",
    description: "Verified, deduplicated webhook handling. Automatically sync to your database.",
    icon: <Webhook className="size-5" />,
  },
  {
    title: "Entitlements",
    description: "Feature flags based on subscription status. Check instantly with check().",
    icon: <ScrollText className="size-5" />,
  },
  {
    title: "Your Database",
    description: "All billing state in your Postgres. Low latency, joinable with your app tables.",
    icon: <Database className="size-5" />,
  },
];

function Watermark({ n, dark = false }: { n: string; dark?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -right-3 -bottom-10 text-[7rem] leading-none font-bold transition-transform duration-700 group-hover:scale-105 select-none sm:text-[9rem] md:-right-5 md:-bottom-14 md:text-[11rem]",
        dark ? "text-[#1c1c1b]/[0.07]" : "text-white/[0.06]",
      )}
    >
      {n}
    </span>
  );
}

export function FeaturesSection() {
  return (
    <section className="mx-auto w-full max-w-[76rem] px-5 pb-8 sm:px-8 sm:pb-10 lg:pb-12 lg:pt-8">
      <div className="mb-6 max-w-lg space-y-2 lg:mb-10">
        <h2 className="text-xl font-semibold tracking-tight text-foreground/90 sm:text-2xl">
          Features
        </h2>
        <p className="text-sm leading-relaxed text-foreground/45 sm:text-base">
          Plugins, webhooks, and type-safe entitlements. Everything you need to bill Ethiopian
          users.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-3.5 md:grid-cols-3">
        {/* 01: Plugin System (wide) */}
        <div className="group relative flex min-h-[150px] flex-col justify-center overflow-hidden rounded-[10px] border border-foreground/[0.08] bg-[#1c1c1b] p-5 transition-colors duration-500 hover:border-foreground/[0.14] hover:bg-white/[0.03] sm:p-6 md:col-span-2 md:p-7">
          <div className="relative z-10 w-full sm:w-3/5">
            <span className="mb-3 inline-block text-white/40 transition-colors group-hover:text-white/70">
              {pluginFeature.icon}
            </span>
            <h3 className="mb-1.5 text-lg font-semibold text-white sm:text-xl">
              {pluginFeature.title}
            </h3>
            <p className="text-sm leading-relaxed text-white/55 sm:text-base">
              {pluginFeature.description}
            </p>
          </div>
          <Watermark n="01" />
        </div>

        {/* 02: Provider Agnostic (tall, inverted) */}
        <div className="group relative flex min-h-[310px] flex-col justify-between overflow-hidden rounded-[10px] bg-[#dadad7] p-5 text-[#1c1c1b] transition-all duration-500 sm:p-6 md:row-span-2 md:p-7">
          <div className="relative z-10 mt-2 flex min-h-[130px] items-center justify-center">
            {/* provider slot carousel */}
            <div className="flex w-full max-w-[210px] items-center gap-3 rounded-xl border border-[#1c1c1b]/15 bg-white/40 px-4 py-3">
              <span className="rounded-md bg-[#1c1c1b] px-2 py-1 font-mono text-[10px] font-semibold text-white">
                birr.js
              </span>
              <span className="text-[#1c1c1b]/40">⇄</span>
              <span className="h-[1.25rem] flex-1 overflow-hidden">
                <span className="flex flex-col animate-provider-cycle">
                  {["chapa", "telebirr", "links.et", "verify.et", "chapa"].map((name, i) => (
                    <span
                      key={`${name}-${i}`}
                      className="flex h-[1.25rem] items-center font-mono text-xs font-semibold text-[#1c1c1b]"
                    >
                      {name}
                    </span>
                  ))}
                </span>
              </span>
            </div>
          </div>

          <div className="relative z-10">
            <span className="mb-3 inline-block opacity-60">{providerFeature.icon}</span>
            <h3 className="mb-1.5 text-lg font-semibold sm:text-xl">{providerFeature.title}</h3>
            <p className="text-sm leading-relaxed opacity-60">{providerFeature.description}</p>
          </div>
          <Watermark n="02" dark />
        </div>

        {/* 03 + 04: small cards */}
        {smallFeatures.slice(0, 2).map((feature, i) => (
          <div
            key={feature.title}
            className="group relative flex min-h-[150px] flex-col justify-between overflow-hidden rounded-[10px] border border-foreground/[0.08] bg-[#1c1c1b] p-5 transition-colors duration-500 hover:border-foreground/[0.14] hover:bg-white/[0.03] sm:p-6 md:p-7"
          >
            <div className="relative z-10">
              <span className="mb-3 inline-block text-white/40 transition-colors group-hover:text-white/70">
                {feature.icon}
              </span>
              <h3 className="mb-1.5 text-sm font-semibold text-white sm:text-base">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-white/55">{feature.description}</p>
            </div>
            <Watermark n={i === 0 ? "03" : "04"} />
          </div>
        ))}

        {/* 05 + 06: small cards */}
        {smallFeatures.slice(2).map((feature, i) => (
          <div
            key={feature.title}
            className="group relative flex min-h-[150px] flex-col justify-between overflow-hidden rounded-[10px] border border-foreground/[0.08] bg-[#1c1c1b] p-5 transition-colors duration-500 hover:border-foreground/[0.14] hover:bg-white/[0.03] sm:p-6 md:p-7"
          >
            <div className="relative z-10">
              <span className="mb-3 inline-block text-white/40 transition-colors group-hover:text-white/70">
                {feature.icon}
              </span>
              <h3 className="mb-1.5 text-sm font-semibold text-white sm:text-base">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-white/55">{feature.description}</p>
            </div>
            <Watermark n={i === 0 ? "05" : "06"} />
          </div>
        ))}

        {/* 07: bottom wide strip */}
        <div className="group relative flex min-h-[130px] flex-col justify-center overflow-hidden rounded-[10px] border border-foreground/[0.08] bg-[#1c1c1b] p-5 transition-colors duration-500 hover:border-foreground/[0.14] hover:bg-white/[0.03] sm:p-6 md:col-span-3 md:p-7">
          <div className="relative z-10 w-full sm:w-3/5">
            <span className="mb-3 inline-block text-white/40 transition-colors group-hover:text-white/70">
              <FileCode2 className="size-5" />
            </span>
            <h3 className="mb-1.5 text-lg font-semibold text-white sm:text-xl">
              One CLI, zero boilerplate
            </h3>
            <p className="text-sm leading-relaxed text-white/55 sm:text-base">
              <span className="font-mono text-white/80">npx @birrjs/cli init</span> scaffolds your
              provider, plans, config, and route handler — billing ready in under a minute.
            </p>
          </div>
          <Watermark n="07" />
        </div>
      </div>
    </section>
  );
}

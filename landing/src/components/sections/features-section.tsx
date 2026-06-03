import { Cable, Database, Puzzle, ScrollText, ShieldCheck, Webhook } from "lucide-react";

const features = [
  {
    icon: <Puzzle className="size-5" />,
    title: "Plugin System",
    description:
      "Extend BirrJS with plugins. Integrate SMS providers, email services, or custom logic — all through a simple plugin interface.",
  },
  {
    icon: <ShieldCheck className="size-5" />,
    title: "Type-Safe",
    description:
      "Full TypeScript inference from your plan schema. Plan IDs, feature keys — all typed.",
  },
  {
    icon: <ScrollText className="size-5" />,
    title: "Entitlements",
    description:
      "Feature flags based on subscription status. Check entitlements instantly with check().",
  },
  {
    icon: <Webhook className="size-5" />,
    title: "Webhooks",
    description: "Verified, deduplicated webhook handling. Automatically sync to your database.",
  },
  {
    icon: <Database className="size-5" />,
    title: "Your Database",
    description: "All billing state in your Postgres. Low latency, joinable with your app tables.",
  },
  {
    icon: <Cable className="size-5" />,
    title: "Provider Agnostic",
    description:
      "Built-in support for Chapa, Arifpay, Santimpay — and any provider via the provider interface.",
  },
];

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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="group rounded-[10px] border border-foreground/[0.08] p-[4px] transition-colors hover:border-foreground/[0.1]"
          >
            <div className="flex h-full flex-col gap-3 rounded-md border border-foreground/[0.06] p-5 transition-colors group-hover:border-foreground/[0.08] group-hover:bg-foreground/[0.01]">
              <span className="text-foreground/40 transition-colors group-hover:text-foreground/50">
                {feature.icon}
              </span>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground/90">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-foreground/45">{feature.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

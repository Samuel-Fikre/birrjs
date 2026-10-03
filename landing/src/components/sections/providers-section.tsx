import { FluidRendering } from "@/components/ui/illustration-fluid-rendering";

export function ProvidersSection() {
  return (
    <section className="mx-auto w-full max-w-[76rem] px-5 pb-8 pt-8 sm:px-8 sm:pb-10 sm:pt-10 lg:pb-12 lg:pt-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8 xl:gap-10">
        <div className="min-w-0 flex-1 order-2 lg:order-1">
          <FluidRendering className="h-auto w-full" />
        </div>
        <div className="order-1 lg:order-2 lg:w-[24rem] lg:shrink-0">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground/90 sm:text-2xl">
              One integration. Every provider.
            </h2>
            <p className="text-sm leading-relaxed text-foreground/45 sm:text-base">
              BirrJS speaks a single provider interface. Start on Chapa, swap to Telebirr later, or
              route manual transfers through links.et or verify.et — your billing code never
              changes.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

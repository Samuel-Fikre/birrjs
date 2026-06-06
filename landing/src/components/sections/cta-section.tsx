import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function CTASection() {
  return (
    <section className="mx-auto w-full max-w-[76rem] px-5 pb-8 sm:px-8 sm:pb-10 lg:pb-12">
      <div className="flex flex-col items-center gap-5 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-foreground/90 sm:text-2xl">
          Ready to add subscriptions?
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-foreground/45 sm:text-base">
          Define your plans, connect Chapa, and ship billing in minutes.
        </p>
        <Link
          href="/docs"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Get Started
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}

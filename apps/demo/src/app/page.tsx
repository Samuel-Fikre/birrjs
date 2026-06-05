import { Button } from "@demo/ui/components/button";
import Link from "next/link";

export default function Home() {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">BirrJS Demo</h1>
      <p className="mt-4 max-w-lg text-muted-foreground">
        Subscription management powered by BirrJS — unified billing API for local payment providers.
      </p>
      <div className="mt-8 flex gap-4">
        <Link href="/plans">
          <Button size="lg">View Plans</Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="outline" size="lg">
            Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}

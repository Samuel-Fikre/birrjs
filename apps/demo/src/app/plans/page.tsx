import { PricingCards } from "@/components/pricing-cards";

export default function PlansPage() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold">Plans</h1>
      <PricingCards />
    </div>
  );
}

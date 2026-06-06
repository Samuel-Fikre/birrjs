import { HeroCodeBlock } from "@/components/landing/hero-code-block";
import { HeroTitle } from "@/components/landing/hero-title";
import { Section, SectionContent } from "@/components/layout/section";
import { CodeBlockContent } from "@/components/ui/code-block-content";
import { FlickeringGrid } from "@/components/ui/flickering-grid";

const plansCode = `import { feature, plan } from "birrjs"

const messages = feature({ id: "msgs", type: "metered" })
const proAccess = feature({ id: "pros", type: "boolean" })

export const free = plan({
  id: "free",
  default: true,
  includes: [
    messages({ limit: 20, reset: "month" }),
  ],
})

export const pro = plan({
  id: "pro",
  price: { amount: 499, interval: "month" },
  includes: [
    messages({ limit: 100, reset: "month" }),
    proAccess(),
  ],
})`;

const configCode = `import { chapa } from "@birrjs/chapa"
import { createBirrJS } from "birrjs"
import { free, pro } from "./plans"

export const birr = createBirrJS({
  provider: chapa({
    secretKey: env.CHAPA_SECRET_KEY,
    webhookSecret: env.CHAPA_WEBHOOK_SECRET,
    callbackUrl: process.env.CALLBACK_URL
  }),
  database: env.DATABASE_URL,
  plans: [free, pro],
  on: {
    "subscription.activated": ({ customer, plan }) => {
      await sendEmail(customer.email, "Welcome to Pro!")
    },
  },
})`;

export function HeroSection() {
  return (
    <div className="relative overflow-hidden">
      <FlickeringGrid
        squareSize={4}
        gridGap={8}
        color="rgb(255, 255, 255)"
        maxOpacity={0.15}
        className="absolute inset-0 z-0"
      />
      <Section>
        <SectionContent className="relative z-10 pb-16 pt-14 sm:pb-20 sm:pt-16 lg:pb-24 lg:pt-36">
          <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-center lg:justify-between">
            <div className="lg:max-w-lg">
              <HeroTitle />
            </div>
            <HeroCodeBlock
              plansCodeBlock={<CodeBlockContent lang="ts" code={plansCode} />}
              configCodeBlock={<CodeBlockContent lang="ts" code={configCode} />}
            />
          </div>
        </SectionContent>
      </Section>
    </div>
  );
}

import { chapa } from "@birrjs/chapa";
import { createBirr } from "@birrjs/core";
import { resend } from "@birrjs/email-resend";
import { afromessage } from "@birrjs/sms-afromessage";
import { trial } from "@birrjs/trial";
import { auth } from "@demo/auth";

import { free, pro } from "@/server/plans";

export const birrjs = createBirr({
  database: process.env.DATABASE_URL!,
  provider: chapa({
    secretKey: process.env.CHAPA_SECRET_KEY!,
    webhookSecret: process.env.CHAPA_WEBHOOK_SECRET!,
    callbackUrl: process.env.CALLBACK_URL!,
    returnUrl: process.env.RETURN_URL!,
  }),
  plans: [free, pro],
  plugins: [
    trial(),
    afromessage({
      apiKey: process.env.AFROMESSAGE_API_KEY!,
      sender: process.env.AFROMESSAGE_SENDER!,
    }),
    resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: "BirrJS <noreply@birrjs.dev>",
    }),
  ],
  identify: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return null;
    return {
      customerId: session.user.id,
      email: session.user.email,
      name: session.user.name ?? undefined,
    };
  },
});

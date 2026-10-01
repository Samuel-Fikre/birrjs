import { createBirr } from "@birrjs/core";
import { resend } from "@birrjs/email-resend";
import { afromessage } from "@birrjs/sms-afromessage";
import { telebirr } from "@birrjs/telebirr";
import { trial } from "@birrjs/trial";
import { auth } from "@demo/auth";

import { free, pro } from "@/server/plans";

export const birrjs = createBirr({
  database: process.env.DATABASE_URL!,
  provider: telebirr({
    gatewayUrl: process.env.TELEBIRR_GATEWAY_URL!,
    checkoutUrl: process.env.TELEBIRR_CHECKOUT_URL!,
    fabricAppId: process.env.TELEBIRR_FABRIC_APP_ID!,
    appSecret: process.env.TELEBIRR_APP_SECRET!,
    merchantAppId: process.env.TELEBIRR_MERCHANT_APP_ID!,
    merchantCode: process.env.TELEBIRR_MERCHANT_CODE!,
    privateKeyPem: process.env.TELEBIRR_PRIVATE_KEY!,
    notifyUrl: process.env.CALLBACK_URL!,
    redirectUrl: process.env.RETURN_URL!,
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

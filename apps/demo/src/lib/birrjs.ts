import { createBirr } from "@birrjs/core";
import { resend } from "@birrjs/email-resend";
import { afromessage } from "@birrjs/sms-afromessage";
import { trial } from "@birrjs/trial";
import { verifyEt } from "@birrjs/verify-et";
import { auth } from "@demo/auth";

import { free, pro } from "@/server/plans";

export const birrjs = createBirr({
  database: process.env.DATABASE_URL!,
  provider: verifyEt({
    apiKey: process.env.VERIFY_ET_API_KEY!,
    channels: [
      {
        type: "cbe",
        value: process.env.CBE_ACCOUNT!,
        name: process.env.CBE_ACCOUNT_NAME!,
      },
      {
        type: "telebirr",
        value: process.env.TELEBIRR_ACCOUNT!,
        name: process.env.TELEBIRR_ACCOUNT_NAME!,
      },
    ],
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

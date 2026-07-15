import { createBirr } from "@birrjs/core";
import { afromessage } from "@birrjs/sms-afromessage";
import { vodit } from "@birrjs/vodit";
import { auth } from "@demo/auth";

import { free, pro } from "@/server/plans";

export const birrjs = createBirr({
  database: process.env.DATABASE_URL!,
  provider: vodit({
    apiKey: process.env.VODIT_API_KEY!,
    channels: [
      { type: "telebirr", value: process.env.VODIT_TELEBIRR_ACCOUNT!, name: "Samuel Fikre" },
      { type: "cbe", value: process.env.VODIT_CBE_ACCOUNT!, name: "Samuel Fikre" },
      { type: "awash", value: process.env.VODIT_CBE_ACCOUNT!, name: "Samuel Fikre" },
    ],
  }),
  plans: [free, pro],
  plugins: [
    afromessage({
      apiKey: process.env.AFROMESSAGE_API_KEY!,
      sender: process.env.AFROMESSAGE_SENDER!,
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

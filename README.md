<div align="center">
  <img src="https://raw.githubusercontent.com/Samuel-Fikre/birrjs/main/assets/birrjs-logo.svg" width="120" alt="BirrJS Logo"/>

  <h1 align="center">BirrJS</h1>

  <p align="center">
    Ethiopian payment billing and subscription management for TypeScript
  </p>

  <p align="center">
    <a href="https://github.com/Samuel-Fikre/birrjs/actions/workflows/ci.yml"><img src="https://github.com/Samuel-Fikre/birrjs/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-black.svg?style=flat&colorA=000000&colorB=000000" alt="MIT license"/></a>
  </p>

  <p align="center">
    <a href="https://birrjs.dev">Documentation</a>
    ·
    <a href="https://github.com/Samuel-Fikre/birrjs">GitHub</a>
    ·
    <a href="https://github.com/Samuel-Fikre/birrjs/issues">Issues</a>
  </p>
</div>

## Quick Start

```bash
npx @birrjs/cli init
```

Or set up manually:

```ts
import { createBirr, feature, plan } from "@birrjs/core";
import { chapa } from "@birrjs/chapa";

const messages = feature({ id: "messages", type: "metered" });

const free = plan({
  id: "free",
  name: "Free",
  default: true,
  includes: [messages({ limit: 100, reset: "month" })],
});

const pro = plan({
  id: "pro",
  name: "Pro",
  price: { amount: 29, interval: "monthly" },
  includes: [messages({ limit: 5000, reset: "month" })],
});

const birr = createBirr({
  database: process.env.DATABASE_URL!,
  provider: chapa({
    secretKey: process.env.CHAPA_SECRET_KEY!,
    webhookSecret: process.env.CHAPA_WEBHOOK_SECRET!,
    callbackUrl: process.env.CALLBACK_URL!,
    returnUrl: process.env.RETURN_URL!,
  }),
  plans: [free, pro],
  identify: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return null;
    return { customerId: session.user.id, email: session.user.email };
  },
});
```

## Documentation

Full docs at [birrjs.dev](https://birrjs.dev).

## License

MIT

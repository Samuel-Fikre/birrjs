<div align="center">
  <img src="https://raw.githubusercontent.com/Samuel-Fikre/birrjs/main/assets/birrjs-logo.svg" width="120" alt="BirrJS Logo"/>

  <h1 align="center">BirrJS Core</h1>

  <p align="center">
    Ethiopian payment billing and subscription management for TypeScript
  </p>

  <p align="center">
    <a href="https://www.npmjs.com/package/@birrjs/core"><img src="https://img.shields.io/npm/v/@birrjs/core.svg?style=flat&colorA=000000&colorB=000000" alt="npm version"/></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-black.svg?style=flat&colorA=000000&colorB=000000" alt="MIT license"/></a>
  </p>

  <p align="center">
    <a href="https://github.com/Samuel-Fikre/birrjs">GitHub</a>
    ·
    <a href="https://birrjs.dev">Documentation</a>
    ·
    <a href="https://github.com/Samuel-Fikre/birrjs/issues">Issues</a>
  </p>
</div>

## About

BirrJS sits between your app and local/regional payment providers (Chapa, etc.) providing a unified API for subscriptions, entitlements, and billing.Tailored for Ethiopian payment providers and similar markets.

## Features

- Subscription management with automatic status tracking
- Entitlement/feature-gating system
- Multi-tenant customer management
- Cron-based subscription expiry and reminder sweeps
- Provider-agnostic adapter pattern (Chapa included)
- Plugin system for extensibility
- TypeScript-first with full type safety
- PostgreSQL + Drizzle ORM

## Installation

```bash
npm install @birrjs/core
# or
pnpm add @birrjs/core
```

## Quick Start

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

## License

MIT

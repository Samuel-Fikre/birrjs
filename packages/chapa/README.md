<div align="center">
  <img src="https://raw.githubusercontent.com/Samuel-Fikre/birrjs/main/assets/birrjs-logo.svg" width="80" alt="BirrJS Logo"/>

  <h3 align="center">@birrjs/chapa</h3>

  <p align="center">
    Chapa payment provider adapter for BirrJS
  </p>

  <p align="center">
    <a href="https://www.npmjs.com/package/@birrjs/chapa"><img src="https://img.shields.io/npm/v/@birrjs/chapa.svg?style=flat&colorA=000000&colorB=000000" alt="npm version"/></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-black.svg?style=flat&colorA=000000&colorB=000000" alt="MIT license"/></a>
  </p>
</div>

## About

Chapa provider adapter for BirrJS. Handles payment initialization, verification, and webhook processing through the Chapa API.

## Installation

```bash
npm install @birrjs/chapa
# or
pnpm add @birrjs/chapa
```

## Usage

```ts
import { chapa } from "@birrjs/chapa";

const birr = createBirr({
  provider: chapa({
    secretKey: process.env.CHAPA_SECRET_KEY!,
    webhookSecret: process.env.CHAPA_WEBHOOK_SECRET!,
    callbackUrl: process.env.CALLBACK_URL!,
    returnUrl: process.env.RETURN_URL!,
  }),
  // ...
});
```

## License

MIT

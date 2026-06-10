<div align="center">
  <img src="https://raw.githubusercontent.com/Samuel-Fikre/birrjs/main/assets/birrjs-logo.svg" width="80" alt="BirrJS Logo"/>

  <h3 align="center">@birrjs/sms-afromessage</h3>

  <p align="center">
    Afromessage SMS plugin for BirrJS
  </p>

  <p align="center">
    <a href="https://www.npmjs.com/package/@birrjs/sms-afromessage"><img src="https://img.shields.io/npm/v/@birrjs/sms-afromessage.svg?style=flat&colorA=000000&colorB=000000" alt="npm version"/></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-black.svg?style=flat&colorA=000000&colorB=000000" alt="MIT license"/></a>
  </p>
</div>

## About

Afromessage SMS plugin for BirrJS. Sends subscription reminders and notifications via SMS through the Afromessage API.

## Installation

```bash
npm install @birrjs/sms-afromessage
# or
pnpm add @birrjs/sms-afromessage
```

## Usage

```ts
import { afromessage } from "@birrjs/sms-afromessage";

const birr = createBirr({
  plugins: [
    afromessage({
      apiKey: process.env.AFROMESSAGE_API_KEY!,
      sender: process.env.AFROMESSAGE_SENDER!,
    }),
  ],
  // ...
});
```

## License

MIT

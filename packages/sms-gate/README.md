<div align="center">
  <img src="https://raw.githubusercontent.com/Samuel-Fikre/birrjs/main/assets/birrjs-logo.svg" width="80" alt="BirrJS Logo"/>

  <h3 align="center">@birrjs/sms-gate</h3>

  <p align="center">
    SMS-Gate plugin for BirrJS — send subscription notifications via sms-gate.app
  </p>

  <p align="center">
    <a href="https://www.npmjs.com/package/@birrjs/sms-gate"><img src="https://img.shields.io/npm/v/@birrjs/sms-gate.svg?style=flat&colorA=000000&colorB=000000" alt="npm version"/></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-black.svg?style=flat&colorA=000000&colorB=000000" alt="MIT license"/></a>
  </p>
</div>

## About

SMS-Gate plugin for BirrJS. Sends subscription reminders and notifications via SMS through the [SMS-Gate](https://sms-gate.app) API using an Android device connected to the service.

## Installation

```bash
npm install @birrjs/sms-gate
# or
pnpm add @birrjs/sms-gate
```

## Usage

```ts
import { smsGate } from "@birrjs/sms-gate";

const birr = createBirr({
  plugins: [
    smsGate({
      username: process.env.SMS_GATE_USERNAME!,
      password: process.env.SMS_GATE_PASSWORD!,
    }),
  ],
  // ...
});
```

## License

MIT

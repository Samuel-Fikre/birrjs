# Contributing to BirrJS

## Before submitting a PR

- Run `pnpm typecheck` — all packages must pass
- Run `pnpm lint` (oxlint with `--deny-warnings`) — zero warnings
- Run `pnpm test` — all tests pass
- Run `pnpm format:check` — formatting must match oxfmt
- No Prettier or Biome — oxfmt handles formatting, oxlint handles linting

## Code conventions

- **No classes** — use functions/objects with closures instead
- **No enums** — use `as const` objects or union types
- **No `any`** — use `unknown` and narrow with type guards
- **No `@ts-ignore`** — use `@ts-expect-error` with a reason comment
- **Explicit null checks** (`!= null`) over truthiness (`if (val)`) for type safety — avoids ambiguity with `0`, `""`, `false`
- **`import type`** must use the `import type { ... }` syntax (separated from value imports)
- **`import * as z from "zod"`** — never `import { z }`
- All promises must be awaited or explicitly voided
- 2-space indent (oxfmt handles formatting)
- No `Buffer` in library code — use `Uint8Array`

## Package conventions

- `package.json` must have `main`/`types` pointing to `./src/index.ts`, with a `publishConfig` overrides for `./dist/...`
- `tsdown.config.ts` must use `createPackageTsdownConfig` from `../../tsdown.base.ts`

## Plugin conventions

- Plugin factory function must return `BirrJSPlugin` from `@birrjs/core`
- Use `onEvent` handlers for reacting to subscription lifecycle events
- Plugin `id` should be kebab-case

## Testing

- Run specific tests with `vitest path/to/file -t "test name"`
- Root `vitest.config.ts` uses `test.projects` array — `--project` flag filters by project name
- E2E tests require credentials in environment variables (skipped via `describe.skipIf` when missing)

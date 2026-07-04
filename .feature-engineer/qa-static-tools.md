# QA Static Tools

These commands are run by the Implementation Builder after each task. All commands are invoked from the repository root (`/Users/cam/dev/feature-engineer-extension-pi/`).

## Test Runner

Command: `pnpm test`

This runs `vitest run` (per the `test` script in `package.json`) — non-watch mode, suitable for CI and post-task verification. It executes all 261 unit tests under `tests/**/*.test.ts` and exits non-zero on any failure.

Coverage threshold: not enforced. Coverage is reported via vitest's `v8` provider but is informational only — no minimum percentage is configured in `vitest.config.ts`. The coverage `include` scope is `.pi/extensions/feature-engineer/**/*.ts` and excludes `index.ts`.

## Type Checker

Command: `pnpm typecheck`

This runs `tsc --noEmit` against `tsconfig.json`, which is strict (`noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `isolatedModules`, `useUnknownInCatchVariables`). No JS is emitted (`noEmit: true`); the command verifies types only and exits non-zero on any error.

## Linter

Not configured. There is no ESLint, Biome, or other linter installed or referenced in `package.json` scripts. Linting load is carried by TypeScript's strict compiler settings. Add an ESLint configuration here if/when one is introduced.

Auto-fix command: not applicable (no linter installed).

## Formatter

Not configured. There is no Prettier, dprint, or other formatter installed or referenced in `package.json` scripts. Formatting follows project convention by hand. Add a Prettier configuration here if/when one is introduced.

Check command: not applicable (no formatter installed).

Fix command: not applicable (no formatter installed).

## Import Sorter

Not configured. There is no import-sorting tool (e.g. `prettier-plugin-organize-imports`, `@trivago/prettier-plugin-sort-imports`) installed. Imports are ordered manually. Add one here if/when one is introduced.

Command: not applicable (no import sorter installed).

## Build / Compile

Command: `pnpm typecheck`

The project does not have a separate `build` script. `tsconfig.json` is configured with `noEmit: true`; the package ships TypeScript source directly and is loaded by jiti at runtime. `pnpm typecheck` (`tsc --noEmit`) is the canonical build-verification step — it verifies the source compiles cleanly under strict settings and is the closest equivalent to a build check. Run it as the final gate before committing.

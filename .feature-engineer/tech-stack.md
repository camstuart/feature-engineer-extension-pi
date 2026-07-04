# Technology Stack

## Runtime

- **Language**: TypeScript 5.7+ (strict mode, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`).
- **Module system**: ESM only (`"type": "module"` in `package.json`). All imports between local files use explicit `.js` suffixes so jiti can resolve the extension source as ESM at load time.
- **Runtime**: Node.js 24+ (`@types/node: ^24.0.0`).
- **Package manager**: pnpm 9.15.9 (declared in `packageManager`); `pnpm-lock.yaml` is committed.

## Frontend

Not applicable. Feature Engineer is a backend Pi extension — it has no UI surface beyond the `ui.select`, `ui.notify`, `ui.confirm`, and `ui.input` primitives exposed by the Pi Coding Agent SDK. The Pi TUI renders all prompts and notifications.

## Backend

- **Framework**: Pi extension SDK — `@earendil-works/pi-coding-agent` (peer dependency, `*`). Imports: slash-command registration, session entry types, UI primitives, `customType` for `fe-state`.
- **TUI primitives**: `@earendil-works/pi-tui` (peer dependency, `*`) for any TUI-rendered components.
- **Execution model**: long-lived extension that spawns fresh LLM sessions per skill via the SDK; no HTTP server, no API.

## Data

Not applicable. The extension has no database. All persistence is on disk:

- **Per-project state**: `<project>/.feature-engineer/fe-state` (custom session entry in the Pi session log) and `<project>/.feature-engineer/features-index.md`.
- **Per-project artifacts**: `<project>/.feature-engineer/features/<id>-<slug>/` containing requirement, technical architecture, test plan, implementation plan, review concerns, etc.
- **Global templates**: `~/.pi/agent/feature-engineer/templates/` (config + artifacts), seeded once from the bundled defaults.
- **Reads/writes** via Node `node:fs` (`readFileSync`, `writeFileSync`, `mkdirSync`, `readdirSync`, etc.) — no ORM, no query layer.

## Testing

- **Runner**: vitest 2.1+ (`vitest.config.ts`); configured with `globals: true` and `environment: "node"`.
- **Assertion library**: vitest's built-in `expect` (globals).
- **Mocking**: not currently used — the test suite is pure-logic unit tests; no external services are touched.
- **Coverage**: vitest's built-in `v8` coverage, scope-limited to `.pi/extensions/feature-engineer/**/*.ts` excluding `index.ts` (the orchestrator glue is integration-tested manually via Pi).
- **Naming**: `tests/<module>.test.ts` mirrors the source module name; subdirectories `tests/prompts/` and `tests/skills/` mirror their source counterparts.

## Build & Tooling

- **Type checker**: TypeScript 5.7+ via `tsc --noEmit`. Config: `tsconfig.json` (strict; `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `isolatedModules`, `useUnknownInCatchVariables`). Run via `pnpm typecheck`.
- **Bundler / transpiler**: none at the source level — the package ships `.ts` source and is loaded by jiti at runtime. No build step required for installation or use.
- **Linter**: not configured. There is no ESLint config or `lint` script in `package.json`; strict TypeScript settings carry the linting load.
- **Formatter**: not configured. There is no Prettier config or `format` script in `package.json`; formatting is by convention.
- **Path alias**: `@/*` → `.pi/extensions/feature-engineer/*` (configured in both `tsconfig.json` and `vitest.config.ts`).

## Key Libraries

- **`@earendil-works/pi-coding-agent`** (peer, `*`) — the Pi extension SDK; provides slash-command registration, session lifecycle, custom session entries, UI primitives, and the LLM session invocation API.
- **`@earendil-works/pi-tui`** (peer, `*`) — TUI primitives used by the SDK for rendering.
- **`vitest`** (dev, `^2.1.0`) — test runner.
- **`typescript`** (dev, `^5.7.0`) — type checker.
- **`@types/node`** (dev, `^24.0.0`) — Node.js type definitions.
- **No third-party runtime dependencies** — the extension source uses only Node built-ins (`node:fs`, `node:path`, `node:url`, `node:os`) plus the Pi SDK peers.

# Project File Structure

## Source Layout

All extension source lives at `.pi/extensions/feature-engineer/` and is published as the npm package entry:

- `.pi/extensions/feature-engineer/index.ts` — extension entry point; registers the `/feature` slash command and orchestrates the workflow.
- `.pi/extensions/feature-engineer/state.ts` — canonical workflow steps, transitions, display names, classification helpers.
- `.pi/extensions/feature-engineer/paths.ts` — directory and file path helpers, slug/ID generation logic.
- `.pi/extensions/feature-engineer/files.ts` — reads project files (templates, configs, artifacts).
- `.pi/extensions/feature-engineer/init.ts` — init-status checks (`init-check` step).
- `.pi/extensions/feature-engineer/persistence.ts` — `fe-state` validation, encoding, latest-state lookup, next-step routing.
- `.pi/extensions/feature-engineer/routing.ts` — subcommand parsing (`/feature`, `/feature approve`, `/feature reject`, `/feature status`) and severity routing.
- `.pi/extensions/feature-engineer/seeding.ts` — global template seeding (copies bundled defaults to `~/.pi/agent/feature-engineer/templates/` on first run; idempotent; preserves user edits).
- `.pi/extensions/feature-engineer/qa.ts` — parses `qa-static-tools.md` and aggregates QA results for the Implementation Builder.
- `.pi/extensions/feature-engineer/features-index.ts` — parses and updates `features-index.md`.
- `.pi/extensions/feature-engineer/dates.ts` — `YYYY-MM-DD` helper (deterministic, dependency-free).
- `.pi/extensions/feature-engineer/version.ts` — reads the package version from `package.json` at module load time, with a `"0.0.0"` fallback.
- `.pi/extensions/feature-engineer/skills/` — per-skill session orchestrators; one file per skill plus `runner.ts` which owns the shared `intermediateSteps` mechanism (send → wait → compact, deterministic ordering).
- `.pi/extensions/feature-engineer/prompts/` — pure prompt builders; one file per skill plus `common.ts` (template-population reminder, self-verify checklist, worked-example block).

## Test Layout

- `tests/` — vitest suite, 261 unit tests covering the pure-logic modules.
- `tests/<module>.test.ts` mirrors the source module name (e.g. `tests/state.test.ts` covers `state.ts`).
- `tests/prompts/` — one test file per prompt builder.
- `tests/skills/` — one test file per skill orchestrator.
- Coverage scope (per `vitest.config.ts`): all files under `.pi/extensions/feature-engineer/**/*.ts` except `index.ts` (the orchestrator glue is integration-tested manually via Pi).
- Coverage threshold: not enforced; coverage is reported only.

## Generated / Build Output

- `dist/` — TypeScript build output (configured as excluded in `tsconfig.json`; currently `noEmit: true` so no JS is emitted).
- `*.tsbuildinfo` — incremental TS build cache (gitignored).
- `coverage/` — vitest coverage output (gitignored).
- `.feature-engineer/features-index.md` and `feature-*/` — written at runtime by the extension during a feature workflow (gitignored).
- `~/.pi/agent/feature-engineer/templates/` — global per-user template directory, seeded by the extension on first run; not part of this repo.

## Configuration Files

- `package.json` — package manifest; declares the `pi` extension entry, `pi-package` keyword, `files` allowlist, ESM `type`, `peerDependencies`, and npm scripts (`test`, `test:watch`, `typecheck`).
- `tsconfig.json` — strict TypeScript config (`target: ES2022`, `module: ESNext`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, etc.); includes extension source and tests; excludes `node_modules` and `dist`.
- `vitest.config.ts` — vitest configuration; sets `globals: true`, `environment: "node"`, the `@/*` path alias to `.pi/extensions/feature-engineer/*`, and the coverage include/exclude scope.
- `.gitignore` — excludes `node_modules/`, `dist/`, `*.tsbuildinfo`, editor folders, `coverage/`, and the runtime-generated files under `.feature-engineer/` and `feature-*/`.
- `LICENSE` — MIT.
- `.feature-engineer/templates/` — bundled default templates shipped with the package (config and artifact templates). These are the source of truth for first-run seeding; the extension copies them to `~/.pi/agent/feature-engineer/templates/` on the first `/feature` invocation.
- `.feature-engineer/*.md` (this directory) — populated project-wide config files (actors, structure, tech-stack, qa-static-tools, qa-engineering, git-strategy); read by the Technical Design, Implementation Planning, Implementation Builder, and Review Completion skills.

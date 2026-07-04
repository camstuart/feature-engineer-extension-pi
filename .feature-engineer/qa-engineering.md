# Engineering Quality Principles

## Component & Function Reuse

- Prefer extending existing modules over introducing new ones. Before adding a new module under `.pi/extensions/feature-engineer/`, check whether `state.ts`, `paths.ts`, `files.ts`, `persistence.ts`, `routing.ts`, or `qa.ts` already exports the needed helper.
- Reuse the shared skill runner (`skills/runner.ts`) for every skill — do not reimplement `intermediateSteps` (send → wait → compact, deterministic ordering) in individual skill files.
- Reuse the shared prompt helpers in `prompts/common.ts` (`templatePopulationReminder`, the self-verify checklist, the worked-example block) at the top of every new prompt builder.
- Reuse `dates.ts` for any date formatting; never call `new Date().toISOString().slice(0, 10)` inline.
- Reuse `version.ts`'s exported `VERSION` constant; never re-read `package.json` from a new location.

## Coding Style

- Pure functions over classes. The codebase uses zero classes — modules export functions and constants only.
- No default exports. Every export is a named export so tree-shaking and refactoring stay predictable.
- ESM only, with explicit `.js` import suffixes for all local imports (required so jiti resolves the extension as ESM at load time).
- Strict TypeScript everywhere — no `any`, no `// @ts-ignore`, no `// @ts-expect-error` without an inline comment explaining the workaround.
- No `as unknown as X` style casts. If a type narrowing is impossible, redesign the API instead of forcing a cast.
- Prefer `unknown` over `any` in catch positions (enforced by `useUnknownInCatchVariables: true`).
- Keep modules small and focused. The largest source file is `index.ts` (the orchestrator glue); everything else is under ~250 lines.
- Avoid mutating function arguments. Return new values instead.

## Architecture Patterns

- **Orchestrator + pure modules.** `index.ts` owns the workflow glue (slash-command routing, skill invocation, state transitions). Every other module is a pure function library and is unit-testable without Pi.
- **Pure prompt builders.** Each file under `prompts/` is a pure function `(ctx) => string` — no I/O, no SDK calls. The runner applies the prompt; the builder only constructs text.
- **Skill files own sequencing, not content.** Each file under `skills/` calls `runner.ts` with the appropriate `intermediateSteps` and prompt builders; skills never duplicate prompt text.
- **Disk as the integration boundary.** State and artifacts live in `.feature-engineer/`; sessions never share in-memory state. Reads and writes go through `files.ts`.
- **Single source of truth for steps.** All step names, transitions, and display names live in `state.ts`. Do not hardcode step strings elsewhere — import from `state.ts`.
- **No silent fallbacks.** When a value cannot be read, throw or return a documented sentinel (e.g. `version.ts` returns `"0.0.0"` and documents it). Never swallow an error to keep the program running with stale data.

## Naming Conventions

- **Files**: kebab-case (e.g. `features-index.ts`, `tech-design.ts`, `qa-static-tools.md`). Always lowercase; hyphens separate words.
- **Exports**: camelCase for functions and variables (e.g. `todayIso`, `resolvePackageRoot`); PascalCase for types and interfaces (e.g. `WorkflowStep`, `FeState`).
- **Constants**: SCREAMING_SNAKE_CASE for module-level constants (e.g. `UNKNOWN_VERSION`); camelCase for exported derived constants (e.g. `VERSION`).
- **Test files**: `<source-module>.test.ts`, mirroring the source module name exactly.
- **Directories**: lowercase, no separators (e.g. `skills/`, `prompts/`, `tests/`).
- **Template placeholders**: SCREAMING_SNAKE_CASE inside double curly braces for concrete content slots; HTML comments prefixed `AI:` for LLM guidance comments. Both are removed when the artifact is populated.

## Error Handling

- Throw `Error` (or a subclass) with a message that names the failing operation. Never throw strings or plain objects.
- Catch only at I/O boundaries (filesystem, JSON parse, package resolution). Re-throw after logging context if the caller needs to recover.
- Prefer `try { ... } catch { /* documented fallback */ }` only when the fallback is documented in a JSDoc comment (see `version.ts` for the canonical pattern: fallback constant + JSDoc explaining why the fallback is safe).
- Never use empty `catch {}` blocks. If the error is genuinely ignorable, write `catch { /* reason */ }`.
- Use `useUnknownInCatchVariables` (already enabled): narrow with `instanceof Error` before accessing `.message`.

## Performance Considerations

- The extension runs in the user's interactive Pi session. Latency-sensitive paths are: `/feature status` (must respond instantly) and template seeding (must be idempotent and O(files)).
- Keep `index.ts`'s top-level synchronous work minimal. Heavy computation belongs in lazy code paths triggered by user action.
- Avoid reading the same file twice in one skill run — cache reads through `files.ts` helpers when a skill needs the same template or config more than once.
- The extension has no hot loop. Per-skill LLM sessions are the dominant cost; do not optimise local code at the expense of clarity.
- Do not introduce async I/O in modules that are currently synchronous (e.g. `paths.ts`, `dates.ts`) without a clear reason — most callers benefit from sync semantics.

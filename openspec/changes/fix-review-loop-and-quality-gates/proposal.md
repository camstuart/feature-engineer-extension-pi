# Fix Review Loop and Quality Gates

## Why

A workflow review found that the review→fix loop is currently decorative: the 8-pass review writes `06-review-concerns-to-address.md`, but the concerns never reach the skill that is routed to fix them, the file accumulates stale concerns across cycles, and passes 2–8 read "prior concerns" eagerly before pass 1 has even run. Separately, several quality gates are prompt-side promises (self-checks, red-phase verification, template-population rules) that the orchestrator could enforce deterministically, and feature-branch creation happens at the end of the workflow — after all implementation commits have already landed on whatever branch was checked out.

## What Changes

- **Fix the review feedback loop** — concerns are injected into the skill the severity gate routes to (tech-design or impl-builder); the concerns file is rotated per review cycle; per-pass `priorConcerns` is read lazily at step time, not eagerly at setup time.
- **Consolidate review passes 8 → 5** — merge `actors-coverage` into `requirements-coverage`; drop the `static-qa` LLM pass (the orchestrator already gates impl-builder on QA); replace the `git-strategy` LLM pass with deterministic orchestrator checks (branch-name and commit-format regex) whose findings are written into the concerns file.
- **Single severity taxonomy** — per-concern tags become `[ARCH]` / `[MINOR]` (dropping `BLOCKER/MAJOR/NIT`), matching the routing targets exactly. The orchestrator parses the tags and pre-selects a recommended route at the severity gate.
- **Clean review auto-advances** — when every section reports no concerns, the orchestrator notifies the user and advances straight to `github`; the human gate appears only when concerns exist.
- **Deterministic approve gate** — `/feature approve` at an artifact-producing step verifies the artifact exists, contains no `{{placeholder}}` markers or `<!-- AI: -->` comments (hard block), and contains the template's section headings (soft warn + confirm). Prompt-side self-check blocks shrink accordingly.
- **Red-phase verification** — after test-builder, the orchestrator runs the parsed test command and requires a non-zero exit before advancing to impl-builder.
- **Branch creation moves to before test-builder** — the orchestrator creates the feature branch deterministically (parsed from a structured `Branch pattern:` line in `06-git-strategy.md`, defaulting to `feature/<slug>`); the github skill only pushes, opens the PR, and updates the index.
- **UX polish** — `/feature reject` with no feedback opens a `ui.input` instead of erroring; vague-mode discovery batches per-item `ui.confirm` calls into one confirmation per round.
- **Doc/prompt sync** — README post-review routing, the review prompt's "What Happens Next" section, and the `state.ts` interactive-steps comment are updated to match actual behavior; the contradictory "leave empty" vs "`- No concerns.`" instruction is resolved; the `[CHECKPOINT]`/`[INLINE]` markers are dropped in favor of the template's `## Commit Checkpoints` section; the redundant `Static QA Assertions` template section is removed.

## Capabilities

### New Capabilities

- `review-quality-loop`: The post-implementation review cycle — 5 passes, single `[ARCH]`/`[MINOR]` taxonomy, per-cycle file rotation, lazy prior-concerns, concerns fed back into the routed fix skill, deterministic git-strategy checks, clean-review auto-advance.
- `approval-quality-gates`: Orchestrator-enforced deterministic gates — artifact validation on `/feature approve`, red-phase test verification after test-builder.
- `branch-lifecycle`: Feature branch created by the orchestrator before build steps; github skill reduced to push/PR/index duties.
- `workflow-ux`: Reject-without-feedback prompt, batched discovery confirmations.

### Modified Capabilities

None — this project has no existing openspec specs; all capabilities are newly specified.

## Impact

- **Orchestrator**: `index.ts` (approve gate, clean-review routing, severity recommendation, branch creation), `state.ts` (comment fix), `routing.ts` (severity parsing).
- **Skills**: `skills/review-completion.ts` (5 passes, lazy prompts, rotation, deterministic git checks), `skills/impl-builder.ts` + `skills/tech-design.ts` (concerns injection), `skills/test-builder.ts` (red-phase check), `skills/github.ts` (drop branch/commit duties).
- **Prompts**: `prompts/review-completion.ts` (pass definitions, tag format, contradiction fix, "What Happens Next"), `prompts/impl-builder.ts` / `prompts/tech-design.ts` (concerns block), `prompts/impl-planning.ts` (drop CHECKPOINT/INLINE markers), `prompts/github.ts` (reduced process), `prompts/req-gathering.ts` (batched confirms), `prompts/common.ts` (slimmer self-check).
- **New module**: `git-checks.ts` (branch/commit-format validation), plus a `Branch pattern:` parser (likely in `qa.ts`-style form or a small `git-strategy.ts`).
- **Templates**: `templates/config/git-strategy.md` (structured `Branch pattern:` line), `templates/artifacts/review-concerns.md` (tag format, drop obsolete sections), `templates/artifacts/technical-plan-testing.md` (drop `Static QA Assertions`).
- **Docs**: `README.md`, `docs/workflow.mmd` + regenerated SVG.
- **Tests**: updates across `tests/prompts/*`, `tests/qa.test.ts`, `tests/routing.test.ts`, `tests/state.test.ts`, plus new suites for the approve gate, git checks, and concerns rotation.
- **No breaking changes to the user-facing command surface** — `/feature`, `approve`, `reject`, `status` are unchanged (reject becomes more forgiving).

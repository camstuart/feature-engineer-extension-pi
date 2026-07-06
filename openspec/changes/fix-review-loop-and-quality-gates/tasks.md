# Tasks — Fix Review Loop and Quality Gates

## 1. Runner: lazy intermediate-step prompts

- [ ] 1.1 Extend `IntermediateStep.prompt` in `skills/runner.ts` to `string | (() => string)`; resolve immediately before sending each step
- [ ] 1.2 Add runner tests: lazy prompt resolved at step time (mutate underlying data between steps and assert the later value is used); plain string prompts unchanged (`tests/runner.test.ts`)

## 2. Review pass consolidation and taxonomy

- [ ] 2.1 In `prompts/review-completion.ts`, reduce `REVIEW_PASSES` to 5: merge `actors-coverage` into `requirements-coverage` (question/instructions cover per-actor story coverage; files include `01-actors.md`), delete `static-qa` and `git-strategy` passes
- [ ] 2.2 Change the concern format to `- [ARCH|MINOR] <observation> → <suggested fix>`; remove `BLOCKER/MAJOR/NIT` from prompt text
- [ ] 2.3 Remove the "leave the heading body empty" instruction; keep `- No concerns.` as the single empty-finding convention
- [ ] 2.4 Rewrite the "What Happens Next" section: clean review auto-advances to GitHub; concerns lead to the user gate with a parsed recommendation
- [ ] 2.5 Update `templates/artifacts/review-concerns.md`: drop the `## Static QA` section, keep `## Git Strategy` (now orchestrator-written), update the `## Summary` AI hint to the ARCH/MINOR taxonomy
- [ ] 2.6 Update `tests/prompts/review-completion.test.ts` for the 5-pass set, tag format, and routing description

## 3. Review runner: rotation and lazy prior concerns

- [ ] 3.1 In `skills/review-completion.ts`, rotate an existing `06-review-concerns-to-address.md` to `06-review-concerns.v<N>.md` (first unused N) before pass 1; add a `rotateConcernsFile` helper in `paths.ts` or `files.ts`
- [ ] 3.2 Build pass 2–5 prompts as lazy closures that read the concerns file at resolution time
- [ ] 3.3 Add tests: rotation naming (v1, v2), no-op when absent; lazy priorConcerns sees pass-1 output (`tests/` new or extended suite)

## 4. Deterministic git checks

- [ ] 4.1 Create `git-checks.ts`: parse `Branch pattern:` and optional `Commit pattern:` backtick-quoted lines from git-strategy content ({slug}/{id} substitutions, `feature/<slug>` default); check current branch name, commit existence, and (when configured) commit-subject format
- [ ] 4.2 Wire the checks into `skills/review-completion.ts` after the LLM passes; append failures as `[MINOR]` concerns under `## Git Strategy` in the active concerns file
- [ ] 4.3 Add `Branch pattern:` line to `templates/config/git-strategy.md` (and the repo's own `.feature-engineer/git-strategy.md`)
- [ ] 4.4 Add `tests/git-checks.test.ts`: pattern parsing, substitution, default fallback, branch mismatch, missing commit pattern skips format check

## 5. Severity gate: parsing, recommendation, clean auto-advance

- [x] 5.1 Add concern parsing to `routing.ts` (or `qa.ts`-adjacent module): extract `[ARCH]`/`[MINOR]` tags with tolerant regex; untagged bullets count as `[MINOR]`; expose counts and recommended route
- [x] 5.2 In `index.ts`, after review completion: zero concerns → notify "review clean" and `advanceTo("github")`, skipping the gate; otherwise show the gate with concern counts and the recommended option pre-selected/first
- [x] 5.3 Update `promptConcernSeverity` to present the recommendation while allowing override
- [x] 5.4 Update `summariseConcerns` for the new tag format and untagged-count reporting
- [x] 5.5 Update `tests/routing.test.ts` and add gate-summary tests

## 6. Concerns feedback into fix skills

- [x] 6.1 Add `reviewConcerns: string | null` input to `buildImplBuilderPrompt` and `buildTechDesignPhase1Prompt`/`Phase2Prompt`; render as `## Review Concerns To Address`; impl-builder prompt switches from "Begin with Task 1" to concern-addressing framing when present
- [x] 6.2 In `index.ts` severity routing, read the active concerns file and pass it to the routed skill runner; thread through `skills/impl-builder.ts` and `skills/tech-design.ts`
- [x] 6.3 Ensure `/feature reject` paths pass `reviewConcerns: null` (channels stay distinct)
- [x] 6.4 Update `tests/prompts/impl-builder.test.ts` and `tests/prompts/tech-design.test.ts`

## 7. Deterministic approve gate

- [x] 7.1 Create an artifact validator (new `approve-gate.ts` or in `files.ts`): file exists; no `{{` markers; no `<!-- AI:` comments; `##` headings from the source template present, minus an optional-heading allowlist (`## Delta from Existing Architecture`)
- [x] 7.2 Wire into `handleApprove` in `index.ts` for interactive artifact steps: hard block (notify with file + offending lines) on missing/placeholder/AI-comment; `ui.confirm` on missing headings; analyse-codebase validates all six config files
- [x] 7.3 Shrink `templatePopulationReminder` and the `interactiveApprovalReminder` self-check in `prompts/common.ts` to a one-sentence note about orchestrator validation
- [x] 7.4 Add `tests/approve-gate.test.ts` (all block/warn/pass cases) and update `tests/prompts/common.test.ts`

## 8. Red-phase verification after test-builder

- [x] 8.1 In `skills/test-builder.ts`, after the session: run type-check (must exit 0) and test runner (must exit non-zero) via `qa.ts` helpers; on violation re-prompt once with the observed outcome; on second violation notify and pause (subsequent `/feature` re-runs test-builder)
- [x] 8.2 Add a retry-prompt builder to `prompts/test-builder.ts` for the passing-tests / type-error cases
- [x] 8.3 Update `tests/prompts/test-builder.test.ts` and add runner-level tests for the red-phase gate

## 9. Branch lifecycle

- [x] 9.1 In `index.ts`, on approving impl-planning: resolve branch name via `git-checks.ts`, then create/checkout/no-op the branch; on git failure notify and stay at impl-planning
- [x] 9.2 Rewrite `prompts/github.ts` process: verify commits exist on the branch (BLOCKED if none), push, PR when applicable, update index — no branch creation or committing
- [x] 9.3 Update `tests/prompts/github.test.ts`

## 10. UX polish

- [ ] 10.1 `handleReject` in `index.ts`: no feedback + UI mode → `ui.input` for feedback; cancel aborts; non-UI keeps the error
- [ ] 10.2 `prompts/req-gathering.ts` vague mode: replace per-item confirms in STEPs 3–5 with one synthesis + confirm per round; update `tests/prompts/req-gathering.test.ts`

## 11. Docs and template sync

- [ ] 11.1 README: fix post-review routing description, document rotation (`06-review-concerns.v<N>.md`), approve-gate validation, red-phase gate, branch timing, `Branch pattern:` line, 5-pass review
- [ ] 11.2 Fix `state.ts` INTERACTIVE_STEPS comment (`ui.confirm` → `/feature approve`)
- [ ] 11.3 `prompts/impl-planning.ts`: remove `[CHECKPOINT]`/`[INLINE]` marker instructions (keep `## Commit Checkpoints`); update its tests
- [ ] 11.4 `templates/artifacts/technical-plan-testing.md`: remove the `## Static QA Assertions` section; adjust `prompts/test-planning.ts` step 3 and tests
- [ ] 11.5 Update `docs/workflow.mmd` (branch-create node before test-builder, clean-review auto-advance edge, 5-pass review label) and regenerate `workflow.svg` via `node scripts/render-workflow.mjs`

## 12. Verification

- [ ] 12.1 `pnpm typecheck` — zero errors
- [ ] 12.2 `pnpm test` — full suite green, including new suites (approve gate, git checks, rotation, red-phase)
- [ ] 12.3 Manual smoke test via `pi -e ./.pi/extensions/feature-engineer/index.ts`: full happy path on a scratch project, one MINOR review loop (verify concerns injected + rotation), one clean review (verify auto-advance), one approve with a planted `{{placeholder}}` (verify hard block)

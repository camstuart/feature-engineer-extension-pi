# Design — Fix Review Loop and Quality Gates

## Context

The extension's architecture is sound: orchestrator-owned gates, one fresh Pi session per skill, deterministic QA retry in impl-builder. The defects are all in loop mechanics (review findings never flow back into the workflow) and in gates that exist only as prompt text. This change keeps the architecture and closes those gaps, following the existing pattern of "the orchestrator is authoritative for anything deterministic; the LLM is used only for judgment".

## Goals / Non-Goals

**Goals**

- Make the review cycle converge: findings reach the fixer, each cycle starts from a clean slate, and a clean review exits the loop automatically.
- Convert prompt-side promises into orchestrator-enforced checks where the check is deterministic.
- Correct the branch lifecycle so implementation commits land on a feature branch.
- Reduce interaction fatigue without removing any human decision that matters.

**Non-Goals**

- No changes to the rate-limit gate, template seeding, persistence format (beyond additive fields), or the `/feature` command surface.
- No per-project template overrides (stays in Future Work).
- No attempt to make the orchestrator parse free-form prose in config files beyond the single structured `Branch pattern:` line.

## Decisions

### D1 — Concerns feed the fix skill via a dedicated prompt block, not `rejectionFeedback`

When the severity gate routes to `tech-design` or `impl-builder`, the orchestrator reads the current concerns file, filters to the sections relevant to the route (`[ARCH]`-tagged concerns for tech-design, `[MINOR]` for impl-builder — plus all concerns as context), and passes it as a new `reviewConcerns` prompt input rendered as a `## Review Concerns To Address` block. `rejectionFeedback` stays reserved for human `/feature reject` text so the two feedback channels remain distinguishable in prompts and tests.

For impl-builder, the concerns block replaces "Begin with Task 1" framing: when `reviewConcerns` is present the prompt instructs the model to address the listed concerns against the existing implementation rather than re-executing the plan from scratch.

### D2 — Concerns file rotation per review cycle

At the start of each `review-completion` run, if `06-review-concerns-to-address.md` exists it is renamed to `06-review-concerns.v<N>.md` (N = 1, 2, …, first unused). The active filename is always the unversioned one; rotated files provide the audit trail. `summariseConcerns` and the gate only ever read the active file.

Alternative considered: truncating in place. Rejected — loses the history that makes multi-cycle reviews auditable, at near-zero extra cost.

### D3 — Lazy per-pass prompt construction

`IntermediateStep.prompt` gains a lazy variant: `string | (() => string)`. The runner resolves it immediately before sending each step. `runReviewCompletion` builds pass 2–5 prompts inside closures that call `readConcernsFile` at resolution time. This is a additive change to `runner.ts` — existing string-valued steps behave exactly as before.

### D4 — Five review passes; git strategy checked deterministically

Passes: `requirements-coverage` (absorbs actors-coverage — its question now explicitly includes per-actor story coverage), `file-structure`, `tech-stack`, `engineering-principles`, `architecture-conformance`. The `static-qa` pass is deleted outright: the orchestrator already refuses to leave impl-builder while QA is red, so an LLM re-check adds noise, not safety.

Git-strategy checking moves to a new `git-checks.ts` module run by the orchestrator after the LLM passes complete: current branch name matched against the configured pattern, and each feature-branch commit subject matched against a commit-format regex when one can be derived from the config (see D7). Failures are appended to the concerns file under `## Git Strategy` tagged `[MINOR]`, so they flow through the same gate as LLM findings.

### D5 — Single `[ARCH]`/`[MINOR]` taxonomy with orchestrator recommendation

Concern format becomes `- [ARCH|MINOR] <observation> → <suggested fix>`. The orchestrator parses the active concerns file with a tolerant regex (`^[-*]\s*\[(ARCH|MINOR)\]`), and the severity gate presents a recommendation: any `[ARCH]` concern → recommend "ARCHITECTURAL (tech-design)", otherwise "MINOR (impl-builder)". The user can still override. Unparseable tagged lines are treated as `[MINOR]` and the gate mentions the count of untagged concerns rather than failing.

### D6 — Clean review auto-advances

After rotation-aware parsing, if zero concern lines exist (all sections empty or `- No concerns.`), the orchestrator emits a notify summarising "review clean — advancing to GitHub" and calls `advanceTo("github")` directly, skipping `review-concerns-gate`. The gate step remains in `FEATURE_STEPS` and is used whenever at least one concern exists. The prompt contradiction is resolved in favor of `- No concerns.` (explicit is machine-parseable and distinguishes "checked, nothing found" from "pass never ran").

### D7 — Structured `Branch pattern:` line; branch created before test-builder

`templates/config/git-strategy.md`'s Branch Strategy section gains a structured line the orchestrator can parse (same convention as `qa-static-tools.md`'s `Command:` lines):

```
Branch pattern: `feature/{slug}`
```

Supported substitutions: `{slug}`, `{id}`. When the line is missing or unparseable, the default is `feature/<slug>`. On approving `impl-planning` (i.e., before `test-builder` starts), the orchestrator runs `git checkout -b <branch>` (or checks it out if it already exists from a previous cycle; if the working tree is on that branch already, no-op). Failures surface via notify and park the workflow at the same step. The github skill's process drops branch creation and commit steps — it verifies commits exist, pushes, optionally opens a PR, and updates `features-index.md`.

A commit-format regex is *optionally* derivable from a similarly structured `Commit pattern:` line; when absent, the deterministic commit check in D4 only verifies commits exist on the branch (count > 0) and skips format validation.

### D8 — Approve gate validation

On `/feature approve` at a step for which `producesArtifact(step)` is true and an expected artifact path is known, the orchestrator checks the artifact file:

1. **Hard block** (notify + do not advance): file missing; contains `{{` placeholder markers; contains `<!-- AI:` comments.
2. **Soft warn** (ui.confirm to proceed anyway): one or more `##`-level headings present in the template are absent from the artifact. Optional-by-design sections (currently only `## Delta from Existing Architecture`) are excluded from the check via a small allowlist.

Automated skills keep their existing orchestrator verification (QA loop, and the new red-phase check) — the approve gate applies to the interactive artifact steps. With the deterministic check in place, `templatePopulationReminder` and the self-check block in `interactiveApprovalReminder` are reduced to a brief note, shrinking every interactive prompt.

### D9 — Red-phase verification after test-builder

After the test-builder session ends, the orchestrator runs the parsed test-runner command from `04-qa-static-tools.md`. Expected outcome: non-zero exit (tests fail because implementation doesn't exist). Zero exit means the LLM wrote passing tests (production code leaked in or tests are vacuous) → the orchestrator re-prompts once with that finding, then pauses with a notify if still green (mirroring the impl-builder pause UX, reusing a `testBuilderFailed`-style flag is not needed — a single retry then pause-with-notify keeps state simpler; the user re-runs `/feature` to retry). Type-check is also run and must pass (exit 0) so parse errors don't masquerade as red phase.

### D10 — UX adjustments

- `/feature reject` with no argument opens `ui.input("Rejection feedback:")` instead of erroring; cancel aborts the reject.
- Vague-mode discovery: STEPs 3–5 replace per-item `ui.confirm` with one synthesis + confirm per STEP round. STEP 8's final confirmation and the on-disk approval gate remain the real gates.

## Risks / Trade-offs

- **Placeholder false positives**: legitimate artifact content could contain `{{` (e.g. a feature about templating). Mitigation: the hard block message names the offending lines and the user can edit the file and re-approve; acceptable given the workflow's audience.
- **Branch creation timing** assumes a clean-enough working tree at impl-planning approval. `git checkout -b` fails loudly if not; the orchestrator surfaces the error and does not advance, which is the safe behavior.
- **Dropping BLOCKER/MAJOR/NIT** loses severity granularity within a route. The observation→fix text carries that nuance; routing only ever had two targets, so the taxonomy now matches reality.
- **Merged requirements/actors pass** slightly increases single-pass prompt size (two files were already both loaded); acceptable against saving three full sessions per cycle.

## Migration

No persisted-state migration needed: new `FeatureState` fields are optional and absent in old states; old `06-review-concerns-to-address.md` files are simply rotated on the next review run. Old-format concern tags (`[MAJOR]` etc.) in rotated files are never re-parsed. Users who customised the global `git-strategy.md` template won't have `Branch pattern:` — the `feature/<slug>` default covers them.

## Open Questions

None — all decision points were resolved with the user (2026-07-05): consolidate to 5 passes, auto-advance on clean review, single `[ARCH]`/`[MINOR]` taxonomy, single openspec change.

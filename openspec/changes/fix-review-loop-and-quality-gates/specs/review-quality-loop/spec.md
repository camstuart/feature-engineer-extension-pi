# review-quality-loop Specification

## ADDED Requirements

### Requirement: Review concerns are injected into the routed fix skill

When the severity gate routes the workflow to `tech-design` or `impl-builder`, the orchestrator SHALL read the active `06-review-concerns-to-address.md` and pass its concern content to the routed skill as a dedicated `reviewConcerns` prompt input, rendered as a `## Review Concerns To Address` block. The `rejectionFeedback` channel SHALL remain reserved for human `/feature reject` text.

#### Scenario: MINOR route feeds impl-builder

- **WHEN** the user selects the MINOR route at the severity gate
- **THEN** the next impl-builder session's prompt contains the concerns from the active concerns file
- **AND** the prompt instructs the model to address the listed concerns against the existing implementation rather than re-executing the plan from Task 1

#### Scenario: ARCHITECTURAL route feeds tech-design

- **WHEN** the user selects the ARCHITECTURAL route at the severity gate
- **THEN** the next tech-design session's prompt (both phases' shared inputs) contains the concerns from the active concerns file alongside the existing-architecture baseline

#### Scenario: Human rejection feedback remains distinct

- **WHEN** a skill re-runs due to `/feature reject <feedback>` and no review cycle is active
- **THEN** the prompt contains the feedback under `## Revision Feedback` and contains no `## Review Concerns To Address` block

### Requirement: Concerns file rotates per review cycle

At the start of each `review-completion` run, an existing `06-review-concerns-to-address.md` SHALL be renamed to `06-review-concerns.v<N>.md`, where N is the lowest positive integer not already used in the feature directory. The review passes SHALL write to a fresh unversioned file, and all downstream parsing (gate summary, severity recommendation, routing) SHALL read only the unversioned file.

#### Scenario: Second review cycle starts clean

- **WHEN** review-completion runs after a MINOR fix loop and a concerns file from the previous cycle exists
- **THEN** the previous file is preserved as `06-review-concerns.v1.md`
- **AND** the new cycle's passes append only to a newly created `06-review-concerns-to-address.md`
- **AND** the gate summary counts only the new cycle's concerns

#### Scenario: First review cycle has nothing to rotate

- **WHEN** review-completion runs and no concerns file exists
- **THEN** no rotation occurs and pass 1 creates the file from the template

### Requirement: Prior concerns are read at pass execution time

The prompt for each review pass after the first SHALL include the concerns file content as it exists immediately before that pass is sent, not as it existed when the review session was set up. The skill-session runner SHALL support lazy prompt construction (`string | (() => string)`) for intermediate steps to enable this.

#### Scenario: Pass 2 sees pass 1's findings

- **WHEN** pass 1 has appended concerns to the concerns file and pass 2's prompt is built
- **THEN** pass 2's prompt contains those concerns under the prior-concerns block

#### Scenario: Existing string prompts unaffected

- **WHEN** an intermediate step is defined with a plain string prompt (e.g. tech-design phase 2)
- **THEN** the runner sends it unchanged, preserving current behavior

### Requirement: Review runs five LLM passes

The review SHALL consist of exactly five LLM passes: `requirements-coverage` (which SHALL explicitly include per-actor user-story coverage, absorbing the former `actors-coverage` pass), `file-structure`, `tech-stack`, `engineering-principles`, and `architecture-conformance`. There SHALL be no `static-qa` LLM pass.

#### Scenario: Merged coverage pass checks actors

- **WHEN** the requirements-coverage pass runs
- **THEN** its prompt includes both `01-actors.md` and `01-requirement.md` and instructs cross-referencing every requirement AND every actor's user stories against the implementation

#### Scenario: No LLM pass re-checks static QA

- **WHEN** a full review cycle completes
- **THEN** no LLM session was prompted to verify static QA tool results (the orchestrator's impl-builder QA gate is authoritative)

### Requirement: Git strategy is checked deterministically

After the LLM passes complete, the orchestrator SHALL run deterministic git checks: (a) the current branch name matches the configured branch pattern, and (b) at least one commit exists on the feature branch; when a structured `Commit pattern:` line is parseable from `06-git-strategy.md`, commit subjects SHALL additionally be matched against it. Failures SHALL be appended to the active concerns file under `## Git Strategy` tagged `[MINOR]`.

#### Scenario: Branch name mismatch is recorded

- **WHEN** the configured pattern is `feature/{slug}` and the current branch is `main`
- **THEN** a `[MINOR]` concern describing the mismatch is appended under `## Git Strategy` before the gate is evaluated

#### Scenario: No commit pattern configured

- **WHEN** `06-git-strategy.md` contains no parseable `Commit pattern:` line
- **THEN** commit-subject format validation is skipped and only branch-name and commit-existence checks run

### Requirement: Single ARCH/MINOR concern taxonomy with parsed recommendation

Each concern SHALL be formatted as `- [ARCH|MINOR] <observation> → <suggested fix>`. The orchestrator SHALL parse concern tags from the active concerns file and pre-select a recommendation at the severity gate: if any `[ARCH]` concern exists, recommend the ARCHITECTURAL route; otherwise recommend MINOR. Bulleted concern lines without a parseable tag SHALL be treated as `[MINOR]` and the gate SHALL report their count.

#### Scenario: ARCH concern drives recommendation

- **WHEN** the concerns file contains one `[ARCH]` and three `[MINOR]` concerns
- **THEN** the severity gate presents ARCHITECTURAL as the recommended option while still allowing the user to choose MINOR

#### Scenario: Untagged concerns degrade gracefully

- **WHEN** a concern line reads `- The error message is unclear → reword it`
- **THEN** it is counted as `[MINOR]` and the gate notes one untagged concern

#### Scenario: Legacy tags are not emitted

- **WHEN** any review pass prompt or template is rendered
- **THEN** it references only the `[ARCH]` and `[MINOR]` tags (no `BLOCKER`, `MAJOR`, or `NIT`)

### Requirement: Clean review auto-advances to GitHub

When, after all passes and deterministic checks, the active concerns file contains zero concern lines (every section is empty or contains only `- No concerns.`), the orchestrator SHALL notify the user that the review is clean and advance directly to the `github` step without presenting the review-concerns gate. The gate SHALL be presented whenever at least one concern exists.

#### Scenario: Clean review skips the gate

- **WHEN** all five passes write `- No concerns.` and the git checks pass
- **THEN** the user sees a "review clean" notification and the workflow advances to `github` with no selection prompt

#### Scenario: Concerns still gate

- **WHEN** any pass records a concrete concern
- **THEN** the review-concerns gate is shown with the concern count and the parsed severity recommendation

### Requirement: No-concerns reporting is explicit

Review pass prompts SHALL instruct exactly one convention for empty findings: append `- No concerns.` under the pass's heading. The contradictory "leave the heading body empty" instruction SHALL be removed, and the review prompt's "What Happens Next" section SHALL describe the actual routing (clean → auto-advance to GitHub; concerns → user gate with recommendation).

#### Scenario: Consistent empty-section convention

- **WHEN** a pass finds nothing in its area
- **THEN** the prompt's only stated convention is the `- No concerns.` line

#### Scenario: Prompt describes real routing

- **WHEN** the "What Happens Next" section of any pass prompt is rendered
- **THEN** it states that a clean review auto-advances and that concerns lead to a user gate — not that the orchestrator auto-decides between github and severity from file content

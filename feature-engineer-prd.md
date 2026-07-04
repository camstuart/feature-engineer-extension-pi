# Feature Engineer Extension — Product Requirements Document

**Version:** 1.0  
**Status:** Draft  
**Extension ID:** feature-engineer  
**Target Platform:** Pi Coding Agent

---

## 1. Overview

Feature Engineer is a project-local Pi extension that orchestrates a structured, spec-driven feature development workflow. It assembles a series of discrete skills into a sequential pipeline — from requirements gathering through to git commit — with user approval gates at each design phase and aggressive context management to keep the LLM context window minimal throughout.

Users configure the extension by editing a set of markdown template files that define the expected structure of each generated document. When a skill runs, it reads its template and populates it with feature-specific content. This makes the output structure entirely customisable without modifying the extension code.

---

## 2. Problem Statement

Engineering teams building on top of AI coding agents often encounter two compounding problems:

1. **Context bloat.** Long-running agentic sessions accumulate conversation history, tool results, and intermediate reasoning that inflates the context window. Later steps in a workflow pay a high token cost for information only early steps needed.

2. **Unstructured output.** Without a defined spec-to-code pipeline, AI agents jump between requirements, design, and implementation in an uncontrolled way. Quality gates are ad-hoc and easy to skip.

Feature Engineer solves both by making each skill atomic and replayable — each runs in a fresh Pi session reading only the files it needs — and by enforcing user approval before any phase transitions.

---

## 3. Goals

- Provide a `/feature` command that orchestrates the full feature development lifecycle
- Keep every skill session context-minimal: reads only required files, clears after writing output
- Give users approval control at every design phase before downstream work begins
- Make all generated document structures customisable via editable template files
- Support both new feature creation and modification of previously engineered features
- Produce a persistent feature index so past features can be resumed and modified
- Produce atomic, replayable steps — any step can be re-run independently without side effects

## 4. Non-Goals

- Not a general-purpose project management tool
- Does not manage branching strategy beyond following the user's git-strategy.md
- Does not integrate with external issue trackers (Jira, Linear, etc.) in v1
- Does not support multi-agent parallelism across skills
- Does not manage environment setup, CI/CD, or deployment

---

## 5. User Personas

**Solo Developer / Indie Founder**  
Wants structured, high-quality feature development without a team. Uses the extension to enforce discipline on their own process and maintain a spec record for each feature.

**Engineering Lead**  
Sets up the project templates once to encode team standards. All features produced by the team follow the same structure, with the same QA gates applied consistently.

**Agent-First Developer**  
Builds with a spec-driven, agent-executed philosophy. Treats the markdown artifacts produced by each skill as the primary build artifact. Uses the extension as the primary interface between human intent and agent execution.

---

## 6. Core Concepts

### 6.1 Skills

A skill is a single atomic step in the workflow. Each skill:
- Runs in a fresh Pi session (cleared context)
- Reads a defined, minimal set of input files
- Produces a single output markdown file (or code files for Builder skills)
- For interactive skills: generates a draft, then enters review mode for user editing
- Clears context after its output is written

### 6.2 Templates

Templates define the structure of each skill's output document. They are markdown files with section headers and `<!-- AI: instruction -->` comments that guide the LLM on what to populate.

Templates live **globally** at `~/.pi/agent/feature-engineer/templates/` (NOT inside the project). On first run the extension seeds the bundled defaults into that directory; from then on the user's edits are the source of truth and are shared across every project they touch. Template changes affect all future features without requiring any extension code changes.

Two template categories (both under the global directory):
- **Config templates** (`templates/config/`): Structure for project-wide config files written by Analyse Codebase SKILL
- **Artifact templates** (`templates/artifacts/`): Structure for per-feature documents written by design/planning skills

The bundled defaults ship inside the installed extension package and are copied to the global directory only when a template file is absent there — user edits are never overwritten.

### 6.3 Feature Directory

Each feature gets a directory at:
```
.feature-engineer/feature-<SEQUENCE_NUMBER>-<SLUG>/
```

All artifacts produced for that feature live there. The sequence number is a zero-padded integer (e.g., `001`), and the slug is a lowercase hyphenated name derived from the feature title.

### 6.4 Approval Gates

Five approval gates exist — one after each design phase plus one after review completion:
1. Requirements Approved?
2. Architecture Approved?
3. Test Plan Approved?
4. Implementation Plan Approved?
5. Review Concerns? (after Review Completion — human confirms whether to address concerns or skip to GitHub)

At the first four gates, the user reviews the generated document and either approves (advancing to the next skill) or rejects with feedback (looping back to regenerate). Rejection feedback is passed as input to the next generation attempt.

At the Review Concerns gate, the user inspects `06-review-concerns-to-address.md` on disk and explicitly chooses between advancing to GitHub (no action needed) or proceeding to the Concern Severity classification. The orchestrator does not auto-decide this branch.

### 6.5 Concern Severity

After Review Completion, any concerns are classified:
- **ARCHITECTURAL**: requires re-running from Technical Design onward
- **MINOR**: requires re-running from Implementation Builder only

---

## 7. Template System

### 7.1 Config Templates

These define the structure of project-wide configuration files written during `Analyse Codebase SKILL`. They are written once per project and updated as the project evolves.

| Template File (source) | Written to |
|---|---|
| `~/.pi/agent/feature-engineer/templates/config/actors.md` | `.feature-engineer/<N>-actors.md` |
| `~/.pi/agent/feature-engineer/templates/config/structure.md` | `.feature-engineer/<N>-structure.md` |
| `~/.pi/agent/feature-engineer/templates/config/tech-stack.md` | `.feature-engineer/<N>-tech-stack.md` |
| `~/.pi/agent/feature-engineer/templates/config/qa-static-tools.md` | `.feature-engineer/<N>-qa-static-tools.md` |
| `~/.pi/agent/feature-engineer/templates/config/qa-engineering.md` | `.feature-engineer/<N>-qa-engineering.md` |
| `~/.pi/agent/feature-engineer/templates/config/git-strategy.md` | `.feature-engineer/<N>-git-strategy.md` |

Templates live in the user's *global* directory. The "Written to" column shows per-project output filenames, which include a two-digit numeric prefix to make `ls` show files in generation order.

### 7.2 Artifact Templates

These define the structure of per-feature documents. Used each time a new feature is created or an existing one modified.

| Template File (source) | Written to |
|---|---|
| `~/.pi/agent/feature-engineer/templates/artifacts/requirement.md` | `.feature-engineer/feature-<N>-<SLUG>/<NN>-requirement.md` |
| `~/.pi/agent/feature-engineer/templates/artifacts/technical-architecture.md` | `.feature-engineer/feature-<N>-<SLUG>/<NN>-technical-architecture.md` |
| `~/.pi/agent/feature-engineer/templates/artifacts/technical-plan-testing.md` | `.feature-engineer/feature-<N>-<SLUG>/<NN>-technical-plan-testing.md` |
| `~/.pi/agent/feature-engineer/templates/artifacts/technical-plan-implementation.md` | `.feature-engineer/feature-<N>-<SLUG>/<NN>-technical-plan-implementation.md` |
| `~/.pi/agent/feature-engineer/templates/artifacts/review-concerns.md` | `.feature-engineer/feature-<N>-<SLUG>/<NN>-review-concerns-to-address.md` |

### 7.3 Template Format

Templates use two complementary mechanisms to guide the LLM:

**1. `<!-- AI: instruction -->` comments** — inline guidance the LLM follows and then removes:

```markdown
## User Stories
<!-- AI: Write one user story per relevant actor from actors.md.
Format: As a [actor], I want to [action] so that [benefit].
Include 2-3 acceptance criteria per story as a nested bullet list. -->
```

**2. `{{PLACEHOLDER}}` markers** — token-level scaffolding the LLM replaces with concrete content. Example from `requirement.md`:

```markdown
# Feature: {{FEATURE_NAME}}
**Feature ID:** {{FEATURE_ID}}
**Date:** {{DATE}}
```

`{{PLACEHOLDER}}` markers are used when a specific value will be substituted (e.g. the feature name, the date) or when a section template should be repeated (e.g. `### {{Component or Function Name}}` introduces one block per component in the test plan).

The bundled templates use the following placeholders:

| Placeholder | Used in | Meaning |
|---|---|---|
| `{{FEATURE_NAME}}` | requirement, technical-architecture, technical-plan-testing, technical-plan-implementation, review-concerns | The feature's display name (title case) |
| `{{FEATURE_ID}}` | requirement, technical-architecture, technical-plan-testing, technical-plan-implementation, review-concerns | The zero-padded feature ID (e.g. `003`) |
| `{{DATE}}` | requirement, review-concerns | Today's date in `YYYY-MM-DD` format |
| `{{VERSION}}` | technical-architecture | The version of `requirement.md` this architecture is based on (e.g. `1`) |
| `{{N}}` | technical-plan-implementation | The estimated number of tasks |
| `{{TEST_FRAMEWORK}}` | technical-plan-testing | The test framework (e.g. `vitest`, `bun test`) |
| `{{COVERAGE_THRESHOLD}}` | technical-plan-testing | The coverage target as a percentage number (e.g. `80`) |
| `{{Actor Name}}` | actors (config) | One section per actor — duplicated, one per actor |
| `{{Component or Function Name}}` | technical-plan-testing | One unit-test subsection per component |
| `{{Boundary or Service Name}}` | technical-plan-testing | One integration-test subsection per boundary |
| `{{User Story Name}}` | technical-plan-testing | One E2E-test subsection per user story |
| `{{test file path}}` / `{{test file path per structure.md}}` | technical-plan-testing | Path of the test file, per `02-structure.md` |
| `{{behaviour}}` | technical-plan-testing | The `it("should ...")` behaviour string |
| `{{Step}}` | technical-plan-testing | One E2E step description |
| `{{Task Title}}` | technical-plan-implementation | The task heading |
| `{{path}}` | technical-plan-implementation | The target file path for the task |
| `{{test name(s)}}` | technical-plan-implementation | The `it("...")` strings this task satisfies |
| `{{What to implement}}` | technical-plan-implementation | One-sentence task description |
| `{{Requirement}}` | requirement | A numbered functional requirement |
| `{{command}}` | qa-static-tools (config) | The shell command for a QA tool |
| `{{percentage}}` | qa-static-tools (config) | Coverage threshold percentage |
| `{{test command}}` / `{{type check command}}` / `{{lint command}}` / `{{format check command}}` | technical-plan-testing | The exact command for each static QA assertion |
| `{{threshold}}` | technical-plan-testing | The coverage assertion threshold (may equal `{{percentage}}`) |

The LLM is instructed (via the `templatePopulationReminder` block in every skill prompt) to:
- Replace every `{{placeholder}}` with concrete content.
- Remove every `<!-- AI: ... -->` comment once the guidance has been used.
- Keep every section header from the template — none may be deleted or left empty.

Users can:
- Add new sections to any template (they will be populated in all future features)
- Remove sections they don't need
- Change section names and restructure freely
- Add project-specific mandatory fields
- Add new `{{PLACEHOLDER}}` markers (the LLM will be told to replace them)
- Add new `<!-- AI: ... -->` comments (the LLM will be told to follow and then remove them)

---

## 8. File Structure

Per-project state lives under `.feature-engineer/` inside the user's working directory. Templates live globally under `~/.pi/agent/feature-engineer/` and are shared across all projects for the same user.

```
~/.pi/agent/feature-engineer/         (global, user-editable templates)
└── templates/
    ├── config/
    │   ├── actors.md
    │   ├── structure.md
    │   ├── tech-stack.md
    │   ├── qa-static-tools.md
    │   ├── qa-engineering.md
    │   └── git-strategy.md
    └── artifacts/
        ├── requirement.md
        ├── technical-architecture.md
        ├── technical-plan-testing.md
        ├── technical-plan-implementation.md
        └── review-concerns.md

.feature-engineer/                    (per-project, generated artifacts)
├── <N>-actors.md                      (written by Analyse Codebase SKILL)
├── <N>-structure.md
├── <N>-tech-stack.md
├── <N>-qa-static-tools.md
├── <N>-qa-engineering.md
├── <N>-git-strategy.md
├── features-index.md                  (written by GitHub SKILL on completion)
└── feature-<N>-<SLUG>/                (one directory per feature)
    ├── <NN>-requirement.md
    ├── <NN>-relevant-components.md    (intermediate, produced by Technical Design)
    ├── <NN>-technical-architecture.md
    ├── <NN>-technical-plan-testing.md
    ├── <NN>-technical-plan-implementation.md
    └── <NN>-review-concerns-to-address.md

.pi/
└── extensions/
    └── feature-engineer/
        ├── index.ts               (extension entry point)
        ├── skills/
        │   ├── analyse-codebase.ts
        │   ├── read-features.ts
        │   ├── requirement-gathering.ts
        │   ├── technical-design.ts
        │   ├── test-planning.ts
        │   ├── implementation-planning.ts
        │   ├── test-builder.ts
        │   ├── implementation-builder.ts
        │   ├── review-completion.ts
        │   ├── github.ts
        │   └── runner.ts          (shared session-orchestration glue)
        ├── prompts/               (skill prompt builders)
        │   ├── analyse-codebase.ts
        │   ├── common.ts
        │   ├── github.ts
        │   ├── impl-builder.ts
        │   ├── impl-planning.ts
        │   ├── req-gathering.ts
        │   ├── review-completion.ts
        │   ├── tech-design.ts
        │   ├── test-builder.ts
        │   └── test-planning.ts
        ├── state.ts               (state types and step names)
        ├── paths.ts               (path/naming helpers, numeric prefix)
        ├── routing.ts             (subcommand parse, severity routing)
        ├── persistence.ts         (fe-state serialisation)
        ├── files.ts               (readContextFiles, listExistingFeatures)
        ├── init.ts                (checkInitialisation)
        ├── seeding.ts             (template seeding)
        ├── features-index.ts      (features-index.md parse/format)
        ├── qa.ts                  (qa-static-tools.md parse + runner)
        ├── rate-limit.ts          (provider rate-limit gate)
        ├── dates.ts
        └── version.ts
```

---

## 9. Skills Reference

### 9.1 Analyse Codebase SKILL
**Trigger:** `/feature` command when config files are absent or incomplete  
**Context:** Reads README.md, CLAUDE.md, AGENTS.md, PRD.md and scans codebase as needed  
**Output:** Six config files in `.feature-engineer/`, each populated from its config template  
**Interactive:** Yes — asks user to confirm and fill gaps  
**Session cleared after:** All six files written  

### 9.2 Read Features SKILL
**Trigger:** User selects EXISTING at the New/Existing gate  
**Context:** Directory listing only + first line of each existing requirement.md  
**Output:** Selected feature identifier (sequence number + slug)  
**Interactive:** Yes — presents list, user selects  
**Session cleared after:** Selection confirmed  
**Implementation:** Inline orchestrator step (not a fresh session). The
selection data is a directory listing + first lines of requirement.md — no
LLM work is needed, so the step runs as a `ctx.ui.select` in the
parent session rather than spinning up a new Pi session. Keeping it
inline is more efficient (no session overhead, no per-feature context
loaded for what is essentially a UI presentation) and keeps the parent
session in flow. The selection logic lives in its own module
(`skills/read-features.ts`) so it is independently testable and the
`handleNewOrExisting` orchestrator stays focused on the
NEW-vs-EXISTING branching.

### 9.3 Requirement Gathering SKILL
**Trigger:** New or Existing feature path merges here  
**Reads:** `actors.md` + existing `requirement.md` (EXISTING path only)  
**Template:** `templates/artifacts/requirement.md`  
**Output:** `.feature-engineer/feature-<N>-<SLUG>/requirement.md`  
**Phase 1:** Auto-generate draft from template  
**Phase 2:** Interactive review and editing  
**Gate:** Requirements Approved?  

### 9.4 Technical Design SKILL
**Reads:** `requirement.md`, `structure.md`, `tech-stack.md`, `qa-engineering.md`, existing `technical-architecture.md` (EXISTING only)  
**Intermediate:** Codebase scan → `relevant-components.md` → compact → read summary  
**Template:** `templates/artifacts/technical-architecture.md`  
**Output:** `technical-architecture.md`, `relevant-components.md`  
**Phase 1:** Auto-generate architecture draft  
**Phase 2:** Interactive review and editing  
**Gate:** Architecture Approved?  

### 9.5 Testing and QA Planning SKILL
**Reads:** `requirement.md`, `technical-architecture.md`, `structure.md`, `tech-stack.md`, `qa-static-tools.md`, `qa-engineering.md`  
**Template:** `templates/artifacts/technical-plan-testing.md`  
**Output:** `technical-plan-testing.md`  
**Phase 1:** Auto-generate test plan  
**Phase 2:** Interactive review  
**Gate:** Test Plan Approved?  

### 9.6 Implementation Planning SKILL
**Reads:** `requirement.md`, `technical-architecture.md`, `technical-plan-testing.md`, `structure.md`, `qa-engineering.md`, `git-strategy.md`  
**Template:** `templates/artifacts/technical-plan-implementation.md`  
**Output:** `technical-plan-implementation.md`  
**Phase 1:** Auto-generate ordered task list  
**Phase 2:** Interactive review  
**Gate:** Implementation Plan Approved?  

### 9.7 Test Builder SKILL
**Reads:** `technical-architecture.md`, `technical-plan-testing.md`, `technical-plan-implementation.md`, `structure.md`, `tech-stack.md`, `qa-static-tools.md`  
**Output:** Test files in locations per `structure.md`  
**Automated:** Tests written to fail initially (red phase of TDD). Static validation run after.  
**Compaction:** Single-shot skill. The orchestrator runs `ctx.compact()` with custom instructions summarising the test files written after the LLM ends its turn and before the session transitions to Implementation Builder. Satisfies §11 rule 6.  
**Session cleared after:** All test files written and syntax-validated  

### 9.8 Implementation Builder SKILL
**Reads:** `technical-architecture.md`, `technical-plan-testing.md`, `technical-plan-implementation.md`, `structure.md`, `tech-stack.md`, `qa-static-tools.md`, `qa-engineering.md`  
**Output:** Implementation code in locations per `structure.md`  
**Automated:** Executes tasks from implementation plan in order. Runs all QA tools after each task.  
**Orchestrator-driven QA retry loop:** After each attempt, the orchestrator itself runs the QA suite (parsed from `04-qa-static-tools.md`) and decides what to do. If everything passes, the orchestrator advances to Review Completion. If anything fails and there are retries left, the orchestrator starts a fresh session with a retry prompt that includes the failure output (truncated to 4 KB) and a re-injection of the implementation plan. **Max 3 total attempts** (1 initial + up to 2 retries). After the 3rd failed attempt, the orchestrator surfaces the failure to the user and does NOT auto-advance — the workflow pauses so the user can review the plan, edit it, and `/feature reject` to retry from the planning step, or `/feature approve` to retry the impl as-is.  
**Why orchestrator-driven and not LLM-driven:** The prior design asked the LLM to run QA and self-report pass/fail. The failure mode was an LLM declaring DONE when the suite was red. Running QA in the orchestrator (which has access to `execFileSync` and the user's authoritative `04-qa-static-tools.md`) makes the loop deterministic and the failure output parseable.  
**Compaction:** Single-shot per attempt. The orchestrator runs `ctx.compact()` with custom instructions summarising the completed tasks, commit hashes, and QA result after the LLM ends its final turn. Each retry attempt is a fresh session (no context carry-over), so the per-attempt compaction is most useful for the final successful attempt before transitioning to Review Completion.  
**Session cleared after:** All tasks complete and all QA tools passing  

### 9.9 Review Completion SKILL
**Process:** Runs 8 review passes in a single Pi session with deterministic compactions BETWEEN passes. The LLM is not trusted to call `ctx.compact` itself; the orchestrator's runner drives the compactions (see §11 rule 6):  
1. Actors → user story coverage  
2. Structure → file placement  
3. Tech stack → library usage  
4. QA static tools → tool results and coverage  
5. QA engineering → principles adherence  
6. Git strategy → commit quality  
7. Requirements → implementation completeness  
8. Architecture → design conformance  
**Why a single session, not 8 micro-sessions:** The earlier design called for "8 isolated review passes, each with a fresh context load" and "8 micro-sessions". Spinning up a fresh session per pass adds overhead (session name, `fe-state` entry, system prompt, beforeStart hook) for what is essentially a compact + new prompt. A single session with deterministic inter-pass compaction gives the same isolation guarantee (each pass sees a compacted summary, not the full history) at a fraction of the cost.  
**Output:** `06-review-concerns-to-address.md` (populated from template)  
**Compaction:** Pass 1 runs as the initial prompt. Passes 2-8 run as `intermediateSteps` driven by the runner; the runner compacts after every intermediate step EXCEPT the last, so the LLM starts each subsequent pass with a compacted summary of the prior pass's work. After pass 8 finishes, the runner runs one final compaction via `finalCompactInstructions` before the session transitions to the human-in-the-loop Review Concerns gate. Total: **6 inter-pass compactions** (after pass 2, 3, 4, 5, 6, 7 — preparing for pass 3, 4, 5, 6, 7, 8) **+ 1 final compaction** (after pass 8) = 7 compactions.  
**Gate:** Review Concerns? → if YES: Concern Severity? — this is a **human-in-the-loop** gate; the orchestrator does NOT auto-decide based on file content.  

### 9.10 GitHub SKILL
**Reads:** `git-strategy.md`, `requirement.md`  
**Output:** Git commit/branch/PR per strategy; updates `features-index.md`  
**Automated:** Follows git-strategy.md exactly  
**Compaction:** Single-shot skill. The orchestrator runs `ctx.compact()` with custom instructions summarising the branch name, commit hashes, and PR URL after the LLM ends its turn and before the workflow is marked complete. Satisfies §11 rule 6.  
**Session cleared after:** Commit confirmed  

---

## 10. Flow Description

```
/feature
  │
  ├─ Codebase initialised? 
  │    NO → Analyse Codebase SKILL
  │    YES ──────────────────────────────────┐
  │                                          ▼
  ├─ New or Existing Feature?
  │    EXISTING → Read Features SKILL ──┐
  │    NEW ──────────────────────────── ▼
  │                                  Requirement Gathering SKILL
  │                                          │
  │                                   [Requirements Approved?]
  │                               NO ←───── │ ──────→ YES
  │                                          ▼
  │                               Technical Design SKILL
  │                                          │
  │                                  [Architecture Approved?]
  │                               NO ←───── │ ──────→ YES
  │                                          ▼
  │                           Testing & QA Planning SKILL
  │                                          │
  │                                  [Test Plan Approved?]
  │                               NO ←───── │ ──────→ YES
  │                                          ▼
  │                           Implementation Planning SKILL
  │                                          │
  │                                 [Impl Plan Approved?]
  │                               NO ←───── │ ──────→ YES
  │                                          ▼
  │                               Test Builder SKILL
  │                                          │
  │                            Implementation Builder SKILL
  │                                          │
  │                             Review Completion SKILL
  │                                          │
  │                                 [Review Concerns?]    (human gate — user reviews file)
  │                                    NO ──────→ GitHub SKILL → DONE
  │                                    YES
  │                                     │
  │                              [Concern Severity?]
  │                        ARCHITECTURAL ─→ back to Technical Design
  │                        MINOR ─────────→ back to Implementation Builder
```

---

## 11. Context Management Strategy

The extension's primary engineering constraint is minimal context window usage. Key rules:

**1. One skill, one session.** Each skill runs in a dedicated Pi session. No skill inherits the conversation history of a previous skill.

**2. File-based handoffs.** The output of each skill is a file on disk. The next skill reads that file cold. No in-memory passing of content between sessions.

**3. Approve gates load only one file.** Each approval gate reads only the document being approved — no accumulation of context.

**4. Intermediate scan results are ephemeral.** The Technical Design SKILL codebase scan writes `relevant-components.md` and then immediately compacts before reading it back as a summary. The raw scan output is never in context alongside the architecture document.

**5. Review Completion runs 8 passes in a single session** with deterministic compaction BETWEEN passes. Each pass sees the previous concerns file as background context but a compacted summary of the prior pass's work. `review-concerns-to-address.md` is written incrementally — one append per pass. A final compaction runs after the 8th pass before the session transitions to the human-in-the-loop Review Concerns gate.

**6. Pi's `ctx.compact()` is called explicitly** after each automated step's output is written, before the session transitions. The runner exposes this as a `finalCompactInstructions` option on `startSkillSession`:
  - **Multi-step skills** (`tech-design`, `review-completion`): the final compaction fires AFTER the last intermediate step.
  - **Single-shot automated skills** (`test-builder`, `impl-builder`, `github`): the final compaction fires AFTER the LLM's only turn (post-`waitForIdle`) but BEFORE the orchestrator's `onComplete` callback runs.
  - **Interactive skills** (`req-gathering`, `tech-design` phase 2, `test-planning`, `impl-planning`, `analyse-codebase`): do NOT set `finalCompactInstructions` — the user is the one working in the session, and the orchestrator must not compact their workspace. The user advances by typing `/feature approve`.

---

## 12. Pi Extension API Requirements

| Capability | Pi API |
|---|---|
| Register `/feature` command (with subcommands `approve`, `reject <feedback>`, `status`) | `pi.registerCommand("feature", ...)` |
| Create new skill session | `ctx.newSession({ setup, withSession })` |
| Compact context within session | `ctx.compact()` |
| Persist workflow state | `sm.appendCustomEntry("fe-state", state)` (inside the new session's `setup` callback) |
| Restore state on reload | `pi.on("session_start", ...)` |
| Inject skill context | `pi.on("before_agent_start", ...)` |
| User selection | `ctx.ui.select(...)` |
| User confirmation | `ctx.ui.confirm(...)` |
| User input | `ctx.ui.input(...)` |
| Notify user | `ctx.ui.notify(...)` |
| Run shell commands | `execFileSync` / `ctx.sessionManager` (depending on context) |
| Wait for LLM to finish | `ctx.waitForIdle()` |
| Session naming | `sm.appendSessionInfo(name)` (inside `setup`) |

The extension exposes a single user-facing command: `/feature`. Approval and rejection are subcommands (`/feature approve`, `/feature reject <feedback>`), and `/feature status` shows the current workflow position. There are no separate `/fe-approve` or `/fe-reject` commands.

---

## 13. Success Criteria

- `/feature` successfully orchestrates a full new feature from requirements to git commit
- Each skill session context window stays below 20k tokens (excluding code being written)
- All approval gates require explicit user action before advancing
- Re-running any individual skill with the same input files produces a valid output
- Template changes take effect on the next skill invocation without requiring extension reload
- Existing feature modification correctly loads prior artifacts as baselines
- `features-index.md` is accurate after every completed workflow
- The extension loads cleanly in a project-local `.pi/extensions/` location

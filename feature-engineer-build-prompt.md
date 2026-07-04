# Build Prompt: Feature Engineer Pi Extension

You are building a Pi coding agent extension called **Feature Engineer**. Read this entire prompt before writing any code.

---

## Reference

Pi extension docs: https://pi.dev/docs/latest/extensions  
Pi compaction docs: https://pi.dev/docs/latest/compaction  
Pi sessions docs: https://pi.dev/docs/latest/sessions

The extension is TypeScript, loaded via jiti (no compilation needed). Place it at `.pi/extensions/feature-engineer/index.ts`.

---

## What You Are Building

A `/feature` command that orchestrates a structured, spec-driven feature development workflow across multiple Pi sessions. Each session is atomic and context-minimal. The user gets approval gates at every design phase. All document structures are driven by user-editable markdown templates.

**Key constraint:** Every skill runs in its own Pi session. No skill inherits conversation history from a previous skill. Context is cleared after every output is written. This is the primary engineering goal.

---

## Pi Extension API — Key Methods You Will Use

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function(pi: ExtensionAPI) {

  // Register commands (called via /command-name in chat)
  pi.registerCommand("feature", {
    description: "Start the Feature Engineer workflow",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();           // wait for any active agent to finish
      
      // Create a new isolated session for a skill:
      await ctx.newSession({
        setup: async (sm) => {
          // Inject minimal bootstrap into the new session before it starts
          sm.appendMessage({
            role: "user",
            content: [{ type: "text", text: "..." }],
            timestamp: Date.now(),
          });
        },
        withSession: async (newCtx) => {
          // newCtx is the REPLACEMENT session context — use ONLY this, not outer ctx or pi
          pi.setSessionName("Feature Engineer: Requirement Gathering");
          await newCtx.sendUserMessage(buildSkillPrompt(...));
          await newCtx.waitForIdle();
          // For interactive skills, just send the prompt and return — user stays in session
          // For automated skills, waitForIdle() then proceed to next step
        }
      });
    }
  });

  // Persist state across sessions (survives restart)
  pi.appendEntry("fe-state", { step: "req-gathering", featureId: 1, slug: "my-feature" });

  // Restore state on session start
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "fe-state") {
        currentState = entry.data;
      }
    }
  });

  // Inject skill context at the start of each agent turn
  pi.on("before_agent_start", async (event, ctx) => {
    if (!currentState) return;
    return {
      systemPrompt: event.systemPrompt + "\n\n" + buildSkillSystemContext(currentState, ctx.cwd)
    };
  });

  // User interaction
  const choice = await ctx.ui.select("Select:", ["Option A", "Option B"]);
  const confirmed = await ctx.ui.confirm("Title", "Are you sure?");
  const text = await ctx.ui.input("Label:", "placeholder");
  ctx.ui.notify("Done!", "info"); // "info" | "warning" | "error"

  // Run shell commands (for git operations, QA tools)
  const result = await pi.exec("git", ["status"], { signal: ctx.signal });
  // result.stdout, result.stderr, result.code

  // Compact context within a session
  ctx.compact({
    customInstructions: "Summarise only the output file path that was written",
    onComplete: () => ctx.ui.notify("Context compacted", "info"),
  });
}
```

---

## File Structure to Create

Create all of the following. Start by creating the directory structure, then populate each file.

```
.pi/extensions/feature-engineer/
├── index.ts                    # Extension entry point
├── state.ts                    # State types, persistence helpers
├── prompts.ts                  # Skill prompt builders (functions that return strings)
└── skills/
    ├── analyse-codebase.ts     # Analyse Codebase SKILL runner
    ├── read-features.ts        # Read Features SKILL runner
    ├── req-gathering.ts        # Requirement Gathering SKILL runner
    ├── tech-design.ts          # Technical Design SKILL runner
    ├── test-planning.ts        # Testing & QA Planning SKILL runner
    ├── impl-planning.ts        # Implementation Planning SKILL runner
    ├── test-builder.ts         # Test Builder SKILL runner
    ├── impl-builder.ts         # Implementation Builder SKILL runner
    ├── review-completion.ts    # Review Completion SKILL runner
    └── github.ts               # GitHub SKILL runner

.feature-engineer/
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
```

---

## Template File Contents

Create these template files exactly as shown. They are user-editable — the AI instructions inside guide LLM population but users can change structure freely.

### `.feature-engineer/templates/config/actors.md`

```markdown
# System Actors
<!-- AI: List each actor in the system who interacts with this product.
Actors are used to generate user stories. Be terse — one section per actor. -->

## {{Actor Name}}
<!-- AI: 1-2 sentences describing this actor's role, goals, and technical level -->

## {{Actor Name}}
<!-- AI: Add further actors as needed -->
```

### `.feature-engineer/templates/config/structure.md`

```markdown
# Project File Structure
<!-- AI: Document where things live in this codebase. Be specific about paths.
This file is read by Technical Design and Implementation to place files correctly. -->

## Source Layout
<!-- AI: Key directories and what they contain. Example:
- src/components/ — React UI components
- src/api/ — API client and service functions
- src/types/ — Shared TypeScript type definitions -->

## Test Layout
<!-- AI: Where tests live relative to source files. Specify naming conventions. -->

## Generated / Build Output
<!-- AI: Paths that should not be edited directly -->

## Configuration Files
<!-- AI: Location of env files, config files, build configs -->
```

### `.feature-engineer/templates/config/tech-stack.md`

```markdown
# Technology Stack
<!-- AI: Document the exact technologies in use. Be specific about versions where relevant. -->

## Runtime
<!-- AI: Language, runtime, key version constraints -->

## Frontend
<!-- AI: Framework, UI library, state management, styling approach -->

## Backend
<!-- AI: Framework, API style (REST/GraphQL/RPC), auth approach -->

## Data
<!-- AI: Database, ORM/query layer, caching -->

## Testing
<!-- AI: Test runner, assertion library, mocking approach, coverage tool -->

## Build & Tooling
<!-- AI: Bundler, transpiler, linter, formatter, type checker and their config file locations -->

## Key Libraries
<!-- AI: Important third-party dependencies and what they are used for -->
```

### `.feature-engineer/templates/config/qa-static-tools.md`

```markdown
# QA Static Tools
<!-- AI: List every deterministic QA tool with its exact command.
These commands are run by Implementation Builder after each task. -->

## Test Runner
<!-- AI: Command to run all tests. Example: `bun test` or `npx vitest run` -->
Command: `{{command}}`
Coverage threshold: {{percentage}}%

## Type Checker
<!-- AI: Command to run type checking. Example: `tsc --noEmit` -->
Command: `{{command}}`

## Linter
<!-- AI: Command to run the linter. Example: `eslint src/` -->
Command: `{{command}}`
Auto-fix command: `{{command}}`

## Formatter
<!-- AI: Command to check formatting. Example: `prettier --check src/` -->
Check command: `{{command}}`
Fix command: `{{command}}`

## Import Sorter
<!-- AI: If used, the command to sort imports -->
Command: `{{command}}`

## Build / Compile
<!-- AI: Command to compile or build the project and verify no errors -->
Command: `{{command}}`
```

### `.feature-engineer/templates/config/qa-engineering.md`

```markdown
# Engineering Quality Principles
<!-- AI: Document the engineering standards that all code must meet.
This file is read by Technical Design, Implementation Planning, and Review Completion. -->

## Component & Function Reuse
<!-- AI: Rules about when to create new vs reuse existing code.
Example: "Always check for existing utility functions before writing new ones." -->

## Coding Style
<!-- AI: Style conventions beyond what the linter enforces.
Example: "Prefer pure functions. Avoid classes unless required by the framework." -->

## Architecture Patterns
<!-- AI: Key architectural patterns in use.
Example: "Use repository pattern for data access. Business logic lives in service layer." -->

## Naming Conventions
<!-- AI: Naming rules for files, variables, functions, components, etc. -->

## Error Handling
<!-- AI: How errors should be handled and surfaced. -->

## Performance Considerations
<!-- AI: Any performance rules or constraints to respect. -->
```

### `.feature-engineer/templates/config/git-strategy.md`

```markdown
# Git Strategy
<!-- AI: Document the exact git conventions to follow. GitHub SKILL reads this file. -->

## Branch Strategy
<!-- AI: How branches are named and when to create them.
Example: "Feature branches: feature/<slug>. Branch from main. One branch per feature." -->

## Commit Format
<!-- AI: Commit message format with example.
Example: "feat(<scope>): <description>" — follow Conventional Commits. -->

## Commit Frequency
<!-- AI: When to commit. Example: "Commit after each logical group of tasks is QA-passing." -->

## Pull Request
<!-- AI: Whether to open a PR, PR title format, required reviewers, labels. -->

## Push Policy
<!-- AI: When to push. Example: "Push branch on feature completion before opening PR." -->
```

### `.feature-engineer/templates/artifacts/requirement.md`

```markdown
# Feature: {{FEATURE_NAME}}
<!-- AI: Replace with a clear, concise feature name in title case -->

**Feature ID:** {{FEATURE_ID}}
**Date:** {{DATE}}
**Status:** Draft

## Overview
<!-- AI: 2-4 sentences. What does this feature do? Why does it exist?
Avoid implementation detail — describe the user-facing outcome. -->

## Goals
<!-- AI: 3-6 bullet points describing what success looks like for this feature -->

## User Stories
<!-- AI: One user story per relevant actor from actors.md.
Format:
**As a** [actor], **I want to** [action] **so that** [benefit].
*Acceptance criteria:*
- [ ] Criterion 1
- [ ] Criterion 2
Repeat for each actor. Only include actors this feature touches. -->

## Functional Requirements
<!-- AI: Numbered list of specific, testable functional requirements.
Each requirement should map to at least one user story acceptance criterion. -->

1. {{Requirement}}

## Non-Functional Requirements
<!-- AI: Performance, security, accessibility, compatibility requirements.
Be specific where possible: "Response time < 200ms" not "must be fast." -->

## Out of Scope
<!-- AI: Explicitly list what this feature does NOT include.
This prevents scope creep in downstream design and implementation. -->

## Open Questions
<!-- AI: Any unknowns or decisions deferred to Technical Design -->
```

### `.feature-engineer/templates/artifacts/technical-architecture.md`

```markdown
# Technical Architecture: {{FEATURE_NAME}}

**Feature ID:** {{FEATURE_ID}}
**Based on:** requirement.md v{{VERSION}}

## Architecture Overview
<!-- AI: 2-3 sentences describing the overall technical approach -->

## Reused Components
<!-- AI: List components, functions, and modules from relevant-components.md that will be reused.
For each: component name, location, and how it will be used. -->

## New Components

### Frontend
<!-- AI: New UI components, pages, or views required.
For each: component name, location per structure.md, purpose, key props/state -->

### Backend
<!-- AI: New API endpoints, services, or workers required.
For each: endpoint/service name, HTTP method if applicable, input/output shape -->

### Data Structures
<!-- AI: New or modified types, interfaces, database schemas -->

### Data Persistence
<!-- AI: What gets stored, where, how (new tables, collections, keys, files) -->

## State Management
<!-- AI: How application state is managed for this feature -->

## Error & Loading States
<!-- AI: How errors and loading states are handled at each layer -->

## Security Considerations
<!-- AI: Authentication, authorisation, data validation, any sensitive data handling -->

## Delta from Existing Architecture
<!-- AI: For EXISTING features only — what changes vs the previous architecture.
For NEW features, remove this section. -->
```

### `.feature-engineer/templates/artifacts/technical-plan-testing.md`

```markdown
# Testing Plan: {{FEATURE_NAME}}

**Feature ID:** {{FEATURE_ID}}
**Test framework:** {{TEST_FRAMEWORK}}
**Coverage target:** {{COVERAGE_THRESHOLD}}%

## Unit Tests

### {{Component or Function Name}}
**File:** `{{test file path per structure.md}}`
<!-- AI: List each test case as: `it("should [behaviour]")` -->
- `it("should {{behaviour}}")`

## Integration Tests

### {{Boundary or Service Name}}
**File:** `{{test file path}}`
- `it("should {{behaviour}}")`

## End-to-End Tests
<!-- AI: One E2E flow per user story where E2E coverage adds value -->

### {{User Story Name}}
**File:** `{{test file path}}`
Steps:
1. {{Step}}

## Mock & Stub Strategy
<!-- AI: What external dependencies need mocking and how -->

## Static QA Assertions
<!-- AI: List the static QA commands that must pass (from qa-static-tools.md).
These are run by Implementation Builder after each task. -->

- [ ] `{{test command}}`
- [ ] `{{type check command}}`
- [ ] `{{lint command}}`
- [ ] `{{format check command}}`
- [ ] Coverage ≥ {{threshold}}%
```

### `.feature-engineer/templates/artifacts/technical-plan-implementation.md`

```markdown
# Implementation Plan: {{FEATURE_NAME}}

**Feature ID:** {{FEATURE_ID}}
**Estimated tasks:** {{N}}

## Prerequisites
<!-- AI: Any setup required before tasks begin (env vars, migrations, scaffolding) -->

## Tasks
<!-- AI: Ordered list of discrete, atomic implementation tasks.
Each task must:
- Be completable in isolation and verifiable by running QA tools
- Reference the target file(s) from structure.md
- Reference the test assertion(s) from technical-plan-testing.md that it satisfies
Format each task exactly as shown below. -->

### Task 1: {{Task Title}}
**Target file(s):** `{{path}}`
**Satisfies tests:** `{{test name(s)}}`
**Description:** {{What to implement}}

---

<!-- AI: Repeat the Task block above for each task. Order by dependency. -->

## Commit Checkpoints
<!-- AI: Which tasks should be grouped into commits, per git-strategy.md.
Example: "Commit after Task 3 (data layer complete), Task 7 (API complete), Task 12 (UI complete)." -->

## Rollback Notes
<!-- AI: Any tasks that are risky or irreversible, and how to undo them if needed -->
```

### `.feature-engineer/templates/artifacts/review-concerns.md`

```markdown
# Review Concerns: {{FEATURE_NAME}}

**Feature ID:** {{FEATURE_ID}}
**Review date:** {{DATE}}

## Actors Coverage
<!-- AI: Concerns about user story coverage. Leave empty if none. -->

## File Structure
<!-- AI: Concerns about file placement. Leave empty if none. -->

## Tech Stack Compliance
<!-- AI: Concerns about incorrect library or framework usage. Leave empty if none. -->

## Static QA
<!-- AI: Failed tools, unmet coverage thresholds. Leave empty if none. -->

## Engineering Principles
<!-- AI: Violations of qa-engineering.md principles. Leave empty if none. -->

## Git Strategy
<!-- AI: Commit quality or branching issues. Leave empty if none. -->

## Requirements Coverage
<!-- AI: Missing or incomplete requirement implementations. Leave empty if none. -->

## Architecture Conformance
<!-- AI: Divergences from technical-architecture.md. Leave empty if none. -->

## Summary
<!-- AI: Total concern count and recommended severity classification (ARCHITECTURAL or MINOR) -->
```

---

## Extension Architecture

### State Management (`state.ts`)

```typescript
export type FeatureStep =
  | "init-check"
  | "analyse-codebase"
  | "new-or-existing"
  | "read-features"
  | "req-gathering"
  | "req-approved"
  | "tech-design"
  | "arch-approved"
  | "test-planning"
  | "test-plan-approved"
  | "impl-planning"
  | "impl-plan-approved"
  | "test-builder"
  | "impl-builder"
  | "review-completion"
  | "review-concerns"
  | "concern-severity"
  | "github"
  | "done";

export interface FeatureState {
  featureId: number;      // Sequence number (1, 2, 3...)
  featureSlug: string;    // e.g. "user-authentication"
  featureDir: string;     // Full path to feature directory
  step: FeatureStep;
  rejectionFeedback?: string;  // Set by /fe-reject, read by next skill invocation
}
```

State is persisted via `pi.appendEntry("fe-state", state)` after every step transition. On `session_start`, iterate `ctx.sessionManager.getBranch()` to find the most recent `fe-state` entry and restore it.

### Commands to Register

| Command | Description | Handler behaviour |
|---|---|---|
| `/feature` | Start or resume Feature Engineer workflow | Check state; start from current step |
| `/fe-approve` | Approve current step and advance | Save state, call newSession() for next step |
| `/fe-reject [feedback]` | Reject with feedback and regenerate | Save feedback to state, re-run current skill |
| `/fe-status` | Show current workflow step and feature | Notify user of current state |

### Command Pattern

```typescript
pi.registerCommand("fe-approve", {
  description: "Approve the current Feature Engineer step and advance",
  handler: async (args, ctx) => {
    if (!currentState) {
      ctx.ui.notify("No active Feature Engineer workflow. Run /feature first.", "warning");
      return;
    }
    await ctx.waitForIdle();
    
    const nextStep = getNextStep(currentState.step);
    const nextState: FeatureState = { ...currentState, step: nextStep, rejectionFeedback: undefined };
    
    await ctx.newSession({
      setup: async (sm) => {
        // Persist state into new session immediately
        sm.appendCustomEntry("fe-state", nextState);
      },
      withSession: async (newCtx) => {
        currentState = nextState;
        pi.setSessionName(`Feature Engineer: ${stepDisplayName(nextStep)}`);
        await runStep(newCtx, nextState);
      }
    });
  }
});
```

### Skill Prompt Pattern

Each skill module exports a function `buildPrompt(state: FeatureState, cwd: string): string`. This function:
1. Reads the relevant template file
2. Reads the relevant input files
3. Builds a single string prompt that includes everything the LLM needs
4. Returns the prompt string

```typescript
// skills/req-gathering.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FeatureState } from "../state";

export async function runReqGathering(ctx: any, state: FeatureState) {
  const cwd = ctx.cwd;
  const feDir = state.featureDir;
  const feBase = join(cwd, ".feature-engineer");
  
  const template = readFileSync(join(feBase, "templates/artifacts/requirement.md"), "utf8");
  const actors = readFileSync(join(feBase, "actors.md"), "utf8");
  const existing = existsSync(join(feDir, "requirement.md"))
    ? readFileSync(join(feDir, "requirement.md"), "utf8")
    : null;
  
  const prompt = buildReqGatheringPrompt({ template, actors, existing, state });
  
  // For interactive skills: just send the prompt and return.
  // The user stays in session, reviews, edits, then types /fe-approve.
  await ctx.sendUserMessage(prompt);
  // Do NOT waitForIdle() here — user needs to interact.
}

function buildReqGatheringPrompt({ template, actors, existing, state }: any): string {
  const isExisting = existing !== null;
  const feedback = state.rejectionFeedback ? `\n\n## Revision Feedback\n${state.rejectionFeedback}` : "";
  
  return [
    `# Requirement Gathering — Feature ${state.featureId}: ${state.featureSlug}`,
    "",
    isExisting
      ? "This is a **modification** of an existing feature. The existing requirement.md is provided as a baseline."
      : "This is a **new feature**. Gather requirements from the user through conversation.",
    "",
    "## Output Template",
    "Use the following template structure to generate the requirement.md file:",
    "",
    template,
    "",
    "## Actors Reference",
    actors,
    isExisting ? "\n## Existing Requirements (baseline)\n" + existing : "",
    feedback,
    "",
    "---",
    "",
    "**PHASE 1:** Based on the above, ask any clarifying questions you need, then generate a complete draft of `requirement.md` following the template structure exactly. Populate all sections with content specific to this feature.",
    "",
    `Write the completed file to: ${join(state.featureDir, "requirement.md")}`,
    "",
    "**PHASE 2:** Once the file is written, present its contents to the user and invite them to review, modify, or ask questions. Update the file with any agreed changes.",
    "",
    "When the user is satisfied, remind them to type `/fe-approve` to proceed to Technical Design, or `/fe-reject [feedback]` to revise.",
  ].filter(Boolean).join("\n");
}
```

### Session Naming

Name each session so the user knows where they are:
```typescript
pi.setSessionName(`FE [${state.featureSlug}] — ${stepDisplayName(state.step)}`);
```

---

## Skill Prompt Requirements

Each skill prompt must include:

1. **Header**: Feature ID, slug, and skill name
2. **Context files**: Read and inline their contents (do not rely on LLM to read them)
3. **Template**: The output template inlined in full
4. **Phase 1 instructions**: Generate the draft and write the file
5. **Phase 2 instructions** (interactive skills only): Review mode instructions
6. **Approval reminder** (interactive skills only): "Type /fe-approve to proceed or /fe-reject [feedback] to revise"

For **automated skills** (Test Builder, Implementation Builder, Review Completion, GitHub):
- Include all required file contents
- Include explicit step-by-step instructions
- Include QA commands to run (from qa-static-tools.md content)
- Do NOT include approval instructions — call `ctx.waitForIdle()` and advance automatically

---

## Initialisation Logic

When `/feature` is run:

1. Check if `.feature-engineer/` directory exists
2. Check if all six config files exist and are non-empty
3. If any are missing → start `Analyse Codebase SKILL` session
4. If all present → proceed to new session for `New or Existing Feature?`

The "New or Existing Feature?" decision is made via `ctx.ui.select()` before starting the skill session — it does not require a full LLM session.

```typescript
const choice = await ctx.ui.select("Feature type:", ["New feature", "Existing feature"]);
if (choice === "Existing feature") {
  await runReadFeatures(ctx, state);
} else {
  const slug = await ctx.ui.input("Feature name (slug):", "e.g. user-authentication");
  const featureId = getNextFeatureId(cwd);
  // ... set up state and start req-gathering session
}
```

---

## Review Completion — 8-Pass Pattern

Review Completion SKILL runs 8 sequential passes within one session. Each pass:
1. Uses `pi.sendUserMessage()` to ask a targeted review question
2. Waits via `ctx.waitForIdle()`
3. Uses `ctx.compact()` to clear context before the next pass

```typescript
const reviewPasses = [
  { area: "Actors Coverage", files: ["actors.md"], question: "Review the implementation against actors.md..." },
  { area: "File Structure", files: ["structure.md"], question: "Review file placement against structure.md..." },
  // ... 6 more passes
];

for (const pass of reviewPasses) {
  const prompt = buildReviewPassPrompt(pass, state, cwd);
  await ctx.sendUserMessage(prompt);
  await ctx.waitForIdle();
  
  ctx.compact({
    customInstructions: `Summarise only: concerns found for "${pass.area}" and the path of review-concerns-to-address.md`,
    onComplete: () => {},
  });
}
```

---

## Implementation Builder — Task Loop Pattern

```typescript
for (const task of tasks) {
  // Send task implementation prompt
  await ctx.sendUserMessage(buildTaskPrompt(task, state, cwd));
  await ctx.waitForIdle();
  
  // Run QA tools
  let qaPass = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const qaResult = await runQATools(pi, cwd, qaCommands);
    if (qaResult.allPassed) { qaPass = true; break; }
    
    // Send fix prompt
    await ctx.sendUserMessage(buildQAFixPrompt(qaResult, task));
    await ctx.waitForIdle();
  }
  
  if (!qaPass) {
    ctx.ui.notify(`Task "${task.title}" failed QA after 3 attempts. Review required.`, "error");
    await ctx.ui.confirm("QA failed", "Press confirm to continue anyway, or cancel the session to debug.");
  }
}
```

---

## Features Index Format

`.feature-engineer/features-index.md` maintained by GitHub SKILL:

```markdown
# Features Index

| ID | Slug | Description | Status | Date |
|---|---|---|---|---|
| 001 | user-authentication | User login with email OTP | COMPLETE | 2026-06-19 |
| 002 | dashboard-redesign | Responsive dashboard layout | IN_PROGRESS | 2026-06-20 |
```

---

## Important Constraints

- **Never use `pi` or outer command `ctx` inside `withSession`** — only use the `newCtx` argument
- **Never skip approval gates** — interactive skills must always end with `/fe-approve` reminder
- **Always write the file before compacting** — compact after, not before
- **File reads inline into prompts** — do not rely on the LLM to use `read` tool for skill input files
- **Automated skill sessions use `waitForIdle()` before `newSession()`** — do not advance while LLM is streaming
- **Template files must exist** — if `.feature-engineer/templates/` is missing, create it with defaults on first run
- **The `setup` callback in `newSession` runs before the replacement session starts** — use it only to append entries, not to send messages
- **`withSession` runs in the new session after `session_start`** — safe to call `sendUserMessage` and `waitForIdle` there
- **`pi.appendEntry()` can be called from `withSession` via `pi` (not `ctx`)** — `pi` is captured from the outer closure and is stable

---

## Verification

After building, verify:
- [ ] `/feature` command appears in Pi's command list
- [ ] `/fe-approve`, `/fe-reject`, `/fe-status` commands all registered
- [ ] Template files all created with correct structure
- [ ] First run creates `.feature-engineer/` and runs Analyse Codebase SKILL
- [ ] Second run on an initialised project goes to New/Existing selection
- [ ] Selecting "New" starts a Requirement Gathering session with the requirement template inlined
- [ ] `/fe-approve` in a req-gathering session starts a new Technical Design session
- [ ] Session name updates at each step
- [ ] State persists across Pi restarts (test by running `/feature`, closing Pi, reopening, running `/fe-status`)

# approval-quality-gates Specification

## ADDED Requirements

### Requirement: Approve gate validates the artifact deterministically

When the user runs `/feature approve` at an interactive artifact-producing step (`analyse-codebase`, `req-gathering`, `tech-design`, `test-planning`, `impl-planning`), the orchestrator SHALL validate the step's expected artifact file(s) before advancing. The workflow SHALL NOT advance (hard block, with a notification naming the file and offending lines) when: the artifact file is missing, the artifact contains a `{{` placeholder marker, or the artifact contains an `<!-- AI:` comment.

#### Scenario: Missing artifact blocks approval

- **WHEN** the LLM session ended without writing `01-requirement.md` and the user runs `/feature approve` at req-gathering
- **THEN** the workflow stays at req-gathering and the user is told the expected file is missing

#### Scenario: Leftover placeholder blocks approval

- **WHEN** `03-technical-architecture.md` contains `{{FEATURE_NAME}}` and the user runs `/feature approve`
- **THEN** the workflow stays at tech-design and the notification names the file and the placeholder line

#### Scenario: Leftover AI comment blocks approval

- **WHEN** an artifact contains an `<!-- AI: ... -->` line and the user runs `/feature approve`
- **THEN** the workflow does not advance and the notification names the offending line

#### Scenario: Clean artifact advances

- **WHEN** the artifact exists with no placeholders or AI comments and all template headings present
- **THEN** `/feature approve` advances to the next step with no extra prompt

### Requirement: Missing template headings warn but do not block

When the artifact is present and free of placeholders/AI comments but lacks one or more `##`-level headings from its source template, the orchestrator SHALL list the missing headings and ask the user to confirm before advancing. Headings that are optional by design (currently `## Delta from Existing Architecture`) SHALL be excluded from the check via an allowlist.

#### Scenario: Missing heading prompts confirmation

- **WHEN** `04-technical-plan-testing.md` lacks the `## Mock & Stub Strategy` heading and the user runs `/feature approve`
- **THEN** the user is shown the missing heading and asked to confirm; confirming advances, declining stays at the step

#### Scenario: Optional heading absence is silent

- **WHEN** a new feature's architecture omits `## Delta from Existing Architecture`
- **THEN** no warning is raised for that heading

### Requirement: Prompt-side self-checks shrink to a note

With the deterministic approve gate in place, the shared prompt helpers SHALL no longer carry the full template-population rule list and multi-bullet self-check; they SHALL be reduced to a brief reminder that the orchestrator validates placeholders, AI comments, and headings on approval.

#### Scenario: Interactive prompts are smaller

- **WHEN** any interactive skill prompt is built
- **THEN** it contains a single-sentence population note rather than the previous multi-bullet self-check and template-population blocks

### Requirement: Red-phase verification after test-builder

After the test-builder session completes, the orchestrator SHALL run the type-check command and the test-runner command parsed from `04-qa-static-tools.md`. Advancing to impl-builder SHALL require the type check to pass (exit 0) and the test run to fail (non-zero exit). On violation, the orchestrator SHALL re-prompt the test-builder once with the observed outcome; if the second attempt still violates the red-phase contract, the workflow SHALL pause with a notification and a subsequent `/feature` re-runs test-builder.

#### Scenario: Proper red phase advances

- **WHEN** the type check exits 0 and the test runner exits non-zero after test-builder
- **THEN** the workflow auto-advances to impl-builder

#### Scenario: Passing tests are rejected

- **WHEN** the test runner exits 0 after test-builder
- **THEN** the orchestrator re-prompts test-builder once, stating that tests passed and must fail meaningfully until implementation exists

#### Scenario: Type errors are rejected

- **WHEN** the type check exits non-zero after test-builder
- **THEN** the red phase is not accepted (a failing run must not be due to parse or type errors) and the retry/pause path applies

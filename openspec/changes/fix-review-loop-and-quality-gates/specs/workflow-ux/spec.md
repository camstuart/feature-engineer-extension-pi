# workflow-ux Specification

## ADDED Requirements

### Requirement: Reject without feedback prompts for input

When the user runs `/feature reject` with no feedback text at a step where rejection is valid, the orchestrator SHALL open a `ui.input` asking for the rejection feedback instead of erroring. Cancelling the input SHALL abort the rejection and leave the workflow state unchanged. In non-UI modes the current error message SHALL be retained.

#### Scenario: Bare reject prompts for feedback

- **WHEN** the user types `/feature reject` at tech-design
- **THEN** a feedback input opens, and submitting text re-runs tech-design with that feedback

#### Scenario: Cancelled input aborts

- **WHEN** the user presses Esc in the feedback input
- **THEN** no re-run occurs and the workflow remains parked at the current step

### Requirement: Vague-mode discovery batches confirmations

The vague-mode requirement-gathering prompt SHALL instruct one synthesis-plus-confirmation per discovery round (STEPs 3–5) instead of a `ui.confirm` per criterion, per story, and per goal. The final STEP 8 summary confirmation and the on-disk approval gate SHALL remain.

#### Scenario: One confirm per round

- **WHEN** the LLM completes the user-story drafting round with four stories
- **THEN** it presents all four stories in one summary and asks for a single confirmation (with corrections captured via the same interaction), rather than four sequential confirms

### Requirement: Documentation and prompts match orchestrator behavior

The README's post-review routing description, the review prompt's "What Happens Next" section, and the `state.ts` interactive-steps comment SHALL describe the actual behavior (deterministic approve gate, `/feature approve` advancement, clean-review auto-advance, human gate on concerns). The impl-planning prompt SHALL use only the template's `## Commit Checkpoints` section for commit grouping (removing the `[CHECKPOINT]`/`[INLINE]` markers), and the testing-plan template SHALL NOT duplicate the QA command list from `04-qa-static-tools.md`.

#### Scenario: Single commit-grouping mechanism

- **WHEN** the impl-planning prompt is rendered
- **THEN** it references the `## Commit Checkpoints` section and contains no `[CHECKPOINT]` or `[INLINE]` marker instructions

#### Scenario: QA commands have one source of truth

- **WHEN** the testing-plan template is rendered into a prompt
- **THEN** it contains no section duplicating the commands from `04-qa-static-tools.md`

#### Scenario: Workflow diagram reflects new routing

- **WHEN** `docs/workflow.mmd` is regenerated
- **THEN** it shows branch creation before test-builder, the clean-review auto-advance edge, and the five-pass review

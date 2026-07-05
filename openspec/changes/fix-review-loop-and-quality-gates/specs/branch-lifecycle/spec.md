# branch-lifecycle Specification

## ADDED Requirements

### Requirement: Feature branch is created before build steps

On approval of `impl-planning` (before `test-builder` starts), the orchestrator SHALL ensure the feature branch exists and is checked out: create it with `git checkout -b` when absent, check it out when it exists (e.g. from a previous review cycle), and no-op when already current. On git failure the orchestrator SHALL notify the user with the git error and keep the workflow at the current step.

#### Scenario: Branch created on first build

- **WHEN** the user approves impl-planning and no feature branch exists
- **THEN** the orchestrator creates and checks out the branch before the test-builder session starts
- **AND** all test-builder and impl-builder commits land on that branch

#### Scenario: Existing branch is reused

- **WHEN** a MINOR review loop re-enters impl-builder and the feature branch already exists
- **THEN** the orchestrator checks it out (or no-ops if current) without error

#### Scenario: Git failure parks the workflow

- **WHEN** `git checkout -b` fails (e.g. conflicting uncommitted changes)
- **THEN** the user sees the git error and the workflow does not advance past impl-planning

### Requirement: Branch name derives from a structured config line

The orchestrator SHALL parse a `Branch pattern:` line from `06-git-strategy.md` (backtick-quoted value, supporting `{slug}` and `{id}` substitutions). When the line is missing or unparseable, the branch name SHALL default to `feature/<slug>`. The shipped `git-strategy.md` config template SHALL include the structured line.

#### Scenario: Configured pattern is used

- **WHEN** the config contains ``Branch pattern: `feat/{id}-{slug}` `` and the feature is 007 / `email-otp`
- **THEN** the branch is `feat/007-email-otp`

#### Scenario: Missing pattern falls back

- **WHEN** the config has no `Branch pattern:` line (e.g. a user's pre-existing customised template)
- **THEN** the branch is `feature/email-otp`

### Requirement: GitHub skill no longer creates branches or commits

The github skill's process SHALL be reduced to: verify commits exist on the feature branch, push the branch, open a PR when `gh` is available and the strategy calls for one, and update `features-index.md`. Its prompt SHALL NOT instruct branch creation or committing.

#### Scenario: GitHub skill on a completed build

- **WHEN** the github skill runs after impl-builder committed on the feature branch
- **THEN** it pushes the existing branch and opens the PR without creating branches or new commits

#### Scenario: No commits found

- **WHEN** the github skill finds no commits on the feature branch relative to the base
- **THEN** it reports the anomaly via notify and ends with `Status: BLOCKED` instead of pushing

# Git Strategy

## Branch Strategy

- Default branch: `main`. All releases are tagged off `main`.
- Feature branches: `feature/<slug>` where `<slug>` is the kebab-case slug from `paths.ts` (e.g. `feature/prompt-self-verify-checklist`).
- Branch from `main`. Rebase onto `main` before merging to keep history linear.
- One branch per feature. Do not stack unrelated features on the same branch.

Branch pattern: `feature/{slug}`
Base branch: `main`

## Commit Format

Conventional Commits. Format:

```
<type>(<scope>): <description>

<body (optional)>

<footer (optional)>
```

- **Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.
- **Scope**: the module or area touched, kebab-case (e.g. `feat(runner): ...`, `fix(qa): ...`, `docs(readme): ...`). Scope is optional; omit for cross-cutting changes.
- **Description**: imperative mood, lowercase, no trailing period, ≤ 72 characters (e.g. `feat(runner): add intermediateSteps compaction between phases`).
- **Body**: wrap at 72 columns; explain *why*, not *what*.
- **Breaking changes**: add `BREAKING CHANGE:` in the footer and use `!` after the type/scope (`feat(api)!: rename fe-state schema`).
- Example: `feat(persistence): validate fe-state on read with stable error messages`.

Commit pattern: `^(feat|fix|docs|refactor|test|chore|perf|build|ci)(\([a-z0-9-]+\))?!?: .+`

## Commit Frequency

- Commit after each logical group of tasks is QA-passing (i.e. `pnpm test` and `pnpm typecheck` both succeed).
- A single commit should compile cleanly and pass all static QA on its own. Avoid "WIP" commits on feature branches — squash locally before pushing if needed.
- Commits should be ordered so the diff at each commit tells a coherent story (e.g. add tests, then fix; add helper, then use it). Do not interleave unrelated refactors with feature changes.

## Pull Request

- A PR is required for any change that lands on `main`. The branch is pushed first, then a PR is opened.
- PR title: same format as the commit subject line — `type(scope): description`.
- PR body must include:
  - **What** changed (1-3 bullets).
  - **Why** the change is needed (link the issue or describe the motivation).
  - **How** to verify (`pnpm install`, `pnpm test`, `pnpm typecheck`).
- Required reviewers: at least one maintainer before merge.
- Labels: `feature`, `fix`, `docs`, `refactor`, `test`, `chore`, `breaking-change` (when applicable), and `pi-extension` (always, to identify changes that affect the published extension surface).
- Squash-merge by default. The squash commit message must follow the Conventional Commits format above; the PR body becomes the squash body.

## Push Policy

- Push the feature branch as soon as the first commit lands and `pnpm test` + `pnpm typecheck` pass locally. This surfaces CI results early.
- Do not push broken commits. If a commit in the middle of a feature breaks QA, fix it locally (amend or fixup) before pushing.
- After approval and squash-merge to `main`, push the tag as part of the release flow (see below).
- Release flow (from `README.md`): `npm version patch|minor|major` updates `package.json`, `git push --follow-tags` publishes the tag, then `npm publish` ships the new version. Tags follow `v<semver>` (e.g. `v0.1.0`).

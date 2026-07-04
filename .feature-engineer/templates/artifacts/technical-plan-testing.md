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

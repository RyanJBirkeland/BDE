## Why

Four findings from the multi-lens audit identify trust-boundary validators and migration scripts that operate without meaningful test coverage. Three of the four deal with security-sensitive or state-machine-critical paths where silent regressions carry real consequences:

- `validateRepoPath` is the only gate preventing IDE file access outside configured repo roots. An off-by-one in the prefix check or a missed traversal vector goes undetected until a user can read files outside their repos.
- `isTaskStatus` is a type guard used at DB and wire-payload boundaries. A missed rejection of `null`, empty string, or wrong-case value propagates an invalid status into downstream state-machine logic and SQLite writes.
- `task-validation.ts` already has a test file but it only covers the happy path and basic rejection; the partial-block path and error-injection cases are absent.
- Migration v053–v055 tests verify the schema change happens but not that data survives correctly or that the migration is safely idempotent under repeated application.

None of these require production code changes. This is a purely additive test-coverage epic.

## What Changes

- **T-49** — New tests in `src/main/__tests__/validation.test.ts` covering `validateRepoPath` for path traversal (`../`), URL-encoded separators, prefix-match-without-child, exact-match, and root-with-trailing-slash edge cases.
- **T-64** — New describe block in `src/shared/__tests__/task-state-machine.test.ts` for `isTaskStatus` negative cases: `null`, `undefined`, empty string, numeric `0`, object `{}`, and wrong-case `"DONE"`.
- **T-46** — Extended tests in `src/main/services/__tests__/task-validation.test.ts` covering partial-block state (some deps satisfied, some not) and `computeBlockState` throw injection.
- **T-47** — Expanded migration tests for v053–v055: idempotency under repeated `up()` calls; existing-row survival and NULL behaviour for v054; mixed-case and unaffected-row correctness for v055.

## Capabilities

### New Capabilities

None. Additive test coverage only — no production code changes.

### Modified Capabilities

None.

## Impact

**Source files touched (tests only):**
- `src/main/__tests__/validation.test.ts` — new file
- `src/shared/__tests__/task-state-machine.test.ts` — extended
- `src/main/services/__tests__/task-validation.test.ts` — extended
- `src/main/migrations/__tests__/v053.test.ts` — extended
- `src/main/migrations/__tests__/v054.test.ts` — extended
- `src/main/migrations/__tests__/v055.test.ts` — extended

**No production files touched.**

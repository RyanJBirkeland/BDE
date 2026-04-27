## Why

Three critical code paths — the pre-flight operational checks service, the unit-of-work transaction boundary, and the watchdog worktree preserve-guard — have zero direct test coverage. Each guards a safety-critical invariant (auth/repo validation before task launch, atomic rollback on failure, and review-worktree preservation for human inspection) whose breakage would be silent in production.

## What Changes

- Add a new unit test file for `operational-checks-service.ts` covering all five exported check functions and the `runOperationalChecks` orchestrator, with special focus on the silent-warn-on-git-error branch in `validateGitCleanStatus`
- Add a new integration test file for `unit-of-work.ts` proving that `runInTransaction` commits on success and rolls back on throw, using an in-memory SQLite database
- Extend the existing `watchdog-loop.test.ts` with two explicit assertions for the `cleanupWorktreeIfNotInReview` preserve-guard: one verifying cleanup is skipped when the task is in `review` status, one verifying cleanup is invoked for any other status

## Capabilities

### New Capabilities

- `operational-checks-coverage`: Unit tests for all exported functions in `operational-checks-service.ts`, including the critical git-error silent-warn branch
- `unit-of-work-rollback`: Integration test proving SQLite rollback on throw in `createUnitOfWork().runInTransaction`
- `watchdog-preserve-guard`: Explicit unit tests for the `cleanupWorktreeIfNotInReview` review-status preservation logic

### Modified Capabilities

## Impact

- Test files only — no changes to production code or npm dependencies
- New file: `src/main/services/__tests__/operational-checks-service.test.ts`
- New file: `src/main/data/__tests__/unit-of-work.test.ts`
- Modified file: `src/main/agent-manager/__tests__/watchdog-loop.test.ts` (two new tests appended to existing `describe('runWatchdog')` block)
- Module docs: `docs/modules/services/index.md` and `docs/modules/data/index.md` — add rows for covered modules if missing

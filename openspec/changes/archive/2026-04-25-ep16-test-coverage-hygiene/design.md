## Context

Honest test coverage is the compounding asset — every refactor in EP-1 through EP-10 that added behavior needs a test that proves the behavior, not a test that proves the mock returns what the test set up. The main gaps: real SQLite claim-race test, migration per-version tests, private-field reach-ins that make tests brittle, and hardcoded constants that rot when the source changes.

## Goals / Non-Goals

**Goals:**
- Concurrent-claim test: two `claimTask` calls against a real in-memory SQLite DB — exactly one succeeds
- Orphan-recovery round-trip: seed `active` task, call `recoverOrphans`, assert re-queued + `orphan_recovery_count` incremented
- `PipelineErrorBoundary` test: render with a throwing child, assert fallback UI shown
- Cascading deps test: 3-task chain, transition first to `done`, assert remaining unblock in order
- Every `TaskStateService.transition()` path covered: valid, invalid, terminal, non-terminal
- Replace `_circuitBreaker` / `_terminalCalled` direct access with behavior assertions or accessor methods
- 17 missing per-migration tests (one per migration that mutates data or has a CHECK constraint)
- Replace hardcoded `'claude-sonnet-4-5'` with imported model constant
- Clean up `afterEach` missing in classifier tests (prevents cross-test pollution)

**Non-Goals:**
- 100% line coverage (not a goal; behavior coverage is)
- E2E / Playwright tests
- Testing private implementation details beyond what's needed to verify behavior

## Decisions

### D1: Real SQLite for claim-race test

Use `better-sqlite3` with `:memory:` and run the migrations against it. The test calls two `claimTask` functions synchronously (since `better-sqlite3` is sync, true concurrency isn't possible in Node — use the existing atomic `UPDATE … WHERE claimed_by IS NULL` pattern and verify only one update succeeds).

### D2: Migration tests follow v049 pattern

Each migration test: create a DB at version N-1, apply the migration, assert the schema/data change is correct. The aggregate smoke test still exists for chain completeness; per-migration tests prove correctness of the individual migration logic.

### D3: Private field replacement strategy

For tests that do `agentManager._circuitBreaker`, add a `get circuitBreakerState()` public accessor on `ErrorRegistry` (EP-2 extracted this). For `_terminalCalled`, assert the observable behavior (terminal IPC called, status updated) rather than the internal flag.

## Risks / Trade-offs

- **Risk**: 17 migration tests is a lot of boilerplate → Mitigation: extract a `makeMigrationTestDb(version)` helper shared across all 17; each test is 10-15 lines
- **Trade-off**: Real SQLite tests are slower than mocked tests — still fast enough (< 1s each) since they use in-memory DBs

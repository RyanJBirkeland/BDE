## Why

The atomic `claimTask` primitive has no concurrent-claim test (wave 1 / T-102 was a serial test; true concurrent SQLite behavior is untested). 17 data migrations have no dedicated per-migration test — only an aggregate smoke test that proves the chain completes but not that individual migrations handle partial prior state. `PipelineErrorBoundary` has no test file. The "integration" test for agent-manager mocks every dependency including SQLite. Multiple tests reach into private fields `_circuitBreaker` / `_terminalCalled` / `_drainFailureCounts` directly. Hardcoded string `'claude-sonnet-4-5'` in tests instead of importing the constant from source.

## What Changes

- Concurrent `claimTask` test using real in-memory SQLite with two simultaneous callers
- Orphan recovery round-trip test: seed active task, call `recoverOrphans`, assert re-queued + counter incremented
- `PipelineErrorBoundary` test file created
- Cascading dependency test: 3-task chain, terminal first → assert all unblocked in order
- Every terminal path in `TaskTerminalService` covered
- Private field reach-ins (`_circuitBreaker`, etc.) replaced with public accessor methods or behavior-driven assertions
- 17 migration tests backfilled (modeled on existing `v049.test.ts` pattern)
- Hardcoded model strings replaced with imported constants

## Capabilities

### New Capabilities

- `honest-integration-tests`: In-memory SQLite integration tests for claim race, orphan recovery, and cascading deps — no mocked data layer

### Modified Capabilities

<!-- No production code changes — test-only improvements -->

## Impact

- `src/main/__tests__/` — new integration tests
- `src/main/migrations/__tests__/` — 17 new per-migration test files
- `src/main/agent-manager/__tests__/` — replace private-field assertions with behavior-driven
- `src/renderer/src/components/sprint/__tests__/` — new PipelineErrorBoundary test

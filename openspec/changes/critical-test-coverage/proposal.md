## Why

Seven critical code paths in the agent orchestration, migration, and service layers have zero test coverage today. Each is a silent-failure path: a bug here either leaves tasks claimed indefinitely with no human notification, corrupts SQLite state that the aggregate smoke test won't catch, or silently drops completed agent work from the Code Review queue.

## What Changes

- Add unit tests for `transitionToReview` covering the happy path and the catch path — the sole function that moves a task from execution into the Code Review queue
- Add tests for `resolveFailure`'s DB-write error path — currently it can call `onTaskTerminal` for a task never written to SQLite as `failed`
- Add a statistical test verifying `calculateRetryBackoff` jitter stays within its documented ±20% bounds
- Add per-migration test files for v046 (task_reviews table), v047 (epic depends_on), and v050–v053 (composite indices + orphan_recovery_count) — required by CLAUDE.md for any data-mutating migration
- Add unit tests for all five exported functions in `operational-checks-service.ts` — these gate every task queuing operation and are currently untested
- Add unit tests for `promoteAdhocAgent` — the bridge between adhoc agent sessions and the Code Review Station

## Capabilities

### New Capabilities

- `agent-orchestration-tests`: Test coverage for the agent-manager critical paths that can silently corrupt or lose task state (`transitionToReview`, `resolveFailure`, `calculateRetryBackoff`).
- `migration-integrity-tests`: Per-migration test files for data-mutating migrations v046–v053, verifying each migration handles partial-application state and produces the expected schema/data.
- `service-layer-tests`: Test coverage for the pre-flight check functions in `operational-checks-service.ts` and for `promoteAdhocAgent` in `adhoc-promotion-service.ts`.

### Modified Capabilities

## Impact

- `src/main/agent-manager/__tests__/review-transition.test.ts` — new file
- `src/main/agent-manager/__tests__/resolve-failure-phases.test.ts` — new file (adds error-path tests; existing file may exist with partial coverage)
- `src/main/migrations/__tests__/v046.test.ts`, `v047.test.ts`, `v050.test.ts`, `v051.test.ts`, `v052.test.ts`, `v053.test.ts` — new files
- `src/main/services/__tests__/operational-checks-service.test.ts` — new file
- `src/main/services/__tests__/adhoc-promotion-service.test.ts` — new file
- No production code changes; no IPC changes; no new dependencies

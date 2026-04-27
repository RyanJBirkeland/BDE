## 1. Concurrent Claim + Orphan Round-Trip Tests

- [x] 1.1 Find or create `src/main/data/__tests__/sprint-queue-ops.test.ts` (or add to existing)
- [x] 1.2 Add concurrent-claim test: two `claimTask` calls for same task against `:memory:` SQLite → exactly one succeeds
- [x] 1.3 Add orphan round-trip test: seed active task in `:memory:` DB, call `recoverOrphans`, assert `status=queued` and `orphan_recovery_count=1`

## 2. PipelineErrorBoundary Test

- [x] 2.1 Find `PipelineErrorBoundary` component (grep `src/renderer/src/components/sprint/`)
- [x] 2.2 Create test file — render with a throwing child, assert fallback UI renders without crashing

## 3. Cascading Dependency + TaskStateService Coverage

- [x] 3.1 Add cascading deps test: seed 3-task chain in `:memory:` DB, call `TaskStateService.transition(first, 'done')`, assert second transitions to `queued`, then third
- [x] 3.2 Add `TaskStateService` tests: valid transition succeeds, invalid throws `InvalidTransitionError`, terminal calls dispatcher, non-terminal skips dispatcher (may already exist — extend if so)

## 4. Replace Private-Field Reach-Ins

- [x] 4.1 Grep `src/main/agent-manager/__tests__/` for `_circuitBreaker`, `_terminalCalled`, `_drainFailureCounts`
- [x] 4.2 For each: replace with a public accessor on `ErrorRegistry` or behavior assertion
- [x] 4.3 Add `afterEach` cleanup in `failure-classifier.test.ts` to reset `registerFailurePattern` state

## 5. Per-Migration Tests (backfill 17)

- [x] 5.1 Extract `makeMigrationTestDb(upToVersion)` helper in `src/main/migrations/__tests__/helpers.ts`
- [x] 5.2 Identify which migrations need tests: `grep -l "UPDATE\|DELETE\|CHECK" src/main/migrations/v*.ts` — write one test per hit
- [x] 5.3 Each test: create DB at version N-1, apply migration N, assert schema/data change

## 6. Hardcoded Constants Cleanup

- [x] 6.1 Grep test files for `'claude-sonnet-4-5'` or other hardcoded model strings — replace with imported constants
- [x] 6.2 Grep for hardcoded `PENDING_UPDATE_TTL` numeric values — import from source
- [x] 6.3 Extract shared `makeLogger()` / `makeMetrics()` test helpers if duplicated across 3+ test files

## 7. Verification

- [x] 7.1 `npm run typecheck` zero errors
- [x] 7.2 `npx vitest run --config src/main/vitest.main.config.ts` all pass
- [x] 7.3 `npm test` all pass
- [x] 7.4 `npm run lint` zero errors

> Phase A invariant: this change contributes to the **direct test coverage on high-blast-radius state mutators** invariant in `pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md`. The Phase A coordination change adds the additional named-function test files (`updateTaskFromUi`, `transitionToReview`, `handleWatchdogVerdict`, `resolveNodeExecutable`, prompt builders) that this epic does not cover.

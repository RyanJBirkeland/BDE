## 1. T-127 — Dep-resolution batch success log (task-terminal-service.ts)

- [x] 1.1 In `scheduleDependencyResolution`, after the `for` loop and before the outer `catch`, add a `logger.info` call: `[task-terminal] resolved ${totalCount - failedTaskIds.length} dependents in ${totalCount} tasks`
- [x] 1.2 Verify the log is NOT emitted when `refreshTaskDepIndex` throws (it must live inside the inner `try`, after the loop)
- [x] 1.3 Update or add a unit test in `task-terminal-service.test.ts` asserting the info log fires with correct counts on a partial-failure batch

## 2. T-83 — Auto-merge status-failure structured event (auto-merge-coordinator.ts)

- [x] 2.1 In `finalizeAutoMergeStatus` catch block, add `logger.event('auto-merge.status-update-failed', { taskId, error: String(err) })` immediately after the existing `logger.error` call
- [x] 2.2 Confirm the existing `logger.error` text line is preserved (do not replace it)
- [x] 2.3 Add or update a test asserting that when `taskStateService.transition` throws, `logger.event` is called with `'auto-merge.status-update-failed'` and the correct `taskId`

## 3. T-100 — Circuit-breaker auto-reset log enrichment (circuit-breaker.ts)

- [x] 3.1 In `isOpen()`, capture the pre-reset values before zeroing state: `const failureCount = this.consecutiveFailures` and `const openDurationMs = now - (this.openUntil - SPAWN_CIRCUIT_PAUSE_MS)`
- [x] 3.2 Replace the existing `logger.info('[circuit-breaker] Pause elapsed — resuming drain')` with a richer message that includes `failureCount` and `openDurationMs`, e.g.: `[circuit-breaker] Pause elapsed — resuming drain (was open for ${openDurationMs}ms after ${failureCount} consecutive failures)`
- [x] 3.3 Update the `CircuitBreaker` unit test that asserts on the reset log string to match the new message format

## 4. T-87 — No-commits structured event (resolve-success-phases.ts)

- [x] 4.1 In `hasCommitsAheadOfMain`, inside the `if (parseInt(diffOut.trim(), 10) === 0)` branch, call `logger.event('completion.no_commits', { taskId, branch, retryCount })` immediately after the `await logUncommittedWorktreeState(...)` call and before the `retryCount >= MAX_NO_COMMITS_RETRIES` branch split
- [x] 4.2 Confirm the event fires on both the requeue path and the exhausted-retries path (single call covers both)
- [x] 4.3 Add a unit test asserting `logger.event` is called with `'completion.no_commits'` when `rev-list` returns `0`, for both retry-available and exhausted cases

## 5. Verification

- [x] 5.1 Run `npm run typecheck` — zero errors
- [x] 5.2 Run `npm test` — all tests pass
- [ ] 5.3 Run `npm run test:main` — all tests pass (pre-existing native module build failure unrelated to these changes)
- [x] 5.4 Run `npm run lint` — zero errors
- [x] 5.5 Update `docs/modules/agent-manager/index.md` rows for `auto-merge-coordinator`, `circuit-breaker`, and `resolve-success-phases`; update `docs/modules/services/index.md` row for `task-terminal-service`

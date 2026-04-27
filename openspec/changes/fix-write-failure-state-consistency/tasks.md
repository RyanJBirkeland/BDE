## 1. T-21 — Claim-only fallback in `_spawnAgent` last-resort catch

- [x] 1.1 In `src/main/agent-manager/index.ts` (~line 341), replace the single `repo.updateTask({ status: 'error', claimed_by: null })` call with a two-level fallback: attempt the status+claim write, and on failure retry with a claim-only patch `{ claimed_by: null, notes }` (no `status` field)
- [x] 1.2 Change the outer catch log level from `error` to `warn` (the status write failing due to a concurrent transition is an expected race condition, not an infrastructure error); keep `error` only if the claim-only fallback also fails

## 2. T-35 — Watchdog retry + gated `onTaskTerminal`

- [x] 2.1 Add `broadcastToRenderer?: (channel: string, payload: unknown) => void` to the `WatchdogLoopDeps` interface in `src/main/agent-manager/watchdog-loop.ts`
- [x] 2.2 Wire `broadcastToRenderer` from the `AgentManager` into the watchdog loop deps at the call site in `watchdog.ts` or wherever `WatchdogLoopDeps` is constructed
- [x] 2.3 Wrap `deps.repo.updateTask(agent.taskId, result.taskUpdate)` in `withRetryAsync` (already imported from `sqlite-retry.ts`) to handle SQLITE_BUSY transparently
- [x] 2.4 On persistent write failure (all retries exhausted), call `deps.broadcastToRenderer?.('manager:warning', { message: ... })`, remove the agent from the map, and return early without calling `onTaskTerminal`
- [x] 2.5 Confirm `removeAgentFromMap` and the `shouldNotifyTerminal` block are only reached when the write succeeded (restructure the success path to make this explicit)

## 3. T-92 — Tagged result type for `resolveFailure`

- [x] 3.1 In `src/main/agent-manager/resolve-failure-phases.ts`, define and export `ResolveFailureResult = { isTerminal: boolean; writeFailed?: false } | { isTerminal: boolean; writeFailed: true; error: Error }`
- [x] 3.2 Change `resolveFailure` return type from `boolean` to `ResolveFailureResult`; update both the success branches to return `{ isTerminal }` and the catch block to return `{ isTerminal, writeFailed: true, error }` instead of rethrowing
- [x] 3.3 Update the re-export wrapper `resolveFailure` in `src/main/agent-manager/completion.ts` to propagate `ResolveFailureResult` (update the exported type alias and the wrapper's return type)
- [x] 3.4 Update `handleIncompleteFiles` in `src/main/agent-manager/run-agent.ts`: destructure result, check `result.writeFailed`, and skip `onTaskTerminal` + log a warning when true
- [x] 3.5 Update `handleResolveSuccessFailure` in `src/main/agent-manager/run-agent.ts`: same pattern as 3.4 — gate `onTaskTerminal` on `!result.writeFailed`
- [x] 3.6 Run `npm run typecheck` to catch any remaining callers that still treat the return value as `boolean`

## 4. T-95 — Gate `onTaskTerminal` in `skipIfAlreadyOnMain`

- [x] 4.1 In `src/main/agent-manager/task-claimer.ts` `skipIfAlreadyOnMain`, restructure the auto-complete write: move `await deps.onTaskTerminal(task.id, 'done')` inside the `try` block (after the `updateTask` call) so it only runs if the write succeeds, and `return false` from the `catch` block

## 5. Integration tests

- [x] 5.1 Create `src/main/agent-manager/__tests__/write-failure-consistency.test.ts`
- [x] 5.2 T-21 test: mock `repo.updateTask` to throw on first call (transition-guarded write), succeed on second (claim-only); assert the second call is made with no `status` field and `claimed_by: null`
- [x] 5.3 T-35 test: mock `repo.updateTask` to always throw; assert `broadcastToRenderer` was called with `'manager:warning'` channel, and `onTaskTerminal` was NOT called
- [x] 5.4 T-92 test: mock `repo.updateTask` to throw; assert `resolveFailure` returns `{ writeFailed: true }` (not a throw); assert a caller wrapper skips `onTaskTerminal`
- [x] 5.5 T-95 test: mock `repo.updateTask` to throw; assert `onTaskTerminal` was NOT called and the function returns `false`
- [x] 5.6 Run `npm run test:main` and confirm all new tests pass with no pre-existing failures introduced

## 6. Documentation

- [x] 6.1 Update `docs/modules/agent-manager/index.md`: add notes to the rows for `index.ts`, `watchdog-loop.ts`, `resolve-failure-phases.ts`, `completion.ts`, `run-agent.ts`, and `task-claimer.ts` reflecting the write-failure guard behavior
- [x] 6.2 Run `npm run typecheck && npm run lint` to confirm zero new errors before committing

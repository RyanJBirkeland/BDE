## 1. Shared Infrastructure

- [x] 1.1 Create `src/main/lib/retry-constants.ts` exporting `DISPATCH_RETRY_DELAY_MS = 200`
- [x] 1.2 Verify `sleep` utility is importable from `src/main/lib/async-utils.ts` (used by retry logic)

## 2. TaskStateService — TransitionResult (T-116)

- [x] 2.1 Add `TransitionResult` interface to `src/main/services/task-state-service.ts`: `{ committed: true; dependentsResolved: boolean; dispatchError?: Error }`
- [x] 2.2 Change `transition()` return type from `Promise<void>` to `Promise<TransitionResult>`
- [x] 2.3 Replace the swallowed-error `catch` block with retry-once logic: first failure → sleep `DISPATCH_RETRY_DELAY_MS` → retry → on second failure annotate notes + return degraded result
- [x] 2.4 Implement `appendDispatchFailureAnnotation(taskId, timestamp)` helper that appends `[terminal-dispatch-failed <ISO>] Dependency resolution may not have run. Dependents may need manual unblock.` to existing notes via `updateTask`
- [x] 2.5 Non-terminal transitions return `{ committed: true, dependentsResolved: true }` without attempting dispatch

## 3. cancelTask — CancelTaskResult (T-122)

- [x] 3.1 Add `CancelTaskResult` discriminated union type to `src/main/services/sprint-use-cases.ts`
- [x] 3.2 Change `cancelTask()` return type from `Promise<SprintTask | null>` to `Promise<CancelTaskResult>`
- [x] 3.3 Replace the swallowed-error `catch` block with retry-once logic: first failure → sleep `DISPATCH_RETRY_DELAY_MS` → retry → on second failure annotate notes + return `{ row, sideEffectFailed: true, sideEffectError }`
- [x] 3.4 Success path returns `{ row, sideEffectFailed: false }`; not-found path returns `{ row: null }`

## 4. MCP Server — Surface Degraded Cancel

- [x] 4.1 Update `cancelTaskForMcp` in `src/main/mcp-server/index.ts` to handle the new `CancelTaskResult` union (was `SprintTask | null`)
- [x] 4.2 Update `src/main/mcp-server/tools/tasks.ts` cancel tool response: include `"warning"` field when `sideEffectFailed` is true
- [x] 4.3 Update `src/main/mcp-server/tools/tasks.test.ts`: update cancel tests for the new return shape; add test asserting `"warning"` field appears on degraded result
- [x] 4.4 Update `src/main/mcp-server/parity.integration.test.ts`: update cancel assertions for new return shape

## 5. Tests — TransitionResult (T-116)

- [x] 5.1 Test: dispatch succeeds on first attempt → `{ committed: true, dependentsResolved: true }`, no retry
- [x] 5.2 Test: dispatch throws on first attempt, succeeds on retry → `{ committed: true, dependentsResolved: true }`
- [x] 5.3 Test: dispatch throws on both attempts → `{ committed: true, dependentsResolved: false, dispatchError }` AND `updateTask` called with notes containing `"terminal-dispatch-failed"`
- [x] 5.4 Test: existing notes are preserved (annotation is appended, not replaced)
- [x] 5.5 Test: non-terminal transition → `{ committed: true, dependentsResolved: true }`, dispatch not called

## 6. Tests — CancelTaskResult (T-122)

- [x] 6.1 Test: `onStatusTerminal` succeeds → `{ row: <task>, sideEffectFailed: false }`
- [x] 6.2 Test: `onStatusTerminal` throws on first call, succeeds on retry → `{ row: <task>, sideEffectFailed: false }`
- [x] 6.3 Test: `onStatusTerminal` throws on both calls → `{ row: <task>, sideEffectFailed: true, sideEffectError }` AND notes annotation written
- [x] 6.4 Test: task not found → `{ row: null }`
- [x] 6.5 Ensure all existing `cancelTask` tests pass (update signatures where needed)

## 7. Compile Check and Module Docs

- [x] 7.1 Run `npm run typecheck` — fix any callers that need updating after `transition()` return-type change
- [x] 7.2 Run `npm test` and `npm run test:main` — all tests pass
- [x] 7.3 Update `docs/modules/services/index.md`: update rows for `task-state-service.ts` and `sprint-use-cases.ts` to reflect new return types and exports

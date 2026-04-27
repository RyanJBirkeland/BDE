## 1. PipelineAbortError sentinel class

- [x] 1.1 Create `src/main/agent-manager/pipeline-abort-error.ts` with `PipelineAbortError extends Error` carrying an optional `cause: unknown` property
- [x] 1.2 Export `PipelineAbortError` as a named export; add a unit test in `src/main/agent-manager/__tests__/pipeline-abort-error.test.ts` verifying `instanceof`, `message`, and `cause` fields

## 2. Update validateTaskForRun to throw PipelineAbortError

- [x] 2.1 In `src/main/agent-manager/prompt-assembly.ts`, import `PipelineAbortError` and change the final `throw new Error('Task has no content')` in `validateTaskForRun` to `throw new PipelineAbortError('Task has no content')`
- [x] 2.2 Verify the existing unit tests for `validateTaskForRun` still pass; update their `toThrow` assertion to match `PipelineAbortError` if needed

## 3. Update handleSpawnFailure to re-throw as PipelineAbortError

- [x] 3.1 In `src/main/agent-manager/spawn-and-wire.ts`, import `PipelineAbortError` and change the final `throw err` in `handleSpawnFailure` to `throw new PipelineAbortError('Spawn failed and recovered', err)`
- [x] 3.2 Update `spawnAndWireAgent`'s inner `throw err // unreachable` comment to `throw err // unreachable — handleSpawnFailure throws PipelineAbortError` for clarity

## 4. Harden Phase 1 catch in runAgent

- [x] 4.1 In `src/main/agent-manager/run-agent.ts`, import `PipelineAbortError` at the top of the file
- [x] 4.2 Replace the Phase 1 bare `catch { return }` with an explicit catch that checks `instanceof PipelineAbortError`: if true, return; if false, run the unexpected-abort recovery sequence (log `[run-agent] phase 1 aborted unexpectedly for <id>: <message>`, try `repo.updateTask(task.id, { status: 'error', claimed_by: null })`, try `onTaskTerminal('error', task.id)`, return)
- [x] 4.3 Wrap the DB update and `onTaskTerminal` calls inside the unexpected-error branch in individual try/catch blocks that log secondary failures without re-throwing

## 5. Harden Phase 2 catch in runAgent

- [x] 5.1 Replace the Phase 2 bare `catch { return }` in `runAgent` with the same `instanceof PipelineAbortError` discrimination applied in Task 4.2
- [x] 5.2 Wrap DB update and `onTaskTerminal` calls in try/catch with warn-level logging for secondary failures

## 6. Fix cleanupOrPreserveWorktree

- [x] 6.1 In `cleanupOrPreserveWorktree` (run-agent.ts ~line 488), wrap the `repo.getTask(task.id)` call in try/catch; on throw, log `[run-agent] could not read task status for <id>, preserving worktree: <err>` and return early
- [x] 6.2 Replace the `currentTask?.status !== 'review'` optional-chaining conditional with an explicit null check: if `currentTask == null`, log `[run-agent] task <id> not found in DB, preserving worktree` and return; otherwise check `currentTask.status !== 'review'`

## 7. Unit tests — Phase 1 and Phase 2 abort paths

- [x] 7.1 Add `src/main/agent-manager/__tests__/run-agent-phase-abort.test.ts` (or extend the existing run-agent test file if one exists) with a test: "Phase 1 unexpected error transitions task to error and releases claim" — inject a mock `assembleRunContext` that throws plain `Error`, assert `repo.updateTask` was called with `{ status: 'error', claimed_by: null }` and `onTaskTerminal` was called with `'error'`
- [x] 7.2 Add a test: "Phase 1 PipelineAbortError does not call onTaskTerminal a second time" — inject `validateTaskForRun` to throw `PipelineAbortError`, assert `onTaskTerminal` is NOT called by `runAgent`
- [x] 7.3 Add a test: "Phase 2 unexpected error transitions task to error and releases claim" — inject `spawnAndWireAgent` to throw plain `Error`, assert `repo.updateTask` called with `{ status: 'error', claimed_by: null }` and `onTaskTerminal` called
- [x] 7.4 Add a test: "Phase 2 PipelineAbortError does not double-call onTaskTerminal" — inject `spawnAndWireAgent` to throw `PipelineAbortError`, assert `onTaskTerminal` NOT called by `runAgent`

## 8. Unit tests — cleanupOrPreserveWorktree

- [x] 8.1 Add a test: "cleanupOrPreserveWorktree preserves worktree when getTask throws" — mock `repo.getTask` to throw, assert `cleanupWorktreeWithRetry` is NOT called and a warn log is emitted
- [x] 8.2 Add a test: "cleanupOrPreserveWorktree preserves worktree when getTask returns null" — mock `repo.getTask` to return null, assert `cleanupWorktreeWithRetry` is NOT called and a warn log is emitted
- [x] 8.3 Add a test: "cleanupOrPreserveWorktree deletes worktree when task is in non-review terminal status" — mock `repo.getTask` to return `{ status: 'error' }`, assert `cleanupWorktreeWithRetry` IS called
- [x] 8.4 Add a test: "cleanupOrPreserveWorktree preserves worktree when task is in review status" — mock `repo.getTask` to return `{ status: 'review' }`, assert `cleanupWorktreeWithRetry` is NOT called

## 9. Pre-commit verification

- [x] 9.1 Run `npm run typecheck` — zero errors required
- [x] 9.2 Run `npm test` — all tests pass
- [x] 9.3 Run `npm run lint` — zero errors required
- [x] 9.4 Update `docs/modules/agent-manager/index.md` to add a row for `pipeline-abort-error.ts`

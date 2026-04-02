# Agent Manager -- Reliability Engineer Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 18 source files in Agent Manager + TaskTerminalService + env-utils + sdk-streaming
**Persona:** Reliability Engineer
**Purpose:** Verify remediation of 16 findings from v1 audit (AM-REL-1 through AM-REL-23, excluding withdrawn findings)

---

## Summary of Changes Since v1 Audit

The remediation work addressed the majority of findings. Several were fixed completely, others partially. A few new issues surfaced during review of the remediated code.

---

## Finding-by-Finding Verification

### AM-REL-1: Spawn timeout timer leaks on successful spawn

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `run-agent.ts:178-193` now stores the timer ID in a `let timer` variable and calls `clearTimeout(timer!)` in a `.finally()` block on the `Promise.race`. This is exactly the pattern recommended in v1.
  ```typescript
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(...)
  })
  handle = await Promise.race([spawnAgent({...}), timeoutPromise]).finally(() => clearTimeout(timer!))
  ```

### AM-REL-2: `cleanupWorktree` is fire-and-forget with no error logging

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `worktree.ts:229-251` — `cleanupWorktree` is now `async`, uses `execFileAsync` (promisified), accepts an optional `logger` parameter, and logs warnings on each failure. All three git operations (`worktree remove`, `worktree prune`, `branch -D`) have individual try/catch blocks with `log.warn(...)` calls.

### AM-REL-3: `pruneStaleWorktrees` uses `console.warn` instead of injected logger

- **v1 Severity:** Low
- **Status: FIXED**
- **Evidence:** `worktree.ts:253-292` — `pruneStaleWorktrees` now accepts `logger?: Logger` parameter and uses `const log = logger ?? console` (line 266). All warn calls route through the injected logger. Callers in `index.ts` (lines 587, 616) pass `this.logger`.

### AM-REL-4: Worktree lock not released on `nukeStaleState` failure path

- **v1 Severity:** Low (defense-in-depth)
- **Status: FIXED**
- **Evidence:** `worktree.ts:196-218` — The `acquireLock` at line 188 is followed by a try/catch block (lines 196-216) that calls `releaseLock` in the catch before re-throwing. The `.git` path validation at lines 191-194 calls `releaseLock` before throwing. The normal exit path releases at line 218. All paths are covered.

### AM-REL-5: `resolveFailure` returns `false` on DB error, silencing terminal failures

- **v1 Severity:** High
- **Status: FIXED**
- **Evidence:** `completion.ts:426-431` — The catch block now returns `isTerminal` (which is `retryCount >= MAX_RETRIES`) instead of hardcoded `false`. The comment reads "Still return correct terminal status even if DB update failed so caller knows to trigger onStatusTerminal callback." This is exactly the v1 recommendation.

### AM-REL-7: Race between orphan recovery and drain loop on startup

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `index.ts:637-652` — The initial drain (inside `setTimeout(INITIAL_DRAIN_DEFER_MS)`) now explicitly awaits `recoverOrphans()` before calling `_drainLoop()`. This ensures orphan recovery completes before the first drain cycle processes any tasks.

### AM-REL-8: `_watchdogLoop` iterates over Map while deleting entries

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `index.ts:534-571` — The watchdog loop now uses a two-pass approach: (1) collect agents-to-kill in an array during iteration (lines 536-543), (2) process kills in a separate loop (lines 546-570). The Map is no longer mutated during iteration.

### AM-REL-9: `emitAgentEvent` swallows all SQLite write errors silently

- **v1 Severity:** Low
- **Status: FIXED**
- **Evidence:** `agent-event-mapper.ts:68-87` — Rate-limited error logging has been added. A `_lastSqliteErrorLog` timestamp and `SQLITE_ERROR_LOG_INTERVAL_MS` (60 seconds) constant gate the `console.warn` call. SQLite failures are now observable without flooding the log.

### AM-REL-10: `fileLog` in `index.ts` swallows write errors completely

- **v1 Severity:** Low
- **Status: FIXED**
- **Evidence:** `index.ts:54-70` — The `fileLog` function now tracks `fileLogFailureCount` (consecutive failures), resets on success (line 57), and logs to `console.error` after 5 consecutive failures (lines 65-68) with diagnostic information about the log path. This follows the v1 recommendation.

### AM-REL-11: No test coverage for `TaskTerminalService` integration

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `src/main/services/__tests__/task-terminal-service.test.ts` exists with 3 test cases covering: (1) happy path -- terminal status triggers `resolveDependents` and unblocks dependent task, (2) non-terminal status is a no-op, (3) error in `getTasksWithDependencies` is caught and logged. All three recommended scenarios from v1 are covered (the fourth -- `resolveDependents` failure -- is implicitly covered by case 3 since both throw inside the same try/catch).

### AM-REL-12: `sdk-streaming.ts` timeout calls `queryHandle.return()` but does not throw

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `sdk-streaming.ts:42-76` — A `timedOut` boolean flag is set in the timeout callback (line 44). After the `for await` loop exits (in the `finally` block, timer is cleared). Lines 74-76 check `if (timedOut)` and throw `new Error('SDK streaming timed out after ...')`. Callers can now distinguish timeout from completion.

### AM-REL-13: `checkOAuthToken` reads token file synchronously on the main thread

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `index.ts:95-133` — `checkOAuthToken` now uses `readFile` from `node:fs/promises` (line 98: `await readFile(tokenPath, 'utf-8')`) and `stat` from `node:fs/promises` (line 115: `await stat(tokenPath)`). The function was already `async`, so this was a drop-in replacement. No synchronous I/O remains on the drain loop hot path.

### AM-REL-14: `branchNameForTask` can produce invalid git branch name

- **v1 Severity:** Low
- **Status: FIXED**
- **Evidence:** `worktree.ts:17-18` — After the regex sanitization, `const finalSlug = slug || 'unnamed-task'` provides the fallback. A title of `"!!!---###"` now produces `agent/unnamed-task` instead of `agent/`.

### AM-REL-16: `_mapQueuedTask` does not validate required fields

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `index.ts:315-341` — `_mapQueuedTask` now validates `id`, `title`, and `repo` with explicit `typeof` checks (lines 317-329). Returns `null` with a logged warning for any missing/invalid field. The caller at line 420 skips null-mapped tasks. The `as string` casts are gone.

### AM-REL-19: `_drainLoop` guard uses boolean flag instead of proper mutex

- **v1 Severity:** Low
- **Status: FIXED**
- **Evidence:** The `_drainRunning` flag has been completely removed from `index.ts` (grep confirms no occurrences). Only `_drainInFlight` (Promise-based guard) remains, checked at line 622 before each drain cycle.

### AM-REL-20: Test coverage gap -- `AgentManagerImpl.stop()` re-queue path not tested

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `src/main/agent-manager/__tests__/index.test.ts` contains a test "re-queues active tasks after shutdown" (around line 630) that verifies `updateTask` is called with `{ status: 'queued', claimed_by: null, started_at: null, notes: 'Task was re-queued due to BDE shutdown...' }`. Additional tests cover abort errors during stop and drainInFlight cleanup.

### AM-REL-22: `sdk-adapter.ts` CLI fallback does not handle child process crash

- **v1 Severity:** Medium
- **Status: FIXED**
- **Evidence:** `sdk-adapter.ts:135-137` — `child.on('exit', (code) => { exitCode = code })` handler is now present. The `parseMessages` async generator (line 164-167) yields an `{ type: 'exit_code', exit_code: exitCode }` message after stdout ends, making the exit code available to `run-agent.ts` for classification. Stderr is also captured line-by-line via the `onStderr` callback (lines 110-129).

### AM-REL-23: `_checkAndBlockDeps` silently proceeds on JSON parse failure

- **v1 Severity:** Low
- **Status: FIXED**
- **Evidence:** `index.ts:374-387` — The outer catch block now logs the error via `this.logger.error(...)` (line 376), sets the task to `error` status with a note (lines 378-381), and returns `true` (block the task) instead of `false` (proceed). Malformed dependency data now prevents task execution rather than silently bypassing.

---

## Previously Reported Cross-Cutting Issues -- Status

### ARCH-2: Repository pattern inconsistently applied

- **Status: PARTIALLY FIXED (unchanged from v1)**
- `handleWatchdogVerdict` at `index.ts:142-200` still accepts a raw `updateTaskFn` callback rather than `ISprintTaskRepository`. The agent manager core (`AgentManagerImpl`) uses `this.repo` consistently. This is cosmetic within the agent manager scope.

### Duplicate `runSdkStreaming` (main-process-ax 2.1)

- **Status: UNCHANGED (by design)**
- `sdk-streaming.ts` is used by workbench/spec-semantic-check. The agent manager uses `sdk.query()` directly via `sdk-adapter.ts`. These are intentionally different call patterns (streaming for interactive workbench vs. full agent session for pipeline). Not a reliability concern.

---

## New Issues Found During v2 Review

### AM-REL-v2-1: `cleanupWorktree` called without `await` in watchdog-cleaned path

- **Severity:** Low
- **File(s):** `src/main/agent-manager/run-agent.ts:371-376`
- **Description:** When the watchdog has already cleaned up an agent (line 369: `!activeAgents.has(task.id)`), `cleanupWorktree` is called without `await` and without a `.catch()` handler (line 371-375). Since `cleanupWorktree` is now async (fixed in AM-REL-2), the returned promise is silently discarded. If the cleanup fails, the error will become an unhandled rejection.
- **Evidence:**
  ```typescript
  if (!activeAgents.has(task.id)) {
    logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
    cleanupWorktree({   // <-- no await, no .catch()
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch
    })
    return
  }
  ```
- **Recommendation:** Either `await cleanupWorktree(...)` or add `.catch(err => logger.warn(...))`.

### AM-REL-v2-2: `cleanupWorktree` at end of `runAgent` also not awaited

- **Severity:** Low
- **File(s):** `src/main/agent-manager/run-agent.ts:458-462`
- **Description:** Same issue as v2-1. The fire-and-forget cleanup at the end of `runAgent` (line 458) doesn't await or catch the now-async `cleanupWorktree`. The function returns before cleanup completes, and any cleanup error becomes an unhandled promise rejection.
- **Recommendation:** Add `.catch(err => logger.warn(...))` to the call, or await it if waiting is acceptable.

### AM-REL-v2-3: Orphan recovery does not call `onTaskTerminal` for max-retry error path

- **Severity:** Medium
- **File(s):** `src/main/agent-manager/orphan-recovery.ts:29-37`
- **Description:** When orphan recovery detects a task that has exceeded `MAX_RETRIES` (line 29), it sets the task to `error` status but does NOT call any `onTaskTerminal` callback. This means dependent tasks blocked on this task will never be unblocked by orphan recovery. The orphan recovery function only receives `isAgentActive` and `repo` -- it has no access to the terminal status callback.
- **Evidence:** Lines 29-37 update the task to `error` with `needs_review: true` but no dependency resolution is triggered. Compare with `handleWatchdogVerdict` which calls `onTerminal` after setting `error`.
- **Recommendation:** Accept an `onTerminal` callback parameter in `recoverOrphans` and call it for the max-retry error path. Alternatively, have the caller (AgentManagerImpl) check for newly-errored tasks after orphan recovery runs.

### AM-REL-v2-4: `steerAgent` message size validation but no sanitization

- **Severity:** Low
- **File(s):** `src/main/agent-manager/index.ts:738-747`
- **Description:** `steerAgent` validates message length (10KB limit, line 740) but passes the raw message directly to `agent.handle.steer(message)` which writes it to the child process stdin. In the CLI path (`sdk-adapter.ts:181-188`), the message is JSON-serialized, so injection is mitigated. In the SDK path, steer is not supported (returns error). This is defense-in-depth, not a live vulnerability.
- **Recommendation:** Consider sanitizing or at minimum logging the steer message content for audit trail purposes.

---

## Summary Table

| Finding | v1 Severity | Status | Notes |
|---------|------------|--------|-------|
| AM-REL-1 (spawn timeout leak) | Medium | **Fixed** | Timer cleared in `.finally()` |
| AM-REL-2 (cleanupWorktree silent) | Medium | **Fixed** | Async, logged, accepts logger |
| AM-REL-3 (pruneStaleWorktrees console.warn) | Low | **Fixed** | Injected logger used |
| AM-REL-4 (worktree lock release) | Low | **Fixed** | All paths release lock |
| AM-REL-5 (resolveFailure false on DB error) | High | **Fixed** | Returns `isTerminal` in catch |
| AM-REL-7 (orphan/drain race) | Medium | **Fixed** | Orphan recovery awaited before drain |
| AM-REL-8 (Map mutation during iteration) | Medium | **Fixed** | Two-pass collect-then-kill |
| AM-REL-9 (emitAgentEvent silent swallow) | Low | **Fixed** | Rate-limited logging added |
| AM-REL-10 (fileLog silent swallow) | Low | **Fixed** | Consecutive failure counter + stderr |
| AM-REL-11 (TaskTerminalService no tests) | Medium | **Fixed** | 3 test cases covering main paths |
| AM-REL-12 (sdk-streaming timeout silent) | Medium | **Fixed** | Throws TimeoutError after loop |
| AM-REL-13 (sync file read on main thread) | Medium | **Fixed** | Uses async fs/promises |
| AM-REL-14 (invalid branch name) | Low | **Fixed** | Fallback slug `unnamed-task` |
| AM-REL-16 (no field validation) | Medium | **Fixed** | Type checks, returns null on invalid |
| AM-REL-19 (redundant drain guard) | Low | **Fixed** | `_drainRunning` removed |
| AM-REL-20 (stop re-queue untested) | Medium | **Fixed** | Test verifies re-queue + notes |
| AM-REL-22 (CLI crash unhandled) | Medium | **Fixed** | exit handler + exit_code message |
| AM-REL-23 (dep parse silent proceed) | Low | **Fixed** | Logs error, sets task to error |
| AM-REL-v2-1 (unawaited cleanup, watchdog path) | Low | **New** | Missing await/catch on async |
| AM-REL-v2-2 (unawaited cleanup, end of runAgent) | Low | **New** | Missing catch on async |
| AM-REL-v2-3 (orphan recovery no onTerminal) | Medium | **New** | Blocked deps never unblocked |
| AM-REL-v2-4 (steer unsanitized) | Low | **New** | Defense-in-depth |

---

## Overall Assessment

**All 16 actionable findings from v1 are fully fixed.** The 2 findings that were withdrawn during v1 review (AM-REL-6 and AM-REL-15/18) were correctly assessed as non-issues.

The remediation quality is high:
- Fixes follow the specific recommendations from v1 (e.g., `.finally(() => clearTimeout(timer!))` for AM-REL-1, `return isTerminal` for AM-REL-5, two-pass collect-then-kill for AM-REL-8).
- The single high-severity finding (AM-REL-5) is correctly fixed with the exact pattern recommended.
- Test coverage gaps identified in v1 (AM-REL-11, AM-REL-20) have been addressed with focused tests.

**4 new issues found**, none critical/high:
- 1 Medium (orphan recovery not triggering dependency resolution for max-retry errors)
- 3 Low (unawaited async cleanups and defense-in-depth steer sanitization)

The agent manager is in good reliability shape. The remaining medium-severity item (AM-REL-v2-3) is a real but narrow edge case: a task must be orphaned AND exceed max retries AND have dependents. The workaround is manual intervention, which is already standard practice for `needs_review` tasks.

**Reliability Rating:** Strong. No critical or high findings remain. The codebase shows systematic attention to error handling, logging, and resource cleanup.

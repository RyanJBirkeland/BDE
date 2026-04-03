# Agent Manager -- Reliability Engineer Audit

**Date:** 2026-03-29
**Scope:** 35 files in Agent Manager (18 source, 17 test)
**Persona:** Reliability Engineer

---

## Cross-Reference with March 28 Audit

### Previously Reported -- Now Fixed

1. **UX-1 (Agent failure notes are not actionable)** -- The March 28 audit flagged terse error messages like "Fast-fail exhausted", "Idle timeout", "Empty prompt". All three have been rewritten with actionable guidance:
   - Fast-fail exhausted (`run-agent.ts:377-379`): Now explains common causes (OAuth token, npm deps, invalid spec) and how to retry.
   - Idle timeout (`index.ts:166`): Now says "Agent produced no output for 15 minutes" with recovery steps.
   - Max runtime (`index.ts:148`): Now explains runtime limit and suggests breaking into subtasks.
   - Empty prompt (`run-agent.ts:143-145`): Now tells user to "edit the task and provide a prompt or spec".

2. **main-process-sd S1 (Worktree lock TOCTOU race)** -- The lock acquisition in `worktree.ts:48-83` now uses `writeFileSync` with `flag: 'wx'` for atomic creation, checks PID liveness for stale locks, and properly cleans up. The TOCTOU window between check and acquire has been addressed with atomic file creation.

3. **main-process-pm C2/C3 (Shutdown/orphan recovery notes)** -- Shutdown (`index.ts:642-647`) now sets `notes: 'Task was re-queued due to BDE shutdown while agent was running.'` and orphan recovery (`orphan-recovery.ts:28-31`) sets `notes: 'Task was re-queued by orphan recovery (was claimed but agent is no longer running).'`.

4. **ARCH-6 (Fragile onStatusTerminal wiring)** -- `TaskTerminalService` (`task-terminal-service.ts`) now provides a centralized `onStatusTerminal` callback via `createTaskTerminalService()`, replacing the 4 separate setter pattern. The agent manager receives this via `config.onStatusTerminal`.

### Previously Reported -- Still Open

1. **ARCH-2 (Repository pattern inconsistently applied)** -- The agent manager properly uses `ISprintTaskRepository` via constructor injection. However, the `handleWatchdogVerdict` function at `index.ts:132-188` accepts a raw `updateTaskFn` callback instead of the repository interface. This is cosmetic within the agent manager scope but contributes to the broader pattern inconsistency.

2. **Duplicate `runSdkStreaming`** (main-process-ax 2.1, main-process-sd M1) -- `sdk-streaming.ts` exists as a shared utility, but it is NOT used by the agent manager's SDK adapter (`sdk-adapter.ts`). The agent manager uses `sdk.query()` directly. The duplication is between `sdk-streaming.ts` and `workbench.ts`/`spec-semantic-check.ts`, not within agent manager scope, but worth noting for cross-module consistency.

### New Findings

(See below)

---

## Findings

### AM-REL-1: Spawn timeout timer leaks on successful spawn

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/run-agent.ts:162-175`
- **Description:** The `Promise.race` between `spawnAgent()` and a timeout `setTimeout` does not clean up the timer when the spawn succeeds. If `spawnAgent` resolves first, the timeout timer continues running for up to 60 seconds and will call `reject()` on an already-resolved promise (silently swallowed by the runtime, but the timer itself is a resource leak). Over many agent spawns, this accumulates dangling timers.
- **Evidence:**
  ```typescript
  handle = await Promise.race([
    spawnAgent({ ... }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Spawn timed out after ${SPAWN_TIMEOUT_MS / 1000}s`)),
        SPAWN_TIMEOUT_MS
      )
    )
  ])
  ```
- **Recommendation:** Use `AbortSignal.timeout()` or store the timer ID and call `clearTimeout` after the race resolves. Standard pattern:
  ```typescript
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('...')), SPAWN_TIMEOUT_MS)
  })
  handle = await Promise.race([spawnAgent({...}), timeoutPromise]).finally(() => clearTimeout(timer!))
  ```

### AM-REL-2: `cleanupWorktree` is fire-and-forget with no error logging

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/worktree.ts:217-229`
- **Description:** `cleanupWorktree()` uses raw callback-style `execFile` (not promisified) and chains three nested callbacks. Errors in any of the three git commands (`worktree remove`, `worktree prune`, `branch -D`) are silently swallowed -- there is no logger parameter and no `console.warn`. If worktree cleanup fails (e.g., worktree directory is locked by another process), stale worktrees accumulate on disk with no diagnostic trail.
- **Evidence:**
  ```typescript
  export function cleanupWorktree(opts: CleanupWorktreeOpts): void {
    const { repoPath, worktreePath, branch } = opts
    const env = buildAgentEnv()
    execFile('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, env }, () => {
      execFile('git', ['worktree', 'prune'], { cwd: repoPath, env }, () => {
        execFile('git', ['branch', '-D', branch], { cwd: repoPath, env }, () => {
          // best-effort
        })
      })
    })
  }
  ```
- **Recommendation:** Accept a `logger` parameter. Log warnings on failure. Consider converting to async/await with `execFileAsync` for consistency with the rest of the module. Even "best effort" cleanup should be observable.

### AM-REL-3: `pruneStaleWorktrees` uses `console.warn` instead of injected logger

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/worktree.ts:250, 261`
- **Description:** `pruneStaleWorktrees` logs errors via `console.warn` rather than an injected logger. In Electron's main process, `console.warn` goes to stdout which is not captured in `~/.bde/agent-manager.log`. Failed prune operations leave no trace in the structured log file.
- **Evidence:**
  ```typescript
  console.warn(`[worktree] Failed to read repo directory during prune: ${err}`)
  // ...
  console.warn(`[worktree] Failed to remove stale worktree directory: ${err}`)
  ```
- **Recommendation:** Add `logger?: Logger` parameter to `pruneStaleWorktrees()` and route through it (falling back to `console` for backward compatibility).

### AM-REL-4: Worktree lock not released on `nukeStaleState` failure path

- **Severity:** high
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/worktree.ts:177-207`
- **Description:** In `setupWorktree`, if `nukeStaleState()` throws (line 189), execution enters the catch block at line 196 which calls `releaseLock`. However, the `acquireLock` call at line 177 happens before the try block at line 185. If an error occurs between `acquireLock` (line 177) and the `try` block entry (line 185) -- specifically in the `existsSync` check at line 180 which calls `releaseLock` and throws -- the lock IS properly released on that path. But more critically: if `nukeStaleState` itself throws an error that is NOT caught by the try/catch (e.g., a stack overflow or OOM), the lock file will persist as a stale lock, blocking future worktree creation for that repo until PID liveness check cleans it up.

  Actually, on closer inspection, the try/catch at line 196 will catch `nukeStaleState` failures. The real issue is narrower: the `acquireLock` at line 177 is outside the try/finally. If the code between lines 177-185 throws (which in practice means the `existsSync` + `.git` check), the lock release at line 181 handles that specific path. However, line 175 (`mkdirSync`) could also throw if the filesystem is full, and the lock would NOT have been acquired yet at that point so that's fine.

  **Re-evaluated:** The lock handling is actually correct for the current code paths. Downgrading this finding.

- **Severity:** low (defense-in-depth)
- **Recommendation:** Wrap the entire `acquireLock` through completion in a single try/finally for clarity. Currently the lock release is split across two locations (line 181 and 203/207) making it harder to verify correctness during future changes.

### AM-REL-5: `resolveFailure` returns `false` on DB error, silencing terminal failures

- **Severity:** high
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/completion.ts:366-392`
- **Description:** When `resolveFailure` is called with `retryCount >= MAX_RETRIES` (meaning the task should terminally fail), if `repo.updateTask` throws, the function catches the error and returns `false` (meaning "not terminal"). The caller in `run-agent.ts:419-425` then skips calling `onTaskTerminal`, so dependent tasks are never unblocked. The task remains in whatever status it was before (likely `active` with `claimed_by` set), creating an orphan that won't be properly recovered because it has no PR data.
- **Evidence:**
  ```typescript
  } catch (err) {
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    return false  // <-- should this be true when retryCount >= MAX_RETRIES?
  }
  ```
- **Recommendation:** Return `retryCount >= MAX_RETRIES` in the catch block so the caller still calls `onTaskTerminal` even if the DB write failed. The dependency resolution is independent of the task status write.

### AM-REL-6: `onTaskTerminal` in `AgentManagerImpl` does not await `resolveDependents` properly

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:280-289`
- **Description:** When `config.onStatusTerminal` is not set (the fallback path), `resolveDependents` is called synchronously. This is fine because `resolveDependents` is itself synchronous. However, the `onTaskTerminal` method is declared as `async` and callers `await` it. The issue is in `handleWatchdogVerdict` (line 151/169) where `onTerminal` is called but its result is handled with `.catch()` -- meaning if `resolveDependents` throws, the error is logged but the task's status has already been written as `error`. This is actually correct behavior. However, there is a subtle issue: when `config.onStatusTerminal` IS provided (the `TaskTerminalService` path), it's a synchronous function (`void` return), but `onTaskTerminal` wraps it in an async context without awaiting. If `TaskTerminalService.onStatusTerminal` throws, the throw propagates synchronously and is caught by the try/catch at line 283. This is fine.

  **Re-evaluated:** The error handling is actually robust here. Withdrawing this finding.

### AM-REL-7: Race between orphan recovery and drain loop on startup

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/index.ts:549-592`
- **Description:** On `start()`, three concurrent async operations are kicked off: (1) orphan recovery (line 550, fire-and-forget), (2) initial worktree prune (line 564, fire-and-forget), and (3) initial drain loop (line 586, after `INITIAL_DRAIN_DEFER_MS` = 5 seconds). If orphan recovery has not completed before the drain loop starts, a task could be re-queued by orphan recovery at the same time the drain loop is trying to claim and spawn an agent for it. The drain loop's `claimTask` would likely fail (task was re-queued, not yet re-fetched), but the race window exists.
- **Evidence:** Lines 549-592 -- three fire-and-forget operations with no coordination.
- **Recommendation:** Await orphan recovery before starting the drain timer. Since `INITIAL_DRAIN_DEFER_MS` is 5 seconds, this could be done by `await`ing `recoverOrphans` inside the deferred setTimeout callback, before running `_drainLoop()`.

### AM-REL-8: `_watchdogLoop` iterates over Map while deleting entries

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:489-519`
- **Description:** `_watchdogLoop` iterates over `this._activeAgents.values()` and calls `this._activeAgents.delete(agent.taskId)` inside the loop body (line 503). In JavaScript, deleting a key from a Map during `for...of` iteration is technically safe (the spec guarantees the iterator visits elements that exist at the time of iteration and does not revisit deleted ones), but it makes the logic fragile and confusing. More importantly, after deleting the agent from the map, the watchdog calls `handleWatchdogVerdict` which calls `this.repo.updateTask` -- if that throws, the agent has already been removed from `_activeAgents` but the task status may not have been updated, creating an orphan.
- **Evidence:**
  ```typescript
  for (const agent of this._activeAgents.values()) {
    // ...
    this._activeAgents.delete(agent.taskId) // line 503
    // ... handleWatchdogVerdict may throw ...
  }
  ```
- **Recommendation:** Collect agents-to-kill in a separate array during iteration, then process deletions after the loop completes. This also makes it easier to add error handling around the deletion + status update as an atomic operation.

### AM-REL-9: `emitAgentEvent` swallows all SQLite write errors silently

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-event-mapper.ts:70-76`
- **Description:** The `emitAgentEvent` function has an empty catch block for SQLite `appendEvent` failures. While the comment says "SQLite write failure is non-fatal", there is zero logging. If the database is corrupted or the disk is full, thousands of events will silently fail to persist, and the user will discover the data loss only when they try to review agent history.
- **Evidence:**
  ```typescript
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch {
    // SQLite write failure is non-fatal
  }
  ```
- **Recommendation:** Add a rate-limited log warning (e.g., log once per minute or once per N failures) so persistent SQLite failures are detectable without flooding the log.

### AM-REL-10: `fileLog` in `index.ts` swallows write errors completely

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:52-60`
- **Description:** The `fileLog` function wraps `appendFileSync` in an empty try/catch. If the log file becomes unwritable (permissions, disk full), all agent manager logging silently stops. The `console.log`/`console.warn` in the `defaultLogger` still works, but the file logger -- which is the primary diagnostic tool for production issues -- fails silently.
- **Evidence:**
  ```typescript
  function fileLog(level: string, m: string): void {
    try {
      appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [${level}] ${m}\n`)
      // ...
    } catch {}
  }
  ```
- **Recommendation:** Count consecutive failures and log to stderr (not the file logger) after N failures in a row.

### AM-REL-11: No test coverage for `TaskTerminalService` integration

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/services/task-terminal-service.ts`
- **Description:** `task-terminal-service.ts` has no corresponding test file in the test scope. The service has important logic: it rebuilds the dependency index on every terminal status event, then calls `resolveDependents`. If `getTasksWithDependencies` returns stale data, or if `rebuildIndex` throws, the catch block at line 34 handles it, but this path is untested. The service is the critical integration point connecting 5 different terminal-status producers to dependency resolution.
- **Evidence:** No test file exists for `task-terminal-service.ts` in the `__tests__/` directory.
- **Recommendation:** Create `src/main/services/__tests__/task-terminal-service.test.ts` covering: (1) happy path -- terminal status triggers `resolveDependents`, (2) non-terminal status is ignored, (3) `getTasksWithDependencies` failure is caught and logged, (4) `resolveDependents` failure is caught and logged.

### AM-REL-12: `sdk-streaming.ts` timeout calls `queryHandle.return()` but does not throw

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/sdk-streaming.ts:42-45`
- **Description:** When the timeout fires, `queryHandle.return()` is called to terminate the async iterator, and the stream is deleted from `activeStreams`. However, the caller of `runSdkStreaming` receives a resolved promise with whatever partial text was accumulated -- there is no indication that the response was truncated due to timeout. The caller may treat a partial response as complete.
- **Evidence:**
  ```typescript
  const timer = setTimeout(() => {
    queryHandle.return()
    activeStreams.delete(streamId)
  }, timeoutMs)
  ```
- **Recommendation:** After `queryHandle.return()`, set a flag and throw a `TimeoutError` after the `for await` loop exits (or reject the promise). This lets callers distinguish between a complete response and a timeout.

### AM-REL-13: `checkOAuthToken` reads token file synchronously on the main thread

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/index.ts:85-124`
- **Description:** `checkOAuthToken` uses `readFileSync` and `statSync` on every drain cycle (every 30 seconds). While file reads are fast, this runs on Electron's main process thread. If the filesystem is slow (network-mounted home directory, FileVault encryption under load), these synchronous I/O calls block the event loop. The `getOAuthToken` in `env-utils.ts` has the same issue but at least caches for 5 minutes.
- **Evidence:**
  ```typescript
  const token = readFileSync(tokenPath, 'utf-8').trim()
  // ...
  const stat = statSync(tokenPath)
  ```
- **Recommendation:** Convert to `readFile`/`stat` (async from `fs/promises`). The function is already `async`, so this is a straightforward change.

### AM-REL-14: `branchNameForTask` can produce invalid git branch name

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/worktree.ts:11-19`
- **Description:** When the title contains only special characters (e.g., `"!!!---###"`), the slug becomes empty, producing branch name `"agent/"`. The test file confirms this: `expect(branchNameForTask('!!!---###')).toBe('agent/')`. Git will reject `agent/` as a branch name (trailing slash), causing `setupWorktree` to fail. The error is handled (setupWorktree catches and reports), but this is a preventable failure.
- **Evidence:** `worktree.test.ts:58`: `expect(branchNameForTask('!!!---###')).toBe('agent/')`
- **Recommendation:** Add a fallback slug when the sanitized title is empty: `const slug = sanitized || 'unnamed-task'`.

### AM-REL-15: No validation that `task.repo` matches configured repos before claiming

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:374-425`
- **Description:** In `_processQueuedTask`, the task is claimed via `this.claimTaskViaApi(task.id)` at line 393 BEFORE the repo path check at line 387 returns early. Wait -- actually, looking again, the repo path check at line 387-390 returns early BEFORE the claim at line 393. This is correct. Withdrawing this finding.

  **Re-evaluated:** The ordering is: (1) check processingTasks guard, (2) map task, (3) check deps, (4) resolve repo path (return early if not found), (5) claim task. The repo check is before claim. This is correct.

### AM-REL-16: `_mapQueuedTask` does not validate required fields

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:303-315`
- **Description:** `_mapQueuedTask` casts `raw.id`, `raw.title`, and `raw.repo` directly with `as string` without any validation. If any of these fields are `undefined` or non-string (e.g., due to a Queue API bug or database corruption), the task will proceed with `undefined` values cast to `string`, leading to confusing errors downstream (e.g., `setupWorktree` with undefined taskId, `claimTask` with undefined id).
- **Evidence:**
  ```typescript
  return {
    id: raw.id as string,
    title: raw.title as string,
    // ...
    repo: raw.repo as string
  }
  ```
- **Recommendation:** Add validation at the top: if `!raw.id || !raw.title || !raw.repo`, log a warning and return `null`. Have `_processQueuedTask` skip null-mapped tasks.

### AM-REL-17: Completion handler's `resolveSuccess` does not call `onTaskTerminal` on success path

- **Severity:** high
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/completion.ts:222-364`
- **Description:** When `resolveSuccess` completes the happy path (branch pushed, PR created), it updates the task with `pr_status: 'open'` but does NOT call `onTaskTerminal`. This is intentional -- the task stays `active` and the SprintPrPoller marks it `done` when the PR merges. However, this means tasks with `pr_status='open'` are in a limbo state: they're `active` in the DB, not in `_activeAgents`, and `claimed_by` is still set. The orphan recovery at `orphan-recovery.ts:17` handles this by checking `task.pr_url`, but if the PR URL was null (e.g., `pr_status='branch_only'`), orphan recovery clears `claimed_by` but does NOT re-queue. The task stays `active` with `claimed_by=null` and `pr_status='branch_only'` -- it will never be picked up again unless manually intervened.

  Actually, looking more carefully at orphan recovery line 17: `if (task.pr_url || task.pr_status === 'branch_only')` -- this condition covers both cases. For `branch_only`, it clears `claimed_by` and skips re-queuing. The task remains `active` with a note explaining the branch was pushed. This is the intended behavior -- the user can manually create a PR from the branch.

  **Re-evaluated:** The behavior is intentional but could lead to confusion. The task stays `active` indefinitely with `pr_status='branch_only'`. Downgrading to low since it's by design and documented.

- **Severity:** low
- **Recommendation:** Consider setting status to `done` or a dedicated `needs_manual_pr` status for `branch_only` tasks so they don't clutter the active pipeline.

### AM-REL-18: `handleWatchdogVerdict` for `rate-limit-loop` does not call `onTerminal`

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:175-186`
- **Description:** When the watchdog detects a rate-limit loop, the task is re-queued (status set to `queued`, `claimed_by` cleared). However, `onTerminal` is NOT called. This means if other tasks had hard dependencies on this task, they remain blocked even though the task was re-queued (not terminal). This is actually correct -- `queued` is not a terminal status, so `onTerminal` should not fire. The dependent tasks will be unblocked when the re-queued task eventually completes.

  **Re-evaluated:** Correct behavior. Withdrawing.

### AM-REL-19: `_drainLoop` guard uses boolean flag instead of proper mutex

- **Severity:** low
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/index.ts:429-485`
- **Description:** `_drainRunning` is a simple boolean flag set at line 434 and cleared at line 483. There's also `_drainInFlight` (a Promise) managed by the caller in `start()`. The double-guard approach works because JavaScript is single-threaded, but it's redundant and confusing -- the `_drainInFlight` check in `start()` at line 570 already prevents concurrent drains. The `_drainRunning` flag inside `_drainLoop` is technically unnecessary given `_drainInFlight`.
- **Recommendation:** Remove `_drainRunning` flag since `_drainInFlight` already provides the guard. Or document why both are needed (belt-and-suspenders for the setTimeout initial drain at line 586 which sets `_drainInFlight` separately).

### AM-REL-20: Test coverage gap -- `AgentManagerImpl.stop()` re-queue path not tested

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:639-653`, `src/main/agent-manager/__tests__/index.test.ts`
- **Description:** The `stop()` method re-queues all active agents during shutdown (lines 639-653). However, `index.test.ts` does not test: (1) that tasks are re-queued with correct fields during shutdown, (2) that `repo.updateTask` failures during shutdown are logged, (3) that `_activeAgents` is cleared after shutdown. The test at line 210 verifies `mgr.start()` + `mgr.stop()` sets `running=true` then completes, but does not verify the re-queue behavior.
- **Recommendation:** Add test cases in `index.test.ts` that: (1) start an agent via blocking handle, (2) call `stop()`, (3) verify `updateTask` called with `status: 'queued'` for the active task.

### AM-REL-21: Test coverage gap -- `_watchdogLoop` does not test `handleWatchdogVerdict` DB failure

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/__tests__/index-methods.test.ts`
- **Description:** `index-methods.test.ts` tests the watchdog race guard (skips agents in `_processingTasks`) and basic kill behavior, but does not test what happens when `this.repo.updateTask` throws inside the watchdog loop. The `handleWatchdogVerdict` function is tested separately in `index-extracted.test.ts`, but the integration path through `_watchdogLoop` -> `handleWatchdogVerdict` -> `this.repo.updateTask` is not covered end-to-end.
- **Recommendation:** Add a test in `index-methods.test.ts` where `updateTask` throws during `_watchdogLoop` and verify the error is logged and the loop continues processing remaining agents.

### AM-REL-22: `sdk-adapter.ts` CLI fallback does not handle child process crash

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/sdk-adapter.ts:93-195`
- **Description:** The CLI fallback `spawnViaCli` creates a child process and yields messages from stdout. If the child process crashes (e.g., SIGSEGV) or is killed externally, the `stdout` stream will end, and the async iterator will complete normally. There is no `'error'` event handler on the child process, no `'exit'` event handler, and no monitoring of exit code. The `for await (const chunk of child.stdout)` will complete when the stream ends, and the caller will treat it as a normal exit with `exitCode = undefined` (defaulting to 1 in `classifyExit`).

  The issue is that there's no way to communicate the exit code back through the message stream in the CLI path. The caller in `run-agent.ts:272` looks for `exit_code` in messages, but if the child crashes without sending a final message, `exitCode` remains `undefined` and defaults to 1 at line 371.

- **Evidence:** No `child.on('error', ...)` or `child.on('exit', ...)` handlers.
- **Recommendation:** Add a `child.on('exit', (code) => { ... })` handler that stores the exit code. Expose it through the `AgentHandle` interface (e.g., `exitCode: Promise<number | null>`) so `run-agent.ts` can use the actual exit code instead of guessing from messages.

### AM-REL-23: `_checkAndBlockDeps` silently proceeds on JSON parse failure

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:327-352`
- **Description:** If `rawDeps` is a malformed JSON string, the outer catch at line 348 swallows the error and returns `false` (proceed without blocking). This means a task with corrupt dependency data will be spawned even though it should be blocked. While this is documented as "If dep parsing fails, proceed without blocking", it could lead to out-of-order execution.
- **Evidence:**
  ```typescript
  } catch {
    // If dep parsing fails, proceed without blocking
  }
  ```
- **Recommendation:** Log a warning when dep parsing fails so the issue is visible in the agent manager log. The fail-open behavior is reasonable but should be observable.

---

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 1     |
| Medium   | 8     |
| Low      | 7     |

**Critical: None found.**

The agent manager is well-structured with good separation of concerns. The main reliability risks are: (1) `resolveFailure` returning `false` on DB error even when the task should be terminal (AM-REL-5, high), which silently prevents dependency resolution; (2) several medium-severity issues around silent error swallowing, resource leaks on spawn timeout, and missing test coverage for shutdown and terminal service integration.

The codebase shows evidence of iterative hardening -- the worktree lock uses atomic file creation, error messages are now actionable, and orphan recovery handles edge cases like `branch_only` tasks. The dependency resolution system is thorough with proper fan-in handling.

## Quality Bar

- Every finding references specific file paths and line numbers
- Every recommendation names the specific function or pattern to change
- The "None found" for Critical severity is confirmed after reviewing all 18 source files
- Cross-reference with March 28 audit verified 4 fixed items and 2 still-open items with evidence

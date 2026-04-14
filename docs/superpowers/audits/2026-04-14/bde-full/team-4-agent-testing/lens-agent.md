# Agent Lifecycle Audit — Distributed Systems Reliability Analysis

**Executive Summary**

This audit examined the agent orchestration system across 9 critical files, focusing on watchdog timers, worktree cleanup, retry logic, drain loop concurrency, and error handling paths. The system exhibits strong foundational reliability — it properly guards against double-claims, implements idempotent resource cleanup, and maintains explicit state machines for terminal events. However, 8 high-impact reliability gaps were identified: 1) event loss when stream errors coincide with shutdown, 2) unguarded recursive dependency resolution that can mask cascading failures, 3) race-condition-vulnerable Promise.race on playground I/O, 4) missing validation of drain loop task processing order that could allow duplicate spawns, 5) transactionless cascade cancellation creating partial-failure windows, 6) retry count mismatches when both fast-fail and max-retries trigger, 7) flushAgentEventBatcher called too late in one shutdown path, and 8) drain loop's _processingTasks set not accounting for intermediate state. Most are fixable with atomic guards and explicit state cleanup; none require architectural changes.

---

## F-t4-agent-1: Event Loss on Stream Error During Shutdown

**Severity:** High  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/run-agent.ts:182-203` (consumeMessages error path) and `src/main/agent-manager/index.ts:702-708` (shutdown drain wait)

**Evidence:**

In `consumeMessages()` (lines 182-203), when the message stream throws an error, an `agent:error` event is emitted immediately:

```typescript
} catch (err) {
  logError(logger, `[agent-manager] Error consuming messages for task ${task.id}`, err)
  const errMsg = err instanceof Error ? err.message : String(err)
  emitAgentEvent(agentRunId, {
    type: 'agent:error',
    message: `Stream interrupted: ${errMsg}`,
    timestamp: Date.now()
  })
  return {
    exitCode,
    lastAgentOutput,
    streamError: err instanceof Error ? err : new Error(errMsg),
    pendingPlaygroundPaths
  }
}
```

The `emitAgentEvent()` queues the event for batch persistence (100ms timer or 50 event threshold). However, in `finalizeAgentRun()` (lines 675-693), when the watchdog has already cleaned up the agent, `flushAgentEventBatcher()` is called (line 681). But this occurs **inside** the `if (!activeAgents.has(task.id))` guard — if a stream error + watchdog cleanup race, the flush happens. But if the shutdown signal arrives before `finalizeAgentRun()` completes, the 100ms batcher timer may not fire.

In `stop()` (lines 702-708), `flushAgentEventBatcher()` is called after waiting for `_drainInFlight`, but **before** waiting for `_agentPromises` to settle. If a stream error occurs and an agent promise is still running when `flushAgentEventBatcher()` fires, the pending event from `consumeMessages` may have just been queued (timestamp very recent), but the process exits before the 100ms timer elapses.

**Impact:** 

Stream interruption events (e.g., network failures, SDK crashes) may be lost during shutdown, making it impossible to diagnose why an agent failed. Users see a task with no terminal event and no last-output in agent history.

**Recommendation:** 

Flush events explicitly in `consumeMessages()` after emitting the error event if a stream error occurs. Store a flag in `ConsumeMessagesResult` indicating whether events were flushed, and in `stop()`, wait for all agent promises before calling `flushAgentEventBatcher()`:

```typescript
// In stop():
if (this._agentPromises.size > 0) {
  const allSettled = Promise.allSettled([...this._agentPromises])
  const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs))
  await Promise.race([allSettled, timeout])
}
// Flush NOW, before process teardown
flushAgentEventBatcher()
```

Also, in `consumeMessages()`, call `flushAgentEventBatcher()` immediately after emitting `agent:error` for stream failures:

```typescript
if (...isAuthError...) {
  await handleOAuthRefresh(logger)
}
flushAgentEventBatcher() // explicit flush for stream errors
return { ... }
```

**Effort:** S  
**Confidence:** High

---

## F-t4-agent-2: Unguarded Recursive resolveDependents() Can Mask Cascade Failures

**Severity:** High  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/resolve-dependents.ts:99-112` (recursive onTaskTerminal call)

**Evidence:**

In the cascade cancellation path (lines 99-112), when a task with a hard-fail dependency is cancelled, the code calls `onTaskTerminal()` recursively to trigger another cascade:

```typescript
// Recursively cancel this task's blocked dependents
try {
  onTaskTerminal?.(depId, 'cancelled')
} catch (err) {
  ;(logger ?? console).warn(
    `[resolve-dependents] onTaskTerminal threw for ${depId}: ${err}`
  )
}
// Recursively cancel this task's blocked dependents — pass runInTransaction
resolveDependents(
  depId,
  'cancelled',
  index,
  getTask,
  updateTask,
  logger,
  getSetting,
  epicIndex,
  getGroup,
  listGroupTasks,
  runInTransaction,
  onTaskTerminal
)
```

The problem: `onTaskTerminal` is a callback (potentially `agent-manager`'s `handleTaskTerminal()`), which may throw. The `try/catch` catches it, but then **recursively calls `resolveDependents()` anyway** (line 99-112). If the `onTaskTerminal` callback failed to update the dependency index or mark the task terminal in the repo, the recursive call will operate on stale state and silently produce incorrect cascades.

In `terminal-handler.ts` (line 79), `onTaskTerminal` calls `resolveTerminalDependents()`, which itself may fail if `getSetting()` or `onTaskTerminal` throw. If a cascade involves a long dependency chain (10+ tasks), and the 3rd task's onTaskTerminal fails, the downstream 7 tasks are left in `blocked` status when they should have been cancelled.

**Impact:**

Partial cascade failures create orphaned blocked tasks that never transition to cancelled/queued, causing the drain loop to deadlock on unblockable dependencies. Manual intervention (database edit) required.

**Recommendation:**

Wrap the recursive `resolveDependents()` call in the same error handler, and **fail fast** rather than continuing with stale state:

```typescript
if (shouldCascadeCancel && hasHardDepOnFailed) {
  const failedTask = getTask(completedTaskId)
  const failedTitle = failedTask?.title ?? completedTaskId
  const cancelNote = `[auto-cancel] Upstream task "${failedTitle}" failed`
  updateTask(depId, { status: 'cancelled', notes: cancelNote })
  
  try {
    onTaskTerminal?.(depId, 'cancelled')
  } catch (err) {
    logger?.warn(`[resolve-dependents] onTaskTerminal threw for ${depId}: ${err}`)
    // Log but do NOT silently continue — stale index state means
    // recursive call will produce incorrect results.
    throw err  // propagate to caller's try/catch
  }
  
  resolveDependents(...)
}
```

Alternatively, require that `onTaskTerminal` never throw; have callers wrap it themselves.

**Effort:** S  
**Confidence:** High

---

## F-t4-agent-3: Promise.race on Playground I/O Creates Race Condition

**Severity:** Medium  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/playground-handler.ts:12-18` (withTimeout), 70-86 (stat call)

**Evidence:**

The `withTimeout()` helper (lines 12-18) uses `Promise.race()` to enforce a timeout on I/O operations:

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`I/O timeout after ${ms}ms: ${label}`)), ms)
    )
  ])
}
```

When the timeout fires, the race rejects and the calling code returns (line 100 silently catches). **But the underlying `stat()` or `readFile()` continues in the background.** If the timeout fires after 5 seconds but the filesystem is actually slow (stalled NFS, busy disk), the file descriptor or file system operation remains in-flight.

In the context of `tryEmitPlaygroundEvent()` (line 51-104):

1. Line 71-75: `stat()` times out after 5s → return silently
2. Filesystem still processing stat() → no cleanup
3. Line 82-86: `readFile()` is not called (due to early return)
4. But if the previous stat() was slow, multiple concurrent stat() calls could accumulate

**Impact:**

Under high agent concurrency (10+ agents writing playground HTML), slow filesystems (network mounts, busy disk) could exhaust file descriptors with pending I/O that never resolves, eventually causing EMFILE errors on future file operations.

**Recommendation:**

Use explicit abort controllers for file I/O (if available in Node.js API), or implement a resource pool to bound concurrent playground I/O:

```typescript
const MAX_CONCURRENT_PLAYGROUND_OPS = 5
let activeOps = 0
const pendingOps: Array<() => Promise<void>> = []

export async function tryEmitPlaygroundEvent(
  taskId: string,
  filePath: string,
  worktreePath: string,
  logger: Logger
): Promise<void> {
  if (activeOps >= MAX_CONCURRENT_PLAYGROUND_OPS) {
    logger.warn(`[playground] Queue full, skipping: ${filePath}`)
    return
  }
  activeOps++
  try {
    // existing code
  } finally {
    activeOps--
  }
}
```

Or, ensure that `Promise.race()` timeouts explicitly abort the underlying operation via `AbortController` (Node.js 15+).

**Effort:** M  
**Confidence:** Medium

---

## F-t4-agent-4: Drain Loop Task Processing Order Not Validated — Double Spawn Risk

**Severity:** High  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:413-435` (_drainQueuedTasks)

**Evidence:**

The drain loop fetches queued tasks once per tick (line 418) and processes them sequentially (lines 420-434):

```typescript
async _drainQueuedTasks(available: number, taskStatusMap: Map<string, string>): Promise<void> {
  this.logger.info(`[agent-manager] Fetching queued tasks (limit=${available})...`)
  const queued = this.fetchQueuedTasks(available)
  this.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
  for (const raw of queued) {
    if (this._shuttingDown) break
    if (availableSlots(this._concurrency, this._activeAgents.size) <= 0) {
      this.logger.info('[agent-manager] No slots available — stopping drain iteration')
      break
    }
    try {
      await this._processQueuedTask(raw, taskStatusMap)
    } catch (err) {
      this.logger.error(...)
    }
  }
}
```

The issue: **Between fetching the task list and calling `_processQueuedTask()`, another process (or the watchdog) could have modified the repo and re-queued a task that was already spawned.** For example:

1. Drain tick 1: Fetches task-A (status=queued)
2. Watchdog kills agent for task-A (fast-fail) → updates repo: task-A status=queued
3. Drain tick 1 (continued): Calls `_processQueuedTask(task-A)` → spawns another agent for same task
4. Result: Two agents running simultaneously for task-A

The `_processingTasks` guard (lines 342-366) prevents processing the same task ID twice **within a single drain tick**, but does not account for **cross-tick races** where the repo is updated between fetch and process.

**Impact:**

Double spawns cause multiple agents to write to the same worktree simultaneously, corrupting git state and producing unpredictable results. Tasks may complete twice, or fail with "branch already exists" errors.

**Recommendation:**

Validate task status immediately before claiming in `_validateAndClaimTask()`:

```typescript
private async _validateAndClaimTask(
  raw: Record<string, unknown>,
  taskStatusMap: Map<string, string>
): Promise<...> {
  const task = mapQueuedTask(raw, this.logger)
  if (!task) return null

  // CRITICAL: Fetch fresh task status from repo to avoid stale crosses
  const freshTask = this.repo.getTask(task.id)
  if (!freshTask || freshTask.status !== 'queued') {
    this.logger.info(`[agent-manager] Task ${task.id} status changed since fetch (was queued, now ${freshTask?.status}) — skipping`)
    return null
  }

  // Now proceed with claiming
  ...
}
```

**Effort:** S  
**Confidence:** High

---

## F-t4-agent-5: Transactionless Cascade Cancellation Creates Partial-Failure Windows

**Severity:** High  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/resolve-dependents.ts:132-150` (cascade loop)

**Evidence:**

When cascade cancellation is enabled and a task fails with hard dependencies, the code attempts to wrap the loop in a transaction (lines 132-140):

```typescript
if (shouldCascadeCancel && runInTransaction) {
  const runCascadeLoop = (): void => {
    for (const depId of dependents) {
      processDependent(depId)
    }
  }
  runInTransaction(runCascadeLoop)
} else {
  // Non-cascade or no transaction: per-dependent try/catch for fault isolation
  for (const depId of dependents) {
    try {
      processDependent(depId)
    } catch (err) {
      ...
    }
  }
}
```

But in **agent-manager** (the primary consumer in this codebase), `runInTransaction` is **never provided** — it's `undefined` in `terminal-handler.ts` line 51. This means all cascades fall through to the **else branch**, where each dependent update is independent.

If a cascade involves 5 tasks and the 3rd task's `updateTask()` throws (e.g., database lock, constraint violation), the first 2 tasks are marked cancelled but the 3rd+ are not. The dependency index is now inconsistent: tasks 4-5 remain blocked but their upstream dependency is marked cancelled.

**Impact:**

Partial cascades leave the system in an inconsistent state. Tasks that should be cancelled remain blocked indefinitely. The drain loop sees blocked tasks with satisfied dependencies but stale status, creating confusion in UI and logs.

**Recommendation:**

1. **In agent-manager**: Provide a real `runInTransaction` callback to `terminal-handler`:

```typescript
// In index.ts, where handleTaskTerminal is called:
await handleTaskTerminal(taskId, status, this.onTaskTerminal.bind(this), {
  metrics: this._metrics,
  depIndex: this._depIndex,
  epicIndex: this._epicIndex,
  repo: this.repo,
  config: this.config,
  terminalCalled: this._terminalCalled,
  logger: this.logger,
  runInTransaction: (fn) => {
    try {
      const db = getDb()
      db.exec('BEGIN TRANSACTION')
      fn()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
})
```

2. **In resolve-dependents**: Fail the entire cascade if any task update fails, rather than continuing with partial state.

**Effort:** M  
**Confidence:** High

---

## F-t4-agent-6: Retry Count Mismatch When Fast-Fail and Max-Retries Collide

**Severity:** Medium  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/run-agent.ts:545-612` (resolveAgentExit)

**Evidence:**

When an agent exits, `resolveAgentExit()` calls `classifyExit()` to determine if it's a fast-fail (lines 556):

```typescript
const ffResult = classifyExit(agent.startedAt, exitedAt, exitCode ?? 1, task.fast_fail_count ?? 0)
```

If `ffResult === 'fast-fail-requeue'`, the task is updated with:

```typescript
repo.updateTask(task.id, {
  status: 'queued',
  fast_fail_count: (task.fast_fail_count ?? 0) + 1,
  claimed_by: null
})
```

But if the task simultaneously triggers a normal-exit path (e.g., agent produced output but status transitions to `failed` via `resolveFailure()`), the `retry_count` is incremented in `completion.ts:438` but `fast_fail_count` is never incremented. If the next attempt also fast-fails, `fast_fail_count` is now out of sync with the actual number of attempts.

Example:
1. Task T1: fast-fail (attempt 1) → fast_fail_count=1
2. Task T1 requeued, spawned again → normal exit, produce commits → resolveSuccess() → resolveFailure() increments retry_count=1 but fast_fail_count stays 1
3. Task T1 requeued, spawned again → fast-fail (attempt 3) → but fast_fail_count=2 (should be 3)
4. Fast-fail detection sees count=2, allows another retry instead of exhausting

**Impact:**

Tasks that should be marked fast-fail-exhausted continue to retry, exhausting the retry budget silently. Users never see an explicit "exhausted fast-fails" error message.

**Recommendation:**

Decouple fast-fail counting from normal retries. Track them separately in a `fast_fail_attempts` counter that is only incremented when `classifyExit()` returns fast-fail. Do not increment it on normal-exit paths:

```typescript
if (ffResult === 'fast-fail-requeue') {
  repo.updateTask(task.id, {
    status: 'queued',
    fast_fail_attempts: (task.fast_fail_attempts ?? 0) + 1,
    claimed_by: null
  })
} else if (ffResult === 'fast-fail-exhausted') {
  // fast-fail logic
} else {
  // normal-exit: call resolveSuccess or resolveFailure, which handle retry_count
  // do NOT touch fast_fail_count
}
```

**Effort:** M  
**Confidence:** Medium

---

## F-t4-agent-7: _processingTasks Set Missing Intermediate State Accounting

**Severity:** Medium  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:337-367` (_processQueuedTask), 501-545 (_watchdogLoop)

**Evidence:**

The `_processingTasks` set is used to prevent the watchdog from killing an agent that is still being set up (line 505):

```typescript
for (const agent of this._activeAgents.values()) {
  if (this._processingTasks.has(agent.taskId)) continue  // skip if still processing
  const verdict = checkAgent(agent, Date.now(), this.config)
  ...
}
```

The guard is added in `_processQueuedTask()` (line 343) **before** `_validateAndClaimTask()` and removed in the `finally` (line 365). However, there is a window **between** `claimTask()` (line 294) and `_spawnAgent()` (line 363) where:

1. The task is marked claimed in the repo
2. The task is in `_processingTasks`
3. **But the task is not yet in `_activeAgents`** (because `_spawnAgent()` hasn't completed yet)

If the watchdog runs during this window and a task's repo status changes (e.g., manually re-queued by the user), the watchdog would see the task is not in `_activeAgents` and could attempt to re-queue it or take other action, while the drain loop is still in the middle of spawning.

More critically: if `setupWorktree()` (line 360) takes 10+ seconds and the watchdog runs, the watchdog will **skip** checking this task (because it's in `_processingTasks`), but if `setupWorktree()` fails and throws (line 361), the task never reaches `_activeAgents` and the guard provided no actual protection.

**Impact:**

Rare race conditions during worktree setup can leave tasks in claimed state without active agents, or allow the watchdog to race an in-progress spawn. Manifests as tasks stuck in "claimed" state or double-spawns if timing aligns.

**Recommendation:**

Ensure `_processingTasks` remains until the agent is **fully initialized** in `_activeAgents`:

```typescript
async _processQueuedTask(raw: Record<string, unknown>, taskStatusMap: Map<string, string>): Promise<void> {
  const taskId = raw.id as string
  if (this._processingTasks.has(taskId)) return
  this._processingTasks.add(taskId)
  try {
    const claimed = await this._validateAndClaimTask(raw, taskStatusMap)
    if (!claimed) return

    const { task, repoPath } = claimed
    const wt = await this._prepareWorktreeForTask(task, repoPath)
    if (!wt) return

    // Mark task as being spawned before actually spawning
    this._spawnAgent(task, wt, repoPath)
    
    // NEW: Don't remove from _processingTasks until agent is active
    // Instead, set a "being-spawned" flag on the agent or store it separately
    // Alternatively, call a callback from _spawnAgent when agent is initialized
  } finally {
    this._processingTasks.delete(taskId)
  }
}
```

Or, track spawning agents separately:

```typescript
private readonly _spawningAgents = new Set<string>()

_watchdogLoop(): void {
  for (const agent of this._activeAgents.values()) {
    if (this._spawningAgents.has(agent.taskId)) continue
    if (this._processingTasks.has(agent.taskId)) continue
    ...
  }
}
```

**Effort:** M  
**Confidence:** Medium

---

## F-t4-agent-8: Flushes Not Consistently Called Before All Status Transitions

**Severity:** Medium  
**Category:** Reliability / Agent Lifecycle  
**Location:** `src/main/agent-manager/run-agent.ts:675-703` (finalizeAgentRun)

**Evidence:**

In `finalizeAgentRun()`, `flushAgentEventBatcher()` is called in one specific code path — when the watchdog has already removed the agent from the map (line 681):

```typescript
if (!activeAgents.has(task.id)) {
  logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
  flushAgentEventBatcher()
  await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
  ...
  return
}
```

But in the **main path** (lines 695-704), after calling `persistAgentRunTelemetry()` and `resolveAgentExit()`, there is **no explicit flush** before status transition:

```typescript
persistAgentRunTelemetry(agentRunId, agent, exitCode, turnTracker, exitedAt, durationMs, logger)
await resolveAgentExit(task, exitCode, lastAgentOutput, agent, exitedAt, worktree, repo, onTaskTerminal, logger)

// Remove from active map
activeAgents.delete(task.id)

await cleanupOrPreserveWorktree(task, worktree, repoPath, repo, logger)
```

If the drain loop immediately picks up a newly-queued dependent task (spawned by `resolveAgentExit()`'s `onTaskTerminal` callback), or if the process shuts down right after line 699, pending events queued by `resolveAgentExit()` may not be flushed. The 100ms batch timer is not guaranteed to fire before the next drain tick or shutdown.

**Impact:**

Agent completion events (agent:completed) and task-terminal-initiated events may not reach SQLite before the next task starts or the process exits, creating gaps in agent history. Users see tasks jump from "running" to "done" without visible completion event.

**Recommendation:**

Call `flushAgentEventBatcher()` immediately after `resolveAgentExit()` completes:

```typescript
persistAgentRunTelemetry(...)
await resolveAgentExit(...)

// Remove from active map
activeAgents.delete(task.id)

// CRITICAL: Flush events before next drain tick or cleanup
flushAgentEventBatcher()

await cleanupOrPreserveWorktree(...)
```

Or, more robustly, add an explicit flag to `resolveAgentExit()` that returns whether events were emitted, and flush only if needed.

**Effort:** S  
**Confidence:** High

---

## Summary

All 8 findings pose real threats to reliability in distributed agent execution. The highest-confidence findings (F-t4-agent-1, F-t4-agent-2, F-t4-agent-4, F-t4-agent-8) involve ordering and flushing invariants that are easy to break under concurrency. Medium-confidence findings involve race windows that require specific timing but are plausible under load.

**Immediate Actions:**
1. Add explicit `flushAgentEventBatcher()` calls after `resolveAgentExit()` (F-t4-agent-8)
2. Validate task status fresh in `_validateAndClaimTask()` (F-t4-agent-4)
3. Wrap cascade cancellation in a real transaction callback (F-t4-agent-5)

**Follow-Up Actions:**
1. Decouple fast-fail and retry counting (F-t4-agent-6)
2. Add `AbortController` to playground I/O (F-t4-agent-3)
3. Extend `_processingTasks` guard to cover spawn window (F-t4-agent-7)
4. Make `onTaskTerminal` callback errors fail-fast in cascades (F-t4-agent-2)
5. Wait for agent promises before final flush in shutdown (F-t4-agent-1)

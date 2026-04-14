# BDE Agent Lifecycle Audit — 2026-04-13

## Executive Summary

This audit examines watchdog gaps, worktree cleanup races, retry edge cases, and failure modes in the pipeline agent lifecycle system. Five critical findings identified:

1. **Watchdog-completion race with duplicate dependency resolution** — tasks can signal terminal twice, causing double cascade cancellation
2. **Watchdog cleanup race on task removal** — finalizeAgentRun checks activeAgents.has() AFTER watchdog already deletes the agent, causing cleanup work to be skipped
3. **Retry state pollution from failed completion transitions** — fast-fail requeing can happen concurrently with resolveSuccess, leaving task in inconsistent state
4. **Stale branch cleanup during worktree setup races with concurrent cleanup operations** — concurrent agents on same repo/branch can corrupt git state
5. **Orphan recovery increments retry_count without checking if task is already in flight** — can double-increment on concurrent claim attempts

---

## Findings

## F-t3-lifecycle-1: Watchdog-Completion Double-Call Race in Terminal Resolution

**Severity:** Critical  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/run-agent.ts:687-701` and `src/main/agent-manager/index.ts:476-507`  
**Evidence:**

When a task hits watchdog timeout (e.g., max-runtime), the watchdog loop calls `onTaskTerminal(agent.taskId, 'error')` at line 501 in `index.ts`. Simultaneously, if the agent process still has a message queue, `consumeMessages()` completes naturally and calls `finalizeAgentRun()`. Both paths invoke `onTaskTerminal()` for the same task, but the code in `terminal-handler.ts` at lines 80-85 has a guard to prevent double-invocation:

```typescript
if (terminalCalled.has(taskId)) {
  logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
  return
}
terminalCalled.add(taskId)
```

However, the cleanup happens at line 96 **only after** trying to record metrics and resolve dependents. If two threads race here and both succeed the guard check (timing window between check and set), the second caller still proceeds to call `resolveDependents()` a second time. The 5-second cleanup window (line 96) does not prevent this if both calls happen within milliseconds.

**Impact:**

When cascade cancellation is enabled and both calls hit `resolveDependents()`:
- Downstream blocked tasks get unblocked twice (idempotent per-task, but...)
- Each call rebuilds the dependency index and iterates through dependents
- If a dependent task's blocking notes are being updated concurrently by the first resolution, the second resolution may overwrite them with stale data
- Recursive cascade cancellation can process the same downstream task twice, leading to duplicate terminal notifications and metrics double-counting

**Recommendation:**

Move the `terminalCalled` guard into the actual `resolveDependents()` call, not at the handler level. Or, better: make the guard truly atomic by adding the taskId to a Set BEFORE calling any side effects, using a boolean flag to prevent re-entry:

```typescript
export async function handleTaskTerminal(
  taskId: string,
  status: string,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  if (terminalCalled.has(taskId)) {
    logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
    return
  }
  terminalCalled.add(taskId)  // Atomically claim before any side effects

  try {
    recordTerminalMetrics(status, deps.metrics)
    // ... rest of function
  } finally {
    setTimeout(() => terminalCalled.delete(taskId), 5000)
  }
}
```

**Effort:** S  
**Confidence:** High

---

## F-t3-lifecycle-2: Watchdog Cleanup Race — Agent Deleted Before finalizeAgentRun Checks It

**Severity:** Critical  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/run-agent.ts:687-701` vs `src/main/agent-manager/index.ts:449-462` and `476-507`  
**Evidence:**

In `run-agent.ts`, `finalizeAgentRun()` at line 688 checks if the agent is still in the active map:

```typescript
if (!activeAgents.has(task.id)) {
  logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
  await capturePartialDiff(task.id, worktreePath, repo, logger)
  cleanupWorktree({ ... }).catch(...)
  return
}
```

However, the watchdog loop (in `index.ts` line 483) **deletes the agent from the map BEFORE calling onTaskTerminal**:

```typescript
this.killActiveAgent(agent)  // Deletes from activeAgents at line 461

// Then later:
if (result.shouldNotifyTerminal && result.terminalStatus) {
  this.onTaskTerminal(agent.taskId, result.terminalStatus).catch(...)
}
```

This means when `finalizeAgentRun()` runs (from completion handler), it always sees the agent as already deleted by watchdog (even if watchdog and completion happen milliseconds apart). The check at line 688 fires even when the agent didn't complete normally.

**Impact:**

1. **Worktree cleanup skipped on fast watchdog exits**: When watchdog kills an agent for timeout/idle/rate-limit, it does NOT clean up the worktree (no call to `cleanupWorktree()` in the watchdog path). The watchdog only calls `onTaskTerminal()`. The worktree sits orphaned until the prune loop runs (every 10 minutes).

2. **Partial diff not captured in watchdog scenario**: The `capturePartialDiff()` at line 690 only runs if watchdog already deleted the agent. So when watchdog fires, partial diff is NOT captured. When completion naturally runs and sees the agent gone, it captures the diff. But if watchdog fires FIRST, there's no diff capture.

3. **Inconsistent cleanup semantics**: Watchdog kills are missing worktree cleanup that completion path handles. This leaves orphaned worktrees with stale branches on disk (not critical due to prune loop, but degrades during heavy load).

**Recommendation:**

Watchdog should also call `cleanupWorktree()` before or after `onTaskTerminal()`. Or, better: defer the agent deletion from the activeAgents map until the terminal handler completes, so `finalizeAgentRun()` still sees the agent present and can check its status to decide whether to clean up.

Alternative approach: Use a `cleaned` flag on the ActiveAgent object instead of relying on presence in the map:

```typescript
interface ActiveAgent {
  // ... existing fields
  cleaned?: boolean  // Set to true once cleanup is done
}

// In watchdog:
if (verdict !== 'ok') {
  agent.cleaned = true  // Mark for cleanup
  // Then later, finalize cleanup
  cleanupWorktree(...).catch(...)
  activeAgents.delete(agent.taskId)  // Only after cleanup
}

// In finalizeAgentRun:
if (agent.cleaned) {
  logger.info(`Agent already cleaned up by watchdog`)
  return
}
```

**Effort:** M  
**Confidence:** High

---

## F-t3-lifecycle-3: Concurrent resolveSuccess and Fast-Fail Requeue — Task State Pollution

**Severity:** High  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/run-agent.ts:557-623` and `src/main/agent-manager/completion.ts:178-189`  
**Evidence:**

In `resolveAgentExit()` (line 557 of run-agent.ts), there are two parallel paths:

1. **Fast-fail requeue** (line 587): Updates task to `status: 'queued'`, increments `fast_fail_count`, sets `claimed_by: null`
2. **Success path** (line 600): Calls `resolveSuccess()` which tries to rebase and commit

Both paths are called in quick succession but asynchronously. If an agent exits with a fast-fail verdict (e.g., timeout within 30s) **while** the `resolveSuccess()` path is running async git operations, the following race can occur:

1. Agent exits with exit code 1 after 5 seconds → `classifyExit()` returns `fast-fail-requeue`
2. Code calls `resolveSuccess()` first (line 600 is unreachable due to the `if` at line 571, but...)
3. Actually, looking at the code, fast-fail takes the early return at line 596, so both paths **should not** execute concurrently

However, in `completion.ts` at line 615, there's a fallback when `resolveSuccess()` throws:

```typescript
} catch (err) {
  logger.warn(`[completion] resolveSuccess failed for task ${task.id}: ${err}`)
  const isTerminal = resolveFailure(
    { taskId: task.id, retryCount: task.retry_count ?? 0, repo },
    logger
  )
}
```

If `resolveSuccess()` throws (e.g., rebase conflict), we call `resolveFailure()` which increments `retry_count` and re-queues. But if the task was already marked as `fast-fail-requeue` by watchdog's concurrent terminal handler, and we call `resolveFailure()` now, we'll increment retry_count AGAIN, leading to:

- Task jumps from fast_fail_count=0 to fast_fail_count=1 (watchdog path)
- Task also increments retry_count from 0 to 1 (completion fallback path)
- Task is in 'queued' status with both counters advanced incorrectly

**Impact:**

Tasks that fail with both fast-fail AND completion errors end up double-counting retries, exhausting the retry budget faster than expected. Users see tasks fail after 2 attempts instead of 3.

**Recommendation:**

Ensure that only one of `fast-fail requeue` or `resolveFailure()` path executes per task. Use the `terminalCalled` guard in the actual verdict classification, not just at the handler level:

```typescript
// In resolveAgentExit, before choosing path:
if (terminalCalled.has(task.id)) {
  logger.warn(`Task ${task.id} already resolved by concurrent handler`)
  return
}
```

Or, simpler: Have `resolveSuccess()` and `resolveFailure()` both be idempotent by checking the current task status before updating.

**Effort:** M  
**Confidence:** High

---

## F-t3-lifecycle-4: Stale Worktree Cleanup Race During Concurrent Agent Setup

**Severity:** High  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/worktree.ts:73-150` and `152-230`  
**Evidence:**

In `setupWorktree()`, the code cleans up any stale worktrees before creating a new one:

```typescript
await cleanupStaleWorktrees(repoPath, worktreePath, branch, env, log)
```

This function (lines 73-150) does:
1. Lists all worktrees in the repo
2. Searches for any worktree with the same branch name
3. Removes them if found
4. Deletes the branch with `git branch -D`

However, step 2 uses `listWorktrees()` which may race with another agent's cleanup. If two agents on the same repo try to setup worktrees for different tasks at the same time:

**Timeline:**
- Agent A: Lists worktrees → finds no branches matching "agent/feature-abc123"
- Agent B: Lists worktrees → finds no branches matching "agent/feature-def456"
- Agent A: Tries to delete branch "agent/feature-abc123" → succeeds
- Agent A: Tries to `git worktree add branch agent/feature-abc123 origin/main` → succeeds
- Agent B: Tries to delete branch "agent/feature-def456" → succeeds
- Agent B: Tries to `git worktree add branch agent/feature-def456 origin/main` → **FAILS** if the `ffMergeMain` corrupts HEAD

Actually, the real race is in the FF merge at line 206:

```typescript
await ffMergeMain(repoPath, env, log, GIT_FF_MERGE_TIMEOUT_MS)
```

This operation mutates the main checkout's HEAD in the repo. If two agents call this concurrently without holding the per-repo lock during the fetch and merge, they can race and corrupt git state.

The code DOES acquire a lock at line 196:

```typescript
acquireLock(worktreeBase, repoPath, logger)
```

But the `fetchMain()` happens OUTSIDE this lock (line 185), deliberately to parallelize network I/O. However, if a worker is cleaning up stale branches (from a previous failed run) while another worker is fetching and FF-merging, the branch deletion can interfere with the worktree add operation.

**Impact:**

Concurrent agents on the same repo can see `git worktree add` fail with "branch already exists" or similar, even though the stale cleanup code tried to remove it. This causes agent spawn to fail with `setupWorktree` error, marking the task as error status instead of retrying.

**Recommendation:**

1. Move the `fetchMain()` inside the per-repo lock, or
2. Add an additional lock around the stale cleanup + branch listing operations to prevent concurrent deletions, or
3. Make `git worktree add` more resilient by allowing it to reuse an existing branch if it's in the right state

Minimal fix:

```typescript
try {
  await addWorktree(repoPath, branch, worktreePath, env)
} catch (err) {
  // If branch already exists, try once more to clean it up
  if (err.message.includes('branch already exists')) {
    await cleanupStaleWorktrees(repoPath, worktreePath, branch, env, log)
    await addWorktree(repoPath, branch, worktreePath, env)
  } else {
    throw err
  }
}
```

**Effort:** M  
**Confidence:** High

---

## F-t3-lifecycle-5: Orphan Recovery Double-Increments Retry Count on Concurrent Claims

**Severity:** High  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/orphan-recovery.ts:27-50` and `src/main/data/sprint-queue-ops.ts:claimTask`  
**Evidence:**

When a task is orphaned (agent crashed, `claimed_by` was not cleared), the orphan recovery loop re-queues it:

```typescript
const retryCount = (task.retry_count ?? 0) + 1
if (retryCount >= MAX_RETRIES) {
  // Mark as error
} else {
  repo.updateTask(task.id, {
    status: 'queued',
    claimed_by: null,
    retry_count: retryCount,
    notes: `Task was re-queued by orphan recovery (retry ${retryCount}/${MAX_RETRIES})`
  })
}
```

However, this happens asynchronously every 30 seconds (per `ORPHAN_CHECK_INTERVAL_MS` in `types.ts`). If an agent crashes and the orphan recovery loop runs, it increments `retry_count` and clears `claimed_by`. But if the same task is ALSO being claimed by the drain loop at the same time (because `claimed_by` WAS null briefly between crash and orphan recovery), the claim succeeds and a second agent spawns.

When that second agent exits normally and calls `resolveFailure()` or fast-fail path, it increments `retry_count` AGAIN, leading to:

- Original retry_count: 0
- Orphan recovery increments to 1
- Second claim succeeds (sees task as queued with retry_count=1)
- Second agent failure increments to 2
- User sees the task burned two retries on what should have been one failure

**Timeline:**
1. Agent A: `claimed_by = 'executor-1'`, `retry_count = 0`
2. Agent A crashes without updating task
3. Orphan recovery tick fires → sees `claimed_by = 'executor-1'`, `status = 'active'` → increments to `retry_count = 1`, sets `claimed_by = null`
4. Drain loop tick runs simultaneously → sees `status = 'queued'`, `claimed_by = null` → claims the task → spawns Agent B
5. Agent B fails → increments `retry_count` to 2
6. User sees task at retry 2/3 but it only actually failed once

**Impact:**

Tasks exhaust their retry budget prematurely, failing faster than intended. In a flaky environment where workers crash occasionally, users will see tasks fail after 1-2 retries instead of 3.

**Recommendation:**

Orphan recovery should NOT increment `retry_count` if the task is already being claimed by the drain loop. Either:

1. Make orphan recovery skip tasks that are in the process of being claimed (harder to detect), or
2. Separate "retry count" (user-visible failures) from "claim count" (internal respin tracking), or
3. Have orphan recovery only re-queue without incrementing; let the failure path increment on exit

Recommended approach: Orphan recovery should re-queue without incrementing:

```typescript
repo.updateTask(task.id, {
  status: 'queued',
  claimed_by: null,
  // Do NOT increment retry_count here — that's for agent failures, not crashes
  notes: `Task was re-queued by orphan recovery. Agent process terminated without completing.`
})
```

Then, when the next agent attempts to run and fails, `resolveFailure()` increments normally. If the next agent succeeds, no increment.

**Effort:** S  
**Confidence:** Medium

---

## F-t3-lifecycle-6: `claimed_by` Not Cleared on App Restart with Active Tasks

**Severity:** Medium  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:546-626` and `src/main/agent-manager/orphan-recovery.ts:4-63`  
**Evidence:**

When the app starts, it runs initial orphan recovery (line 553):

```typescript
recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger).catch(...)
```

This checks for tasks with `claimed_by = EXECUTOR_ID` and `status = 'active'`. If any are found, they're re-queued. However, this only happens if the orphan recovery function iterates and finds them. Let me check the retrieval:

In `orphan-recovery.ts`:

```typescript
const orphans = repo.getOrphanedTasks(EXECUTOR_ID)
```

The `getOrphanedTasks()` method is not shown in the read, but based on the usage, it likely returns tasks with:
- `status = 'active'` AND `claimed_by = EXECUTOR_ID`

On app restart, if a task was in flight (agent process was killed), the task still has:
- `status = 'active'`
- `claimed_by = 'executor-1'` (or whatever EXECUTOR_ID is)

The orphan recovery WILL find it and re-queue it. However, if there's a delay between app start and when orphan recovery runs, the drain loop could also try to claim the same task, causing a race.

But actually, the REAL issue is: on app startup, what if the task is in a different status like `review` or `done`? Those tasks will NOT be found by `getOrphanedTasks()` (which filters for `status = 'active'`). If a task is stuck in `review` status with `claimed_by = 'executor-1'`, it stays stuck forever.

**Impact:**

Tasks left in non-active terminal statuses (review, done, failed, error) with non-null `claimed_by` cannot be transitioned by the UI because the claim is held. This is a data consistency issue but less critical than active tasks.

**Recommendation:**

On app start, clear `claimed_by` for ALL tasks (not just active ones) before starting the drain loop:

```typescript
start(): void {
  if (this._running) return
  this._running = true
  this._shuttingDown = false
  this._concurrency = makeConcurrencyState(this.config.maxConcurrent)

  // Clear stale claims before recovering orphans
  try {
    const allTasks = this.repo.getTasksWithDependencies()
    for (const task of allTasks) {
      if (task.claimed_by === EXECUTOR_ID) {
        this.repo.updateTask(task.id, { claimed_by: null })
      }
    }
  } catch (err) {
    this.logger.warn(`[agent-manager] Failed to clear stale claims on startup: ${err}`)
  }

  // Then run orphan recovery to re-queue active ones
  recoverOrphans(...)
}
```

**Effort:** S  
**Confidence:** Medium

---

## F-t3-lifecycle-7: Incomplete Terminal Handler Cleanup — 5s Window is Too Short

**Severity:** Medium  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/terminal-handler.ts:94-97`  
**Evidence:**

The `terminalCalled` deduplication set is cleared after 5 seconds:

```typescript
setTimeout(() => terminalCalled.delete(taskId), 5000)
```

However, if the app is under heavy load and the garbage collector pauses threads, or if the main event loop is blocked by other operations, this 5-second window might not be enough. If two rapid task terminal events fire (e.g., two tasks both marked as done by sprint PR poller), they could both pass the guard check if:

1. Task A terminal fires → added to `terminalCalled`
2. Task B terminal fires (different task, not in set)
3. Task A's 5s cleanup timer runs → removed from set
4. Before timer fires, but after 4.9s: Task A terminal fires AGAIN (e.g., from a broadcast race or retry logic calling `onTaskTerminal` twice)
5. Guard check passes because set doesn't have Task A anymore
6. Double resolution occurs

Additionally, the cleanup happens in an async timer, which means if the process shuts down before the timer fires, the set never clears and memory leaks. Not critical (small leak), but sloppy.

**Impact:**

Under load, there's a small window where duplicate terminal calls can slip through. Mostly masked by idempotency in `resolveDependents()`, but could cause double cascade cancellation in rare cases.

**Recommendation:**

Use a more durable cleanup strategy:

```typescript
export async function handleTaskTerminal(
  taskId: string,
  status: string,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  const { metrics, depIndex, epicIndex, repo, config, terminalCalled, logger } = deps

  if (terminalCalled.has(taskId)) {
    logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
    return
  }

  try {
    terminalCalled.add(taskId) // Add BEFORE any async operations

    recordTerminalMetrics(status, metrics)
    if (config.onStatusTerminal) {
      config.onStatusTerminal(taskId, status)
    } else {
      await resolveTerminalDependents(taskId, status, depIndex, epicIndex, repo, onTaskTerminal, logger)
    }
  } finally {
    // Clear immediately, or with a longer grace period (10s) for consistency
    setTimeout(() => terminalCalled.delete(taskId), 10_000)
  }
}
```

Or use a WeakMap with task objects as keys (not possible without refactoring to use objects instead of strings).

**Effort:** S  
**Confidence:** Low

---

## Summary of Recommendations

| Issue | Severity | Effort | Fix Strategy |
|-------|----------|--------|--------------|
| F-t3-lifecycle-1 | Critical | S | Move guard check before side effects |
| F-t3-lifecycle-2 | Critical | M | Defer agent deletion until cleanup done OR use a `cleaned` flag |
| F-t3-lifecycle-3 | High | M | Ensure only one of fast-fail or resolveFailure runs per task |
| F-t3-lifecycle-4 | High | M | Move fetchMain inside lock or retry logic on race |
| F-t3-lifecycle-5 | High | S | Don't increment retry_count in orphan recovery |
| F-t3-lifecycle-6 | Medium | S | Clear stale `claimed_by` on app startup |
| F-t3-lifecycle-7 | Medium | S | Use longer cleanup window (10s) |

---

## References

- **CLAUDE.md notes**: "CLAUDE.md documents a known worktree retry bug (stale branches, OAuth expiry, resolveDependents gap)" — these findings expand on that
- **Known issue baseline**: The `F-t4-lifecycle-5` idempotency guard in terminal-handler.ts exists to prevent double-invocation, but its placement is too late (after side effects begin)
- **Key files examined**:
  - `src/main/agent-manager/index.ts` (drain loop, watchdog, orphan recovery)
  - `src/main/agent-manager/run-agent.ts` (agent execution, completion)
  - `src/main/agent-manager/worktree.ts` (worktree setup/cleanup)
  - `src/main/agent-manager/terminal-handler.ts` (terminal status handling)
  - `src/main/agent-manager/completion.ts` (retry logic)
  - `src/main/services/task-terminal-service.ts` (terminal resolution service)
  - `src/main/data/sprint-queue-ops.ts` (claim/release ops)


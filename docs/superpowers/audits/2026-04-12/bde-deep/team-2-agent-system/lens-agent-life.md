# Agent Lifecycle System Audit — 2026-04-12

## Executive Summary

The BDE agent lifecycle pipeline exhibits **3 critical gaps** and **2 race condition vulnerabilities** across the drain loop → task claim → worktree creation → agent spawn → watchdog → completion → status transition → worktree cleanup flow. Most critically: (1) `resolveDependents()` is **not called on all terminal paths** in completion handlers, creating orphaned downstream tasks; (2) the watchdog **aborts the agent process but does NOT forcefully kill it**, leaving stale processes consuming resources; (3) app shutdown **does NOT wait for finalizeAgentRun()** to complete, allowing in-flight cleanup and dependency resolution to be lost. Two additional race conditions exist where concurrent drain ticks can claim the same task if there's a gap between `getQueuedTasks()` and `claimTask()`, and where watchdog kills can race with completion handlers on the `_terminalCalled` guard.

---

## F-t2-agent-life-1: resolveDependents() Missing on Early Completion Paths

**Severity:** Critical  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/completion.ts:551-655` and `src/main/agent-manager/run-agent.ts:580-736`

**Evidence:**

The `resolveSuccess()` function in completion.ts has **6 early-return paths** where a task reaches terminal or pre-terminal state (error, failed, review) but **never calls `onTaskTerminal()`** which is the only place that triggers `resolveDependents()`:

1. Line 555-565: Worktree doesn't exist (macOS /tmp eviction) → task set to 'error' → **no terminal callback**
2. Line 572-580: Branch detection fails → task set to 'error' → **no terminal callback**
3. Line 583-593: Empty branch name → task set to 'error' → **no terminal callback**
4. Line 621-632: No commits ahead of main → `resolveFailure()` called but **only updates DB, may not reach terminal status**, and caller never calls `onTaskTerminal()` even when `isTerminal=true`
5. In `run-agent.ts:582-623`, if watchdog already cleaned up the agent before `finalizeAgentRun()` runs, the function returns early at line 623 **without calling `onTaskTerminal()`**

**Impact:**

When a task fails during completion (e.g., worktree evicted, branch detection fails), all downstream blocked tasks remain stuck in 'blocked' status forever. The dependency resolution system is **completely bypassed**, leaving the task graph in an inconsistent state. In a multi-sprint scenario with cascading epics, this silently breaks entire feature branches.

**Recommendation:**

Wrap every error path in completion.ts with explicit `onTaskTerminal(taskId, 'error')` calls before returning. Add a safeguard: if task reaches terminal status in completion.ts, ALWAYS call `onTaskTerminal()` regardless of path. Consider a `finally` block pattern:

```typescript
try {
  // steps
  if (error) {
    repo.updateTask(taskId, { status: 'error', ... })
    return // WRONG: this returns without onTaskTerminal
  }
} finally {
  // Check if task is terminal and ensure onTaskTerminal was called
  const task = repo.getTask(taskId)
  if (isTerminal(task?.status)) {
    this._terminalCalled.has(taskId) || await onTaskTerminal(taskId, task.status)
  }
}
```

**Effort:** M  
**Confidence:** High

---

## F-t2-agent-life-2: Watchdog abort() Does Not Kill Agent Process

**Severity:** Critical  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:627` and `src/main/agent-manager/watchdog-handler.ts:24-94`

**Evidence:**

In the watchdog loop (index.ts, line 620-657), when a verdict is reached (max-runtime, idle, rate-limit-loop, cost-budget-exceeded), the code **only calls `agent.handle.abort()`**:

```typescript
try {
  agent.handle.abort()  // Line 627
} catch (err) {
  this.logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
}
```

The `abort()` method on `AgentHandle` (defined in types.ts:60-67) is a method on the SDK's handle object. There is **no documentation or test** showing what `abort()` actually does. Likely behavior: it sets a cancellation flag and stops consuming the message stream, but **does NOT force-kill the underlying subprocess**. The agent process continues running (or hangs), consuming CPU/memory, and the OS will not reap it until the Electron app exits or explicit SIGTERM/SIGKILL is sent.

**Impact:**

A rate-limited agent marked for restart by watchdog will continue making API calls in the background, compounding the rate-limit problem. An idle agent (no output for 15min) stays alive, consuming memory. A cost-over-budget agent will keep spending credits. The watchdog can kill 10 agents/minute (WATCHDOG_INTERVAL_MS = 10s), and if each leaks 50MB, the app will OOM in ~30min under load.

**Recommendation:**

After `agent.handle.abort()`, forcefully kill the underlying process:

```typescript
try {
  agent.handle.abort()
  // Force-kill the process. The SDK handle should expose the PID or process.
  if (agent.handle.process && typeof agent.handle.process.kill === 'function') {
    agent.handle.process.kill('SIGKILL')
  }
} catch (err) {
  this.logger.warn(`[agent-manager] Failed to kill agent ${agent.taskId}: ${err}`)
}
```

Alternatively, if the SDK handle doesn't expose the PID, add a timeout-based check: if the agent is removed from `_activeAgents` but `consumeMessages()` never settles, treat it as hung and log an alert.

**Effort:** M  
**Confidence:** High

---

## F-t2-agent-life-3: App Shutdown Does Not Wait for finalizeAgentRun() Completion

**Severity:** Critical  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:778-844`

**Evidence:**

The `stop()` method:

1. Sets `_shuttingDown = true` (line 779)
2. Clears all timers (lines 781-796)
3. Waits for in-flight drain to complete (lines 799-804)
4. Aborts all agents (lines 807-815)
5. Waits for agent promises with timeout (lines 818-822)
6. Re-queues orphaned tasks (lines 825-837)

**The problem:** An agent's `runAgent()` promise includes the full lifecycle — spawn, consume messages, AND **`finalizeAgentRun()`**. However, `finalizeAgentRun()` (run-agent.ts:583-736) includes:

- `resolveSuccess()` which can take 30+ seconds (git rebase, PR creation)
- Transitive `onTaskTerminal()` call which calls `resolveDependents()` synchronously
- Worktree cleanup

But `stop()` **only waits 10 seconds** (timeoutMs default = 10_000). If an agent has a slow rebase or PR creation, the `finalizeAgentRun()` promise will still be running when the timeout fires, and `stop()` proceeds to shutdown **before dependency resolution completes**.

**Impact:**

On app shutdown during agent finalization:
1. Task reaches 'review' status but dependent tasks never get unblocked
2. Partial diff is never captured
3. Worktree cleanup may fail mid-operation, leaving stale branches
4. `flushAgentEventBatcher()` (line 841) may flush incomplete events

The 10-second timeout is arbitrary and does not account for real-world git operations (rebase on a large repo: 20-30s, PR creation: 5-10s).

**Recommendation:**

Increase the timeout to at least 60 seconds, and add explicit waiting for pending dependency resolution:

```typescript
async stop(timeoutMs = 60_000): Promise<void> {
  this._shuttingDown = true
  // ... clear timers, abort agents ...
  
  // Wait for agent promises with increased timeout
  if (this._agentPromises.size > 0) {
    const allSettled = Promise.allSettled([...this._agentPromises])
    const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs))
    const result = await Promise.race([allSettled, timeout])
    
    if (result === timeout) {
      this.logger.warn(`[agent-manager] Agent promises did not settle within ${timeoutMs}ms`)
      // Log pending agents for debugging
      for (const agent of this._activeAgents.values()) {
        this.logger.warn(`[agent-manager] Still running: task ${agent.taskId} started at ${new Date(agent.startedAt).toISOString()}`)
      }
    }
  }
  
  // Also wait for any pending terminal callbacks
  while (this._terminalCalled.size > 0) {
    await new Promise(r => setTimeout(r, 100))
  }
  
  // Re-queue orphaned tasks ...
  flushAgentEventBatcher()
  this._running = false
}
```

**Effort:** M  
**Confidence:** High

---

## F-t2-agent-life-4: Race Condition — Two Drain Ticks Claim Same Task

**Severity:** High  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:576-597` and `src/main/data/sprint-queries.ts:486-533`

**Evidence:**

The drain loop (index.ts:576-597) follows this sequence:

```typescript
const queued = this.fetchQueuedTasks(available)  // Line 581: DB query, returns N tasks
for (const raw of queued) {                       // Line 583
  const claimed = this.claimTask(task.id)        // Line 436
  if (!claimed) {
    logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
    return
  }
  // spawn agent
}
```

**The race:** Between lines 581 and 436, another drain tick (or external runner) can call `claimTask()` on the same task. While `claimTask()` is atomic (wrapped in a SQLite transaction, line 492-524 of sprint-queries.ts), the window between `getQueuedTasks()` and `claimTask()` is **not atomic**:

1. Drain tick A: `getQueuedTasks()` returns [task-1, task-2, task-3]
2. Drain tick B: `getQueuedTasks()` returns [task-1, task-2, task-3] (same list, still in 'queued' status)
3. Tick A: `claimTask(task-1)` succeeds
4. Tick B: `claimTask(task-1)` returns null (already claimed)
5. Both ticks proceed; only Tick A spawns the agent, but both ticks registered task-1 as "processing"

**The actual issue:** If two instances of the app are running (or if the app crashes and restarts while a task is in `_processingTasks`), the same task can be claimed and spawned twice. The SQLite WHERE clause `status = 'queued'` prevents double-spawn at the DB level, but in the brief window, race conditions can occur.

**Impact:**

In a clustered setup (multiple BDE instances), the same task can be spawned in two agents simultaneously, both claiming the same worktree, both creating PRs, leading to duplicate work and merge conflicts.

**Recommendation:**

Option 1: Move the claim into `getQueuedTasks()` as an atomic operation — fetch and claim in one transaction:

```typescript
// In sprint-queries.ts
export function fetchAndClaimQueuedTasks(limit: number, claimedBy: string): SprintTask[] {
  return db.transaction(() => {
    const tasks = db.prepare(`SELECT ... WHERE status = 'queued' LIMIT ?`).all(limit)
    for (const task of tasks) {
      db.prepare(`UPDATE sprint_tasks SET status = 'active', claimed_by = ? WHERE id = ?`)
        .run(claimedBy, task.id)
    }
    return tasks
  })()
}
```

Option 2: Add a process-wide lock in `_drainLoop()` that's held until all spawns complete.

**Effort:** L  
**Confidence:** Medium (only manifests in multi-instance scenarios)

---

## F-t2-agent-life-5: Race Condition — Watchdog vs. Completion Handler on _terminalCalled Guard

**Severity:** High  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:224-266` and `608-657`

**Evidence:**

The `_terminalCalled` guard (line 140, 226, 651) is designed to prevent double dependency resolution when watchdog kills an agent and the completion handler tries to finalize. The mechanism:

```typescript
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  // F-t4-lifecycle-5: Guard against double-invocation when watchdog and completion handler race
  if (this._terminalCalled.has(taskId)) {
    this.logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
    return
  }
  this._terminalCalled.add(taskId)  // Line 230
  
  try {
    // dependency resolution
  } finally {
    setTimeout(() => this._terminalCalled.delete(taskId), 5000)  // Line 265
  }
}
```

**The race:** 

1. Watchdog verdict: `rate-limit-loop`
2. Watchdog calls `agent.handle.abort()` and deletes agent from `_activeAgents` (line 633)
3. Watchdog calls `onTaskTerminal(taskId, 'queued')` (line 651) → adds taskId to `_terminalCalled`
4. Meanwhile, `consumeMessages()` finishes (the async iterator completes)
5. `finalizeAgentRun()` begins execution in the agent promise
6. But watchdog already called `onTaskTerminal()`, so `_terminalCalled` contains taskId
7. `finalizeAgentRun()` reaches line 651 and calls `onTaskTerminal()` again, but **guard returns early**

However, the watchdog's call only re-queues the task (status='queued', no terminal callback since `shouldNotifyTerminal=false` for rate-limit-loop). The completion handler's call would have set status='review' and called `resolveDependents()` which **never happens**.

**Impact:**

Watchdog-killed agents that should transition to 'review' instead stay 'queued', and dependencies are never resolved. The task is essentially "reset" by watchdog, which may be correct for rate-limit-loop, but if there are commits on the branch, those commits are lost.

**Recommendation:**

Instead of a simple boolean guard, differentiate between watchdog's re-queueing and completion's finalization:

```typescript
async onTaskTerminal(
  taskId: string, 
  status: string, 
  source: 'watchdog' | 'completion' = 'completion'
): Promise<void> {
  // Allow both watchdog and completion to call, but track which won
  const key = `${taskId}:${source}`
  if (this._terminalCalled.has(key)) {
    this.logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId} from ${source}`)
    return
  }
  this._terminalCalled.add(key)
  
  // If this is a re-queueing from watchdog (status='queued'), skip resolution
  if (status === 'queued') {
    try {
      // Mark as re-queued but don't resolve dependents
    } finally {
      // ...
    }
    return
  }
  
  // Terminal call from completion — resolve dependents
  // ...
}
```

**Effort:** M  
**Confidence:** Medium (subtle, doesn't always manifest)

---

## F-t2-agent-life-6: Retry State NOT Persisted Across App Restart

**Severity:** Medium  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/fast-fail.ts:1-16` and `src/main/agent-manager/types.ts:38-40`

**Evidence:**

Fast-fail detection uses `fast_fail_count` from the task record (run-agent.ts:37). The logic (fast-fail.ts:5-16):

```typescript
if (exitCode === 0) return 'normal-exit'
if (exitedAt - spawnedAt >= FAST_FAIL_THRESHOLD_MS) return 'normal-exit'
const newCount = currentFastFailCount + 1
return newCount >= MAX_FAST_FAILS ? 'fast-fail-exhausted' : 'fast-fail-requeue'
```

If an agent fails < 30s after spawn (FAST_FAIL_THRESHOLD_MS = 30_000), `fast_fail_count` increments. When `fast_fail_count >= MAX_FAST_FAILS (3)`, the task is marked 'error'.

**However:** The fast-fail window is based on **wallclock time** (`exitedAt - spawnedAt`), which resets across app restarts. If:

1. Attempt 1: App starts, agent spawns at T=0, crashes at T=10s → fast_fail_count=1
2. App restarts (e.g., code push)
3. Attempt 2: Agent spawns at T=1800s, crashes at T=1810s → duration is 10s again → fast_fail_count=2
4. Attempt 3: Agent spawns at T=3600s, crashes at T=3610s → duration is 10s again → fast_fail_count=3 → **error**

But from the user's perspective, ~60 minutes have elapsed between the crashes, not "30 seconds." The fix (in completion.ts:655) does correctly persist `fast_fail_count` to the DB, but the **30-second window is per-spawn, not global**. This is actually correct behavior for detecting fast-fail crashes, but **the documentation is unclear** and operators might expect a sliding window.

**Impact:**

A task that crashes slowly (once per hour) will eventually hit fast-fail-exhausted after 3 crashes spread over 2+ hours. If the crashes are due to a transient resource issue that resolves after the 3rd crash, the task will never recover.

**Recommendation:**

Add a `fast_fail_window_starts_at` timestamp to track when the current fast-fail window opened. Reset `fast_fail_count` if the window has exceeded (e.g., 5 minutes). This prevents hour-long gaps from counting toward fast-fail:

```typescript
const windowAge = now - (task.fast_fail_window_starts_at || task.started_at)
if (windowAge > 5 * 60 * 1000) {
  // Window expired — reset counter
  fastFailCount = 1
  fastFailWindowStartsAt = now
} else {
  fastFailCount = (task.fast_fail_count ?? 0) + 1
}
```

**Effort:** M  
**Confidence:** Medium (edge case, but legitimate)

---

## F-t2-agent-life-7: Worktree Cleanup Does NOT Detect Stale Branches on Startup

**Severity:** Medium  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/worktree.ts:273-340`

**Evidence:**

The `pruneStaleWorktrees()` function (worktree.ts:273-340) is called on startup and every 5 minutes. It removes worktrees for tasks that are NOT in `_activeAgents` and NOT in 'review' status. However, the check is:

```typescript
if (isActive(taskId)) continue    // Line 320
if (isReview?.(taskId)) continue  // Line 322
// Delete the worktree
```

This query happens at startup when `_activeAgents` is empty (agents have not been recovered yet). The orphan recovery loop (line 759-773 in index.ts) runs BEFORE the initial drain, but there's a race:

1. App starts
2. `pruneStaleWorktrees()` is called (line 730)
3. At that moment, `_activeAgents` is empty, so all worktrees are "stale"
4. But the task in DB might be status='active' (crashed agents)
5. The prune DOES NOT check task status — it only checks if the task ID is in `_activeAgents`

**Impact:**

If an agent crashes and the app restarts before orphan recovery runs, a worktree can be pruned even though the task is still 'active' in the DB. When the drain loop tries to spawn a new agent on the task, `setupWorktree()` will recreate the branch, wasting time and potentially using a different base commit.

**Recommendation:**

Add a task-status check to the prune logic:

```typescript
if (isActive(taskId)) continue
if (isReview?.(taskId)) continue
// NEW: Check if task is still in an active/running state
const task = getTask?.(taskId)
if (task && (task.status === 'active' || task.status === 'blocked')) continue
// Delete the worktree
```

**Effort:** S  
**Confidence:** Medium

---

## F-t2-agent-life-8: resolveDependents() Evicts Terminal Tasks from Fingerprint Cache

**Severity:** Low  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/index.ts:546-566`

**Evidence:**

The drain loop maintains `_lastTaskDeps` to cache dependency fingerprints (F-t1-sysprof-1 optimization). The code:

```typescript
for (const task of allTasks) {
  if (isTerminal(task.status)) {
    // Terminal tasks' deps are frozen — evict from fingerprint cache
    this._lastTaskDeps.delete(task.id)  // Line 556
    continue
  }
  // Update if deps changed
}
```

This is correct — terminal tasks never change. However, the **dependency index itself retains edges for terminal tasks** (line 538 does NOT remove from `_depIndex` when status is terminal). This creates a semantic mismatch: the dependency graph includes terminal tasks, but the fingerprint cache does not.

**Impact:**

Minimal — the dep-index correctly answers "are dependencies satisfied?" because it still has edges from terminal tasks. However, if a task's dependencies INCLUDE a terminal task, and we call `resolveDependents()` on a third task, the logic will correctly find the terminal task in the index and check its satisfaction.

This is actually fine and intentional (terminal task deps are stable, so no need to track them). The only risk: if someone later adds code that assumes "task in `_lastTaskDeps` ⟺ task in `_depIndex`", it will break. Recommend adding a comment clarifying the invariant.

**Recommendation:**

Add explicit documentation in the code:

```typescript
// Terminal tasks are evicted from fingerprint cache because their deps never change.
// However, they remain in _depIndex so dependency-satisfaction checks still work.
// Invariant: isTerminal(task) ⟹ (task not in _lastTaskDeps) but (task edges still in _depIndex)
this._lastTaskDeps.delete(task.id)
```

**Effort:** S  
**Confidence:** Low

---

## F-t2-agent-life-9: max_runtime_ms Per-Task Override NOT Enforced at Spawn

**Severity:** Low  
**Category:** Agent Lifecycle  
**Location:** `src/main/agent-manager/run-agent.ts:40`, `index.ts:529`, and `watchdog.ts:9`

**Evidence:**

The task has an optional `max_runtime_ms` override (run-agent.ts:40). This is passed to the agent (line 439) and stored in `agent.maxRuntimeMs` (run-agent.ts:529). The watchdog checks it (watchdog.ts:9):

```typescript
const maxRuntime = agent.maxRuntimeMs ?? config.maxRuntimeMs
if (now - agent.startedAt >= maxRuntime) return 'max-runtime'
```

However, there's no documentation on **when the override takes effect**. If you set `max_runtime_ms=1000` on a task:

- Is it enforced as soon as spawn completes? (1 second of wall time)
- Is it enforced relative to when the agent received the constraint in the prompt? (might be 10+ seconds into the agent's thinking)
- Is it a limit on the agent's own `max_runtime_ms` limit within the SDK?

**Impact:**

Confusion for operators. A task with `max_runtime_ms=30000` that should be killed in 30 seconds might actually run for 35+ seconds (spawn takes 5 seconds, so wall time between now and `agent.startedAt` won't hit 30s threshold until after 35s elapsed).

**Recommendation:**

Document clearly:

```typescript
/**
 * max_runtime_ms is a per-task override for max agent runtime.
 * Measured from when the agent process is spawned (startedAt).
 * The watchdog checks this interval and kills agents that exceed it.
 * 
 * Note: Spawn itself takes ~5 seconds, so a 30s limit means the agent
 * has ~25s of actual execution time.
 */
```

**Effort:** S  
**Confidence:** Low

---

## Summary Table

| Finding | Severity | Category | Fix Effort | Impact |
|---------|----------|----------|-----------|--------|
| F-t2-agent-life-1: Missing resolveDependents on completion paths | Critical | Lifecycle | M | Orphaned downstream tasks |
| F-t2-agent-life-2: Watchdog abort() doesn't kill process | Critical | Lifecycle | M | Resource leak, stale processes |
| F-t2-agent-life-3: App shutdown doesn't wait for finalizeAgentRun | Critical | Lifecycle | M | Lost dependency resolution on quit |
| F-t2-agent-life-4: Double-claim race between drain ticks | High | Race | L | Duplicate agent spawns (multi-instance) |
| F-t2-agent-life-5: Watchdog vs completion race on _terminalCalled | High | Race | M | Dependencies not resolved after watchdog kill |
| F-t2-agent-life-6: Fast-fail window resets on app restart | Medium | Lifecycle | M | Task can exhaust retries over hours instead of 30s |
| F-t2-agent-life-7: Prune doesn't check task status | Medium | Lifecycle | S | Worktrees pruned while task still active |
| F-t2-agent-life-8: Terminal task fingerprint cache eviction | Low | Lifecycle | S | Code clarity / documentation only |
| F-t2-agent-life-9: max_runtime_ms override timing unclear | Low | Lifecycle | S | Documentation only |

**Key Recommendations:**
1. **Immediate (Critical):** Fix completion.ts to always call `onTaskTerminal()` on error paths
2. **Immediate (Critical):** Add process kill logic to watchdog, don't just abort()
3. **High Priority:** Increase app shutdown timeout to 60s and wait for finalizeAgentRun completion
4. **High Priority:** Make task claim atomic with fetch (single DB transaction)
5. **Medium Priority:** Clarify _terminalCalled guard or switch to source-based de-dup

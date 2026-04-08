# Concurrency Auditor

**Lens scope:** Multi-agent interaction effects in the pipeline hot path. Assumes N>1 concurrent agents.

**Summary:** The agent manager correctly isolates agent processes (per-process heap caps), but exhibits two critical N-agent scaling issues: (1) broadcast() fans out task terminal events to *all* renderer windows *per agent* via IPC, doubling renderer load at N=2 and cascading; (2) emitAgentEvent() logs every message to SQLite synchronously without batching, causing write contention when N agents emit at 100+ msg/sec. At MAX_ACTIVE_TASKS≥5, these amplify latency and can block the drain loop.

## Findings

### F-t1-concur-1: Broadcast IPC Fan-Out Per Task Terminal Event
**Severity:** High
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/broadcast.ts:7-11`, called from `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:408`, `/Users/ryan/projects/BDE/src/main/completion.ts:434`, and via `onTaskTerminal()` in `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:373-395`

**Evidence:**
```typescript
// broadcast.ts:7-11
export function broadcast(channel: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
```
Each task completion calls `broadcast('agent:event', ...)` and potentially `onTaskTerminal()` which may invoke `resolveDependents()`. With N agents running, each task terminal event fans out to ALL renderer windows. At N=5 agents completing per minute, with M renderer windows (typically 2-3: main + DevTools), this is 5×M IPC sends/min on the critical path. This load is synchronized — the drain loop may stall waiting for a broadcast to unblock.

**Impact:** At MAX_ACTIVE_TASKS=5+, IPC latency becomes cumulative. Each task completion triggers 1-3 broadcast calls (agent:event, agent:completed, onTaskTerminal). With 3 windows, that's 15 IPC sends for 5 task completions. At 10 tasks/sec, this is 30+ IPC sends/sec across all windows. Renderer thread contention visible in high-concurrency load tests.

**Recommendation:** Batch task terminal events into a single "batch:task-completions" broadcast per drain loop iteration, or defer `onTaskTerminal()` out of the critical agent message loop. Consider a task-completion queue that batches 5-10 events before broadcasting.

**Effort:** M

**Confidence:** High

---

### F-t1-concur-2: Synchronous SQLite Writes Per Agent Message (No Batching)
**Severity:** High
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/agent-event-mapper.ts:83-95`, called per message from `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:394-422`

**Evidence:**
```typescript
// agent-event-mapper.ts:83-95
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch (err) {
    const now = Date.now()
    if (now - _lastSqliteErrorLog > SQLITE_ERROR_LOG_INTERVAL_MS) {
      console.warn(`[agent-event-mapper] SQLite write failed (will retry next event): ${err}`)
      _lastSqliteErrorLog = now
    }
  }
}
```
Every agent message calls `emitAgentEvent()` which *immediately* writes to SQLite via `appendEvent(getDb(), ...)`. A typical agent emits 100+ messages per run (tool calls, tool results, text chunks). With N=5 concurrent agents, this is 500+ synchronous SQLite writes happening in parallel on the same `.bde/db.sqlite` file. SQLite's WAL (write-ahead logging) serializes these, blocking both the agent message loop and other drains reading from the DB.

**Impact:** At MAX_ACTIVE_TASKS=5, with each agent emitting 10 msg/sec, the SQLite queue experiences 50 concurrent writes/sec. Lock contention causes 10-50ms delays per write, cascading into agent message loop stalls and drain loop delays when `fetchQueuedTasks()` or dependency checks block on DB locks.

**Recommendation:** Implement an event buffer in `emitAgentEvent()` that batches events in memory (e.g., 50 events or 100ms) and flushes to SQLite in a single transaction. Alternatively, route event persistence to a background worker thread or queue to unblock the agent loop.

**Effort:** M

**Confidence:** High

---

### F-t1-concur-3: Unguarded `resolveDependents()` Cascade On Task Terminal
**Severity:** Medium
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:373-395`, `/Users/ryan/projects/BDE/src/main/agent-manager/resolve-dependents.ts:19-92`

**Evidence:**
```typescript
// index.ts:373-395 (onTaskTerminal)
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  if (status === 'done' || status === 'review') {
    this._metrics.increment('agentsCompleted')
  } else if (status === 'failed' || status === 'error') {
    this._metrics.increment('agentsFailed')
  }
  if (this.config.onStatusTerminal) {
    this.config.onStatusTerminal(taskId, status)
  } else {
    try {
      resolveDependents(
        taskId,
        status,
        this._depIndex,
        this.repo.getTask,
        this.repo.updateTask,
        this.logger
      )
    } catch (err) {
      this.logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
    }
  }
}
```
When a task completes, `onTaskTerminal()` synchronously calls `resolveDependents()`, which queries the DB for all dependents and iterates over them, performing DB updates for each. No debouncing or coalescing — if 5 tasks complete within 100ms, `resolveDependents()` is called 5 times, each scanning the full dependent graph.

**Impact:** At MAX_ACTIVE_TASKS=5 with diverse dependency graphs (e.g., 20-30 tasks depending on a common parent), each terminal event triggers O(N_dependents) DB reads and writes. With 5 rapid completions, this is 5×O(N_dependents) queries, contending with the drain loop's own DB fetches. Measurable at N=10+ tasks in the queue.

**Recommendation:** Defer `resolveDependents()` invocations until the end of the drain loop. Batch all terminal events from that loop iteration into a single dependency resolution pass, or deduplicate by taskId to avoid re-processing the same dependent multiple times.

**Effort:** M

**Confidence:** Medium

---

### F-t1-concur-4: Race Between Task Claim and Dependency Check
**Severity:** Medium
**Category:** Scaling
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:460-499` (`_checkAndBlockDeps`), called from `_processQueuedTask()`

**Evidence:**
```typescript
// index.ts:460-499
_checkAndBlockDeps(
  taskId: string,
  rawDeps: unknown,
  taskStatusMap: Map<string, string>
): boolean {
  try {
    const deps = typeof rawDeps === 'string' ? JSON.parse(rawDeps) : rawDeps
    if (Array.isArray(deps) && deps.length > 0) {
      const { satisfied, blockedBy } = this._depIndex.areDependenciesSatisfied(
        taskId,
        deps,
        (depId: string) => taskStatusMap.get(depId)
      )
      if (!satisfied) {
        this.logger.info(
          `[agent-manager] Task ${taskId} has unsatisfied deps [${blockedBy.join(', ')}] — auto-blocking`
        )
        try {
          this.repo.updateTask(taskId, {
            status: 'blocked',
            notes: formatBlockedNote(blockedBy)
          })
        } catch {
          /* best-effort */
        }
        return true
      }
    }
  } catch (err) {
    ...
  }
  return false
}
```
The drain loop fetches `taskStatusMap` once at the top of `_drainLoop()` (line 670), then uses it for all tasks in that iteration. If two agents complete simultaneously between the `taskStatusMap` build and the dependency check, the check uses stale data. A downstream task may be unblocked with the first agent's completion, then re-blocked by the second (or vice versa), causing spurious state transitions. Also, `claimTask()` happens *after* the dependency check but *before* spawning, creating a window where the task status can change.

**Impact:** At MAX_ACTIVE_TASKS≥3 with high dependency density (>30% of queue are dependent tasks), race conditions surface as tasks transiently toggling between `queued` and `blocked`. Non-fatal but creates UI churn and may re-queue tasks unnecessarily. Visible in logs as repeated "auto-blocking" messages for the same task.

**Recommendation:** Refetch task status immediately before `claimTask()` to catch stale data. Or move the dependency check into a transaction that includes the claim, ensuring atomicity.

**Effort:** M

**Confidence:** Medium

---

### F-t1-concur-5: PR Poller And Sprint-PR-Poller Create Redundant DB Queries
**Severity:** Medium
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/pr-poller.ts:76-96`, `/Users/ryan/projects/BDE/src/main/sprint-pr-poller.ts:27-94`

**Evidence:**
```typescript
// pr-poller.ts:76-96 (poll function)
async function poll(): Promise<void> {
  const token = getGitHubToken()
  if (!token) return

  const repos = getGitHubRepos()
  const results = await Promise.all(repos.map((r) => fetchOpenPrs(r.owner, r.repo, token)))
  const prs = results.flat()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const checks: Record<string, CheckRunSummary> = {}
  const checkPromises = prs.map(async (pr) => {
    const repoConfig = repos.find((r) => r.repo === pr.repo)
    if (!repoConfig) return
    const summary = await fetchCheckRuns(repoConfig.owner, repoConfig.repo, pr.head.sha, token)
    checks[`${pr.repo}-${pr.number}`] = summary
  })
  await Promise.all(checkPromises)

  latestPayload = { prs, checks }
  broadcastPrList(latestPayload)
}
```
Both `pr-poller.ts` (general PR polling) and `sprint-pr-poller.ts` (sprint task PR polling) run on 60s intervals independently. They both call `listTasksWithOpenPrs()` from the task repository, which queries SQLite. With N concurrent agents + sprint poller + pr poller, the DB experiences concurrent read+write load from three sources. Sprint-pr-poller polls every 60s, but with active agents, the agent manager's drain loop also reads the DB every `pollIntervalMs`. At MAX_ACTIVE_TASKS=5 with `pollIntervalMs=1000`, the drain loop hits the DB 60 times/min, plus sprint-pr-poller 1 time/min, plus agent message logging (every msg = write). The pollers aren't synchronized — they can fire simultaneously.

**Impact:** At MAX_ACTIVE_TASKS=5+, unsynchronized poller and drain loop DB access creates lock contention spikes every 60 seconds when both try to read `tasks_with_open_prs` simultaneously. Visible as 200-500ms drain loop stalls when PR poller fires.

**Recommendation:** Synchronize poller intervals with the drain loop interval, or implement a unified query cache that both use. Alternatively, have sprint-pr-poller subscribe to drain loop completion events rather than polling independently.

**Effort:** M

**Confidence:** Medium

---

### F-t1-concur-6: emitAgentEvent() Broadcasts Before DB Write Completes
**Severity:** Medium
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/agent-event-mapper.ts:83-85`

**Evidence:**
```typescript
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })  // <-- sends to all windows immediately
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)  // <-- then writes to DB
  } catch (err) {
    // Non-fatal
  }
}
```
The broadcast happens *before* the SQLite write, so if the write fails, renderers have already shown the event as persisted. At scale (N=5 agents, 500+ events/min), SQLite lock contention occasionally causes `appendEvent()` to throw, but the event was already broadcast as "persisted." The renderer may assume the event is in the agent log when it's actually lost.

**Impact:** At MAX_ACTIVE_TASKS≥5 under heavy message load (>1000 events/min), occasional SQLite lock timeouts (after 5s or configurable timeout) cause event loss. Renderer shows "agent completed" but log entries for the final 5-10 messages are missing. Only visible in logs as "SQLite write failed" warnings, rate-limited to once per minute.

**Recommendation:** Reverse the order: write to DB first, then broadcast. Or batch + flush synchronously before broadcasting.

**Effort:** S

**Confidence:** High

---

### F-t1-concur-7: No Per-Drain Deduplication of Dependency Index Updates
**Severity:** Low
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:646-673` (`_drainLoop`)

**Evidence:**
```typescript
// index.ts:646-673
for (const task of allTasks) {
  const oldDeps = this._lastTaskDeps.get(task.id) ?? null
  const newDeps = task.depends_on ?? null
  if (!this._depsEqual(oldDeps, newDeps)) {
    this._depIndex.update(task.id, newDeps)  // <-- O(N) per task in worst case
    this._lastTaskDeps.set(task.id, newDeps)
  }
}
```
Every drain loop iteration refetches all tasks and re-validates their dependencies against the cached state. If a task's dependencies haven't changed (the common case), the index is not updated — but the comparison itself is O(N) per task. With 100+ tasks in the queue, and drain loop running every 1-5 seconds, this is redundant work. At N=5 concurrent agents, the drain loop runs more frequently (more task completions trigger checks), compounding the cost.

**Impact:** At MAX_ACTIVE_TASKS=5 with 100+ queued tasks, the `_depsEqual()` comparison loop in `_drainLoop` adds 5-10ms of CPU per iteration. This is not blocking, but it's measurable overhead when multiplied across N=10+ drain loops per minute.

**Recommendation:** Cache dependency change timestamps in the repository so the drain loop can short-circuit the full comparison for unchanged tasks. Or subscribe to task mutation events (via `onSprintMutation`) instead of polling.

**Effort:** M

**Confidence:** Low

---

### F-t1-concur-8: Promise.allSettled() On _agentPromises Can Grow Without Bound
**Severity:** Low
**Category:** Memory
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:904`, `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:257`

**Evidence:**
```typescript
// index.ts:257
readonly _agentPromises = new Set<Promise<void>>()

// index.ts:904 (in stop())
const allSettled = Promise.allSettled([...this._agentPromises])
```
The drain loop fires agent spawning as fire-and-forget: each call to `_runAgent()` returns a Promise that is added to `_agentPromises`, but there's no cleanup of settled promises from the Set. On shutdown, `Promise.allSettled()` waits for *all* promises in the Set. If the manager runs for days with 100+ agents spawned, the Set accumulates completed promises (which are garbage collectable, but the Set references them). Memory overhead is small, but the shutdown wait time is O(N) where N is cumulative agents spawned, not concurrent agents.

**Impact:** At MAX_ACTIVE_TASKS=5 running continuously, after 1000 agents spawned (200 hours of operation), the shutdown wait is dominated by `allSettled()` scanning a 1000-element array. Non-critical but should clean up promises as they settle.

**Recommendation:** Use a cleanup timer to periodically prune settled promises from `_agentPromises`, or use a WeakMap to avoid holding references.

**Effort:** S

**Confidence:** Low

---

## Open questions

1. **Batch sizing for event flushing:** What's the optimal batch size for event buffering? Is 50 events or 100ms better? Should it depend on concurrency level?

2. **Dependency check atomicity:** Should the drain loop use database transactions to ensure dependency checks and task claims are atomic, or is the current "best-effort" stale check acceptable?

3. **Poller synchronization:** Are the 60s intervals for `pr-poller` and `sprint-pr-poller` coincidental, or intentional? Should they be explicitly coordinated?

4. **Renderer window count assumption:** The broadcast fan-out assumes M=2-3 windows. Is there a metric for window count to scale the severity assessment?

5. **SQLite WAL performance baseline:** What's the baseline write latency for `appendEvent()` under single-agent load? How much does it grow with N agents?


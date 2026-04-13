# SRE / Ops

**Lens scope:** Scaling cliffs and unbounded resource growth in the pipeline hot path.

**Summary:** The pipeline hot path exhibits four critical unbounded resource patterns that will degrade as task volume scales: agent_events table grows without eviction and lacks cleanup on agent failure, SDK/CLI process listeners accumulate across agent spawns with no setMaxListeners guard, the \_agentPromises set grows unbounded when agent completion is delayed, and PR-poller timer recreation during backoff can leave orphaned timers in stalled error states.

## Findings

## F-t1-sre-1: Unbounded agent_events table with no failure-path cleanup

**Severity:** High
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/agent-event-mapper.ts:83-95`, `/Users/ryan/projects/BDE/src/main/agent-history.ts:242-246`, `/Users/ryan/projects/BDE/src/main/data/event-queries.ts:121-137`
**Evidence:**

```typescript
// agent-event-mapper.ts
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch (err) {
    // SQLite write failure is non-fatal, but log it (rate-limited)
    // ... no event cleanup here
  }
}

// agent-history.ts
export async function pruneOldAgents(maxCount = 500): Promise<void> {
  // ... prune is called only from index.ts startup
  pruneEventsByAgentIds(
    db,
    toRemove.map((r) => r.id)
  )
}

// agent_events table grows per agent_id: N agents × M events/agent
// At 10 agents/hour × 24 hours = 240 agents
// Assuming 500 events per agent = 120K events/day with NO cleanup on individual agent completion
```

**Impact:** agent_events table grows by ~500 rows per completed task. After 1000 completed tasks, table has ~500K rows. Without indexes on agent_id alone (only `idx_agent_events_agent` on (agent_id, timestamp)), queries for single agent degrade. Once DB reaches 10M+ rows, UI event queries timeout. Pruning only happens on startup and every 24h; transient event query failures between prunes are silent.
**Recommendation:** Immediately prune agent_events when task terminates (in onTaskTerminal/run-agent completion path). Separate event retention policy from agent retention—events should expire after 7 days, agents after 30 days. Add explicit cleanup in `run-agent.ts` after agent completion so failed agents don't leak events into the DB indefinitely.
**Effort:** M
**Confidence:** High

## F-t1-sre-2: Unbounded event listeners on child processes without setMaxListeners guard

**Severity:** High
**Category:** Memory
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/sdk-adapter.ts:151-176`
**Evidence:**

```typescript
// sdk-adapter.ts: spawnViaCli
let stderrBuffer = ''
child.stderr.on('data', (chunk: Buffer) => {
  stderrBuffer += chunk.toString()
  // ...
})
child.stderr.on('end', () => {
  // ...
})
// ... no setMaxListeners(1) on child.stderr
child.on('exit', (code) => {
  exitCode = code
})

// Per-agent spawn: 2 stderr listeners + 1 exit listener = 3 listeners/child process
// At 8 concurrent agents × 3 listeners = 24 active listeners
// If an agent runs 10+ spawns (tool invocations, git commands), each uncleared, that's 30+ listeners
```

**Impact:** If an agent (via SDK spawn path) executes many child processes without cleanup (e.g., loop of tool invocations), Node.js emits "MaxListenersExceededWarning" after 10 listeners. With 8+ concurrent agents each spawning multiple CLIs, warning spam floods logs. While non-fatal, it signals listener leak and consumes memory proportional to agent lifetime. A run-away agent spawning 100+ processes would have 300+ listeners, degrading event handler dispatch.
**Recommendation:** Add `child.stderr.setMaxListeners(1)` and `child.setMaxListeners(1)` before any .on() calls. Alternatively, pre-declare capacity in spawnViaCli: `child.setMaxListeners(5)` to suppress warnings and document expected max.
**Effort:** S
**Confidence:** High

## F-t1-sre-3: \_agentPromises set grows unbounded if agent completion is delayed

**Severity:** High
**Category:** Memory
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:510-524`
**Evidence:**

```typescript
// index.ts: _spawnAgent
_spawnAgent(task: RunAgentTask, wt: ..., repoPath: string): void {
  this._metrics.increment('agentsSpawned')
  const p = _runAgent(task, wt, repoPath, this.runAgentDeps)
    .catch((err) => { ... })
    .finally(() => {
      this._agentPromises.delete(p)  // Only deleted on completion/error
    })
  this._agentPromises.add(p)
}

// Watchdog kills agents via agent.handle.abort(), but does NOT remove from _agentPromises immediately.
// Agent cleanup happens in run-agent.ts completion, which is async and may be delayed if
// worktree cleanup or database updates stall.
// _agentPromises can hold references to resolved Promises for seconds or minutes.
```

**Impact:** If agent completion stalls (e.g., cleanupWorktree hangs on git operations), the Promise resolves but remains in \_agentPromises until finally() runs. At 8 concurrent agents × 10-minute delays = 80 unremoved Promises. Each Promise retains closure scope (agent config, logs, large diffs). With N tasks queued, \_agentPromises grows to O(N) rather than O(concurrency), consuming unbounded heap. No maximum size check exists; if 1000 tasks queue, set size can hit 1000.
**Recommendation:** Bound \_agentPromises to maxConcurrent. Use a queue or LRU-like structure: shift oldest Promise when size exceeds threshold. Alternatively, move finally() cleanup earlier or explicitly delete on watchdog timeout (before agent.handle.abort()).
**Effort:** M
**Confidence:** High

## F-t1-sre-4: PR-poller timer recreation creates orphaned timers under backoff stall

**Severity:** Medium
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/pr-poller.ts:121-136`
**Evidence:**

```typescript
// pr-poller.ts: startPrPoller
export function startPrPoller(): void {
  safePoll()
  timer = setInterval(() => {
    // Use dynamic backoff delay
    clearInterval(timer!) // Clear old timer
    timer = setInterval(safePoll, backoffDelay) // Create new timer with backoffDelay
    safePoll()
  }, backoffDelay)
}

// If backoffDelay = 300_000 (5 min) due to repeated errors:
// - Timer fires every 5 min
// - Each fire: clearInterval(timer) + setInterval(...) = timer swap
// - Each swap is a new V8 timer_handle, old handle eligible for GC
// - If clearInterval(timer!) misses, old timer still active (race condition with null check !)
```

**Impact:** If stopPrPoller() is called mid-interval (e.g., app close during 5-min backoff), timer may not clear properly due to race. Old timer can fire after stop, calling safePoll() on already-stopped poller. In rare cases, multiple timers can be active (if startPrPoller() called twice without stop). At worst: two timers each fire every 5 min, doubling GitHub API load.
**Recommendation:** Simplify: use single setInterval in start(), clear it in stop(). For backoff, move exponential delay logic into poll() itself (track last_poll + backoff_until, skip if too soon). Avoid timer recreation in the interval callback.
**Effort:** S
**Confidence:** Medium

## F-t1-sre-5: Worktree base directory can hit disk space cliff on concurrent startup

**Severity:** High
**Category:** Scaling
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/worktree.ts:244-324`
**Evidence:**

```typescript
// worktree.ts: setupWorktree
await ensureFreeDiskSpace(worktreeBase, MIN_FREE_DISK_BYTES, log)  // 5 GiB check
// ... fetch (30s timeout)
acquireLock(...)
try {
  await nukeStaleState(...)
  await git worktree add -b ${branch} ${worktreePath}  // 1-3 GiB per worktree
} finally {
  releaseLock(...)
}

// Concurrency scenario:
// maxConcurrent = 8
// Each new agent: needs 5 GiB free at setupWorktree time
// All 8 agents pass ensureFreeDiskSpace() at t=0 (5 GiB available)
// All 8 acquire lock and spawn git worktree add
// By t=1s, 8 × 2GiB = 16 GiB consumed
// Disk fills; git fails with "No space left on device"
// ensureFreeDiskSpace check is racy across multiple agents
```

**Impact:** With 5 GiB minimum and 2 GiB/worktree, max safe concurrency is 2-3 before risk of "no space" failures. At maxConcurrent=8, all 8 agents can pass the check simultaneously, then starve disk. Not a hard cliff but a scaling cliff: works at 2 agents, fails unpredictably at 8.
**Recommendation:** Check available disk after lock acquisition (not before), accounting for in-flight worktrees. Or: reserve disk on spawn (atomically account for N×3GiB before returning slot), release on cleanup. Reduce MIN_FREE_DISK_BYTES or make it per-agent based on config.
**Effort:** M
**Confidence:** Medium

## F-t1-sre-6: \_lastTaskDeps map never shrinks for deleted/archived tasks

**Severity:** Medium
**Category:** Memory
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:646-668`
**Evidence:**

```typescript
// index.ts: _drainLoop
let taskStatusMap = new Map<string, string>()
try {
  const allTasks = this.repo.getTasksWithDependencies()
  const currentTaskIds = new Set(allTasks.map((t) => t.id))

  // Remove deleted tasks from index
  for (const oldId of this._lastTaskDeps.keys()) {
    if (!currentTaskIds.has(oldId)) {
      this._depIndex.remove(oldId)
      this._lastTaskDeps.delete(oldId)  // Cleanup exists
    }
  }

  // Update tasks with changed dependencies
  for (const task of allTasks) {
    const oldDeps = this._lastTaskDeps.get(task.id) ?? null
    const newDeps = task.depends_on ?? null
    if (!this._depsEqual(oldDeps, newDeps)) {
      this._depIndex.update(task.id, newDeps)
      this._lastTaskDeps.set(task.id, newDeps)
    }
  }
}

// PROBLEM: _lastTaskDeps is cleared ONLY on remove (via repo.getTasksWithDependencies())
// If a task is deleted at the DB level but getTasksWithDependencies() doesn't reflect it
// (e.g., due to stale cache or race), oldId stays in _lastTaskDeps forever
// _lastTaskDeps only shrinks if delete is detected; no TTL or age-based eviction
```

**Impact:** In a long-running session with 1000+ historical tasks deleted (e.g., after bulk import then cleanup), \_lastTaskDeps can hold 100s of stale entries. Each entry holds a TaskDependency[], small per-entry but O(N) overhead. With annual task volume of 50K+, orphaned entries accumulate over time. Iteration through all keys in \_drainLoop becomes O(N) where N includes dead tasks.
**Recommendation:** Add a simple time-based eviction: track `lastSeenAt` per task, drop entries not seen for 7 days. Or: sync \_lastTaskDeps to only active tasks via a whitelist rather than incremental removal.
**Effort:** S
**Confidence:** Low

## Open questions

1. **Agent event query performance at scale**: Has the agent_events table been tested with 10M+ rows? What is the actual query latency for `agent_id = ? ORDER BY timestamp ASC` at scale? Consider adding a covering index (agent_id, timestamp, payload) or partitioning by date.

2. **Disk space reservation semantics**: If concurrency=8 and each worktree needs 3 GiB, should the system reserve 24 GiB upfront before spawning, or reactively shrink concurrency? Current design (check before, release after) is racy.

3. **Event retention vs. agent retention misalignment**: Events are pruned every 24h; agents are pruned only at startup. If an agent fails and is purged 30 days later, its events may have already been pruned after 7 days. Is this intentional?

4. **PR-poller error recovery**: If GitHub API is down for 1 hour, backoffDelay can reach 2^6 × 60s = 3840s (~1 hour). What is the intended max backoff? Should there be a circuit breaker for extended outages?

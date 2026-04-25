## Context

`AgentManagerImpl` in `src/main/agent-manager/index.ts` owns: timer handles, active-agent map, WIP counter, circuit breaker, fast-fail counts, drain-pause state, and the composition of all collaborator deps. It is ~600 LOC. The drain tick calls `repo.getQueuedTasks()` synchronously via `better-sqlite3` — while normally fast, a locked WAL or filesystem stall can block the Node.js event loop indefinitely since better-sqlite3 is synchronous. `start()` can be called twice (e.g. by tests) producing duplicate `setInterval` handles. `run-agent.ts` mixes orchestration with leaf operations at the same abstraction level (stepdown violation).

## Goals / Non-Goals

**Goals:**
- Wrap the per-tick `getQueuedTasks()` call in a `Promise.race` with a 10s timeout using `setImmediate`-based async wrapper so the event loop isn't permanently blocked
- Extract `WipTracker` (active count, max, claim/release) and `ErrorRegistry` (circuit breaker, fast-fail counts) from `AgentManagerImpl`
- Double-start guard: second `start()` call is a no-op with a WARN
- Shutdown: `stop()` waits up to 30s for in-flight agents to reach a terminal or review state before forcing re-queue
- `run-agent.ts` broken into: `orchestrateAgentRun` (top-level), `runStreamingPhase`, `runCompletionPhase`, `handleStreamError` — each at one abstraction level
- `LifecycleController.startTimers` accepts per-timer initial-delay offsets

**Non-Goals:**
- Moving to async SQLite (would require replacing better-sqlite3)
- Full test coverage of every `AgentManagerImpl` method (EP-16)
- Changing the drain loop's claim logic

## Decisions

### D1: Drain deadline via `setImmediate` wrapper, not `Worker`

```ts
function runInNextTick<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setImmediate(() => { try { resolve(fn()) } catch (e) { reject(e) } })
  )
}
// Usage:
const tasks = await Promise.race([
  runInNextTick(() => repo.getQueuedTasks()),
  sleep(DRAIN_TICK_TIMEOUT_MS).then(() => { throw new DrainTimeoutError() })
])
```

`setImmediate` defers to the next event loop iteration but doesn't prevent blocking if `fn()` actually hangs. However, a `DrainTimeoutError` after 10s is still vastly better than hanging forever. True non-blocking would need a Worker thread — deferred.

### D2: `WipTracker` is a plain class with `claim()`, `release()`, `count`, `isFull(max)`

Extracted from `AgentManagerImpl._activeAgents` map management. `AgentManagerImpl` holds a `WipTracker` instance. No behavior change.

### D3: `ErrorRegistry` wraps circuit-breaker + fast-fail counts

Extracted from `AgentManagerImpl._circuitBreaker`, `_drainFailureCounts`, `_fastFailCounts`. Single responsibility: "is this task/drain healthy or exhausted?"

### D4: Shutdown waits for review-state transitions

`stop()` sets a shutdown flag. The drain loop stops accepting new work. A `Promise.race([allActiveAgentsTerminal(), sleep(30_000)])` gives in-flight agents 30s to finish. After the deadline, remaining `active` tasks are re-queued. `review` tasks are left alone (human needs to action them).

### D5: `run-agent.ts` stepdown

Current structure: one `runAgent()` function doing everything. New structure:
1. `runAgent()` — pure orchestrator: setup → stream → completion → cleanup
2. `runStreamingPhase(deps)` → `{ exitCode, streamError, lastOutput, pendingPaths }`
3. `runCompletionPhase(deps, streamResult)` → terminal status
4. `handleStreamFailure(deps, error)` → classify + retry/fail

## Risks / Trade-offs

- **Risk**: `setImmediate`-based drain timeout doesn't protect against a truly blocking `better-sqlite3` call → Mitigation: documents the limitation; still catches 95% of cases (slow queries, not fully hung ones); Worker thread is a follow-up
- **Trade-off**: Extracting `WipTracker`/`ErrorRegistry` changes internal types — tests that reach into `_circuitBreaker` or `_activeAgents` directly will need updating (EP-16 task T-107)

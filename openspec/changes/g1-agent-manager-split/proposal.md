## Why

`AgentManagerImpl` in `src/main/agent-manager/index.ts` is an 884-line class with seven distinct responsibilities — lifecycle flags, spawn accounting, terminal-call idempotency, drain-loop state, dependency tracking, error/circuit-breaker accounting, and timer management. Prior Phase-A work extracted `LifecycleController`, `WipTracker`, `ErrorRegistry`, and `AgentManagerTestInternals` as collaborators, but the class still owns four raw Maps/Sets that belong in those collaborators, exposes internal state through `_`-prefix convention instead of real TypeScript `private`, and contains a `_spawnAgent` method that mixes four independent concerns in one 80-line body. T-22 through T-28 complete the decomposition so `AgentManagerImpl` becomes a thin composition root that delegates each responsibility to a named collaborator.

## What Changes

- **`SpawnRegistry`** — new class that owns `_activeAgents`, `_processingTasks`, `_agentPromises`, and `_pendingSpawns`. Exposes verb-shaped methods: `registerAgent`, `removeAgent`, `trackPromise`, `incrementPendingSpawns`, `decrementPendingSpawns`, `activeAgentCount`, `isProcessing`, `hasActiveAgent`.
- **`TerminalGuard`** — new class that owns the `_terminalCalled` idempotency Map. Exposes `guardedCall(taskId, fn)`: deduplicates concurrent terminal calls for the same task and cleans up in `finally`.
- **`SpawnRegistry` verbs replace direct Map mutation** — `_activeAgents`, `_processingTasks`, `_agentPromises`, `_pendingSpawns` removed from `AgentManagerImpl`; all callsites (run-agent, task-claimer, watchdog-loop, shutdown-coordinator, tests) updated to go through `SpawnRegistry`.
- **`_spawnAgent` decomposed** into four named helpers: `incrementSpawnAccounting`, `dispatchToRunAgent`, `recordCircuitBreakerFailure`, `releaseClaimAsLastResort` — each doing one thing.
- **`ErrorRegistry` verb interface** — `drainFailureCounts` Map reference replaced by `incrementFailure(taskId)`, `clearFailure(taskId)`, `failureCountFor(taskId)` methods; `drain-loop.ts` DrainLoopDeps updated to accept the verb interface instead of a raw Map.
- **`_` convention eliminated** — all remaining `_`-prefixed members on `AgentManagerImpl` become `private` keyword; `__testInternals` seam updated to proxy through `SpawnRegistry` and `TerminalGuard`.
- **Startup race fixed** — `kickOffOrphanRecovery()` (fire-and-forget at start) and `_scheduleInitialDrain()` (runs orphan recovery a second time before first drain) serialized so orphan recovery runs exactly once before the first drain tick, eliminating the double-spawn window.

## Capabilities

### New Capabilities

- `spawn-registry`: Owns active-agent/processing-task/promise/pending-spawn state; exposes verb-shaped mutation API so `AgentManagerImpl` never manipulates those collections directly.
- `terminal-guard`: Idempotency wrapper for `onTaskTerminal`; maps taskId → in-flight promise, deduplicates concurrent callers, cleans up in `finally`.
- `error-registry-verbs`: Replaces the exposed `drainFailureCounts` Map reference on `ErrorRegistry` with `incrementFailure` / `clearFailure` / `failureCountFor` verb methods; updates `DrainLoopDeps` to consume the verb interface.

### Modified Capabilities

*(none — no spec-level behavior changes; this is a structural refactor with identical observable behavior)*

## Impact

- **`src/main/agent-manager/index.ts`** — primary file; shrinks from ~884 to ~300 LOC after extracting state to collaborators and decomposing `_spawnAgent`.
- **`src/main/agent-manager/error-registry.ts`** — adds three verb methods; `drainFailureCounts` Map made private.
- **`src/main/agent-manager/drain-loop.ts`** — `DrainLoopDeps.drainFailureCounts` (Map ref) replaced by `DrainLoopDeps.errorRegistry` verb interface (or three dedicated callbacks).
- **`src/main/agent-manager/agent-manager-test-internals.ts`** — updated seam properties to delegate through `SpawnRegistry` and `TerminalGuard`.
- **`src/main/agent-manager/shutdown-coordinator.ts`**, **`run-agent.ts`**, **`task-claimer.ts`**, **`watchdog-loop.ts`** — callsites that currently accept `activeAgents` / `processingTasks` / `agentPromises` Maps directly updated to accept `SpawnRegistry`.
- **All `__tests__/index*.test.ts`** — tests that reach `_activeAgents`, `_processingTasks`, `_agentPromises`, `_pendingSpawns`, `_terminalCalled` updated to use `__testInternals` seam (no direct `_` access).
- No behavior change. No new npm packages. No IPC surface changes.

# Agent Manager Refactor — Design Spec

**Date:** 2026-03-27
**Goal:** Convert the agent manager from a closure-based factory to a class with explicit state, improving testability and fixing the drain/watchdog race condition.

---

## Problem

`src/main/agent-manager/index.ts` (644 lines) uses a closure-based factory pattern where all internal functions capture shared mutable state. This causes:

1. **Testing difficulty** — internal functions can only be exercised through the full `start()` lifecycle. No way to test `processQueuedTask()`, `drainLoop()`, or state transitions in isolation.
2. **Race condition** — `drainLoop()` and `watchdogLoop()` can act on the same task concurrently. The watchdog can kill an agent while the drain loop is mid-processing it.
3. **Hidden state** — 12 mutable variables in the closure are invisible to tests and debuggers.

## Solution

### Class with Explicit State

Replace the closure internals with `AgentManagerImpl` class:

```typescript
export class AgentManagerImpl implements AgentManager {
  // State — visible to tests via _ prefix convention
  _concurrency: ConcurrencyState
  readonly _activeAgents = new Map<string, ActiveAgent>()
  _running = false
  _shuttingDown = false
  _drainRunning = false
  _drainInFlight: Promise<void> | null = null
  readonly _agentPromises = new Set<Promise<void>>()
  readonly _depIndex: DependencyIndex
  readonly _processingTasks = new Set<string>()  // race guard

  // Timers
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private orphanTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    readonly config: AgentManagerConfig,
    readonly repo: ISprintTaskRepository,
    readonly logger: Logger = defaultLogger
  ) { ... }

  // Public API (AgentManager interface)
  start(): void
  stop(timeoutMs?: number): Promise<void>
  getStatus(): AgentManagerStatus
  steerAgent(taskId: string, message: string): Promise<SteerResult>
  killAgent(taskId: string): void
  onTaskTerminal(taskId: string, status: string): Promise<void>
}
```

### Factory Preserved

```typescript
export function createAgentManager(
  config: AgentManagerConfig,
  repo: ISprintTaskRepository,
  logger?: Logger
): AgentManager {
  return new AgentManagerImpl(config, repo, logger)
}
```

No callers change. The `AgentManager` interface is unchanged.

### processQueuedTask Decomposition

The 95-line function splits into 5 focused methods:

1. `_checkTaskDeps(task, taskStatusMap)` — dependency satisfaction check
2. `_resolveRepoPath(repoSlug)` — repo path lookup from config
3. `_claimTask(taskId)` — repo.claimTask delegation
4. `_setupTaskWorktree(task, repoPath)` — worktree setup with error handling
5. `_spawnAgent(task, worktreePath)` — fire-and-forget agent spawn

`_processQueuedTask()` becomes a thin orchestrator calling each step, bailing early on failure.

### Drain/Watchdog Race Guard

```typescript
readonly _processingTasks = new Set<string>()

// processQueuedTask: acquire
if (this._processingTasks.has(taskId)) return
this._processingTasks.add(taskId)
try { ... } finally { this._processingTasks.delete(taskId) }

// watchdogLoop: check
if (this._processingTasks.has(agent.taskId)) continue
```

Single-threaded event loop — Set is sufficient, no mutex needed.

### Testing Strategy

- `index.test.ts` (44 tests) — unchanged, tests public API
- `index-extracted.test.ts` (17 tests) — unchanged, tests pure functions
- New `index-methods.test.ts` — tests class methods directly:
  - `_checkTaskDeps` with various dependency scenarios
  - `_processQueuedTask` pipeline (mock each step)
  - `_processingTasks` race guard behavior
  - `_activeAgents` state after spawn/kill/stop
  - Drain/watchdog interaction with processingTasks guard

Uses `_` prefix convention for testable internals (matches `_runAgent` pattern).

## What Doesn't Change

- `AgentManager` interface
- `createAgentManager()` signature and behavior
- All 11 extracted sub-modules
- Public API (start, stop, getStatus, steerAgent, killAgent, onTaskTerminal)
- Logging setup and file rotation
- Timer intervals and loop behavior

## Risk

Medium — structural refactor of core orchestrator. Mitigated by:

- Public API is identical (44 existing tests as regression gate)
- Each extracted method is testable independently before integration
- The class is in the same file — no import path changes

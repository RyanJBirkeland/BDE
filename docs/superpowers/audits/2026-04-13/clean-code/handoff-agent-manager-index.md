# Handoff: `AgentManagerImpl` God Class Decomposition

**File:** `src/main/agent-manager/index.ts`
**Current size:** 893 lines
**Goal:** Extract the remaining mixed concerns into focused modules; leave `AgentManagerImpl` as a thin orchestrator

---

## Current State

Significant decomposition has already happened — the following were already extracted:
- `concurrency.ts` — `ConcurrencyState`, `availableSlots`, `tryRecover`, `setMaxSlots`
- `watchdog.ts` — `checkAgent()` pure verdict computation
- `watchdog-handler.ts` — `handleWatchdogVerdict()` side-effect application
- `circuit-breaker.ts` — `CircuitBreaker` class
- `orphan-recovery.ts` — `recoverOrphans()`
- `task-mapper.ts` — `mapQueuedTask()`, `checkAndBlockDeps()`
- `metrics.ts` — `MetricsCollector`, `MetricsSnapshot`
- `oauth-checker.ts` — `checkOAuthToken()`

What remains in `AgentManagerImpl` is still 893 lines. The class now has these distinct responsibilities that don't belong to a single orchestrator:

| Method | Responsibility | Lines |
|---|---|---|
| `_refreshDependencyIndex()` | Dependency graph maintenance | ~55 |
| `onTaskTerminal()` | Metrics + dep resolution + cleanup timer | ~55 |
| `_processQueuedTask()` | Task claim + worktree + spawn orchestration | ~85 |
| `_spawnAgent()` | Fire-and-forget spawn wrapper | ~15 |
| `_validateDrainPreconditions()` | Pre-drain guard | ~12 |
| `_drainQueuedTasks()` | Fetch + iterate queued | ~25 |
| `_drainLoop()` | Drain orchestration | ~30 |
| `_watchdogLoop()` | Watchdog kill loop | ~60 |
| `_orphanLoop()` | Delegating wrapper | ~10 |
| `_pruneLoop()` | Delegating wrapper | ~15 |
| `start()` | Startup: orphan recovery, dep index build, timer setup | ~80 |
| `stop()` | Shutdown: timer clear, agent abort, requeue, flush | ~70 |
| `getStatus()` / `getMetrics()` | Status queries | ~25 |
| `steerAgent()` / `killAgent()` | Agent control | ~20 |
| `reloadConfig()` | Settings hot-reload | ~45 |
| `_isReviewTask()` | One-line query helper | ~10 |

---

## Target Structure

```
src/main/agent-manager/
├── index.ts              ← AgentManagerImpl (thin orchestrator, ~300 lines after extraction)
├── dependency-refresher.ts  ← NEW: _refreshDependencyIndex logic
├── terminal-handler.ts      ← NEW: onTaskTerminal logic (metrics + resolve + cleanup timer)
├── task-processor.ts        ← NEW: _processQueuedTask + _spawnAgent + _validateDrainPreconditions
├── drain-loop.ts            ← already exists? if not: _drainLoop + _drainQueuedTasks
└── (all existing extracted files remain)
```

The goal is NOT to produce a `AgentManagerImpl` of zero lines — it's to remove the mixed concerns that have nothing to do with lifecycle management (start/stop) or orchestration delegation.

---

## Extraction Plan

### Extract 1: Dependency Refresher → `dependency-refresher.ts`

**Why:** `_refreshDependencyIndex()` owns the dependency graph maintenance algorithm — evicting terminal tasks from the fingerprint cache, computing hash fingerprints, calling `_depIndex.update()`. This is a pure algorithmic concern with no UI/lifecycle knowledge.

**New file `src/main/agent-manager/dependency-refresher.ts`:**

```typescript
import type { DependencyIndex } from '../services/dependency-service'
import type { TaskDependency } from '../../shared/types'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import { isTerminal } from '../../shared/task-state-machine'

export type DepsFingerprint = Map<string, { deps: TaskDependency[] | null; hash: string }>

export function computeDepsFingerprint(deps: TaskDependency[] | null): string {
  if (!deps || deps.length === 0) return ''
  return deps
    .map((d) => `${d.id}:${d.type}:${d.condition ?? ''}`)
    .sort()
    .join('|')
}

/**
 * Incrementally updates the dependency index from the repository.
 * Returns a Map<taskId, status> for the current task set.
 * On error, logs a warning and returns an empty map (safe degraded state).
 */
export function refreshDependencyIndex(
  depIndex: DependencyIndex,
  fingerprints: DepsFingerprint,
  repo: ISprintTaskRepository,
  logger: Logger
): Map<string, string> {
  try {
    const allTasks = repo.getTasksWithDependencies()
    const currentIds = new Set(allTasks.map((t) => t.id))

    // Remove deleted tasks
    for (const oldId of fingerprints.keys()) {
      if (!currentIds.has(oldId)) {
        depIndex.remove(oldId)
        fingerprints.delete(oldId)
      }
    }

    // Update changed or new tasks; evict terminal tasks from fingerprint cache
    for (const task of allTasks) {
      if (isTerminal(task.status)) {
        fingerprints.delete(task.id) // Evict — terminal deps are frozen
        continue
      }
      const cached = fingerprints.get(task.id)
      const newDeps = task.depends_on ?? null
      const newHash = computeDepsFingerprint(newDeps)
      if (!cached || cached.hash !== newHash) {
        depIndex.update(task.id, newDeps)
        fingerprints.set(task.id, { deps: newDeps, hash: newHash })
      }
    }

    return new Map(allTasks.map((t) => [t.id, t.status]))
  } catch (err) {
    logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
    return new Map()
  }
}
```

**In `AgentManagerImpl`:** Replace `_refreshDependencyIndex()` body with:
```typescript
_refreshDependencyIndex(): Map<string, string> {
  return refreshDependencyIndex(this._depIndex, this._lastTaskDeps, this.repo, this.logger)
}
```

Replace `static _depsFingerprint()` with `import { computeDepsFingerprint }` — update the 2 internal call sites.

**Keep backward-compat accessors** (`_depsFingerprint` static method) that delegate to the new function for any tests that call it directly.

Commit: `refactor: extract dependency index refresh to dependency-refresher.ts`

---

### Extract 2: Terminal Handler → `terminal-handler.ts`

**Why:** `onTaskTerminal()` does three unrelated things: (1) increment metrics, (2) call `resolveDependents` with an 11-argument call, (3) schedule a cleanup `setTimeout`. None of these are lifecycle concerns.

**New file `src/main/agent-manager/terminal-handler.ts`:**

```typescript
import type { MetricsCollector } from './metrics'
import type { DependencyIndex } from '../services/dependency-service'
import type { EpicDependencyIndex } from '../services/epic-dependency-service'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { AgentManagerConfig } from './types'
import type { Logger } from '../logger'
import { resolveDependents } from './resolve-dependents'
import { getSetting } from '../settings'

function recordTerminalMetrics(status: string, metrics: MetricsCollector): void {
  if (status === 'done' || status === 'review') {
    metrics.increment('agentsCompleted')
  } else if (status === 'failed' || status === 'error') {
    metrics.increment('agentsFailed')
  }
}

async function resolveTerminalDependents(
  taskId: string,
  status: string,
  depIndex: DependencyIndex,
  epicIndex: EpicDependencyIndex,
  repo: ISprintTaskRepository,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  logger: Logger
): Promise<void> {
  try {
    const freshTasks = repo.getTasksWithDependencies()
    depIndex.rebuild(freshTasks)
  } catch (err) {
    logger.warn(`[agent-manager] dep index rebuild failed before resolution for ${taskId}: ${err}`)
  }
  try {
    resolveDependents(
      taskId, status, depIndex, repo.getTask, repo.updateTask, logger,
      getSetting, epicIndex, repo.getGroup, repo.getGroupTasks,
      undefined, onTaskTerminal
    )
  } catch (err) {
    logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
  }
}

export interface TerminalHandlerDeps {
  metrics: MetricsCollector
  depIndex: DependencyIndex
  epicIndex: EpicDependencyIndex
  repo: ISprintTaskRepository
  config: AgentManagerConfig
  terminalCalled: Set<string>
  logger: Logger
}

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
  terminalCalled.add(taskId)

  try {
    recordTerminalMetrics(status, metrics)
    if (config.onStatusTerminal) {
      config.onStatusTerminal(taskId, status)
    } else {
      await resolveTerminalDependents(taskId, status, depIndex, epicIndex, repo, onTaskTerminal, logger)
    }
  } finally {
    setTimeout(() => terminalCalled.delete(taskId), 5000)
  }
}
```

**In `AgentManagerImpl`:**
```typescript
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  return handleTaskTerminal(taskId, status, this.onTaskTerminal.bind(this), {
    metrics: this._metrics,
    depIndex: this._depIndex,
    epicIndex: this._epicIndex,
    repo: this.repo,
    config: this.config,
    terminalCalled: this._terminalCalled,
    logger: this.logger
  })
}
```

Commit: `refactor: extract terminal status handler to terminal-handler.ts`

---

### Extract 3: `onTaskTerminal` helper decomposition within `_watchdogLoop`

After Extract 2, `_watchdogLoop()` is still 60 lines with mixed kill + update + notify logic. The `handleWatchdogVerdict` extraction already happened — review whether the remaining loop logic can delegate more to `watchdog-handler.ts`. Specifically:

The kill sequence (abort + SIGKILL + delete from activeAgents) is inline. Extract as:

```typescript
// In AgentManagerImpl._watchdogLoop():
private killActiveAgent(agent: ActiveAgent): void {
  try {
    agent.handle.abort()
    const proc = (agent.handle as any).process
    if (proc && typeof proc.kill === 'function') proc.kill('SIGKILL')
  } catch (err) {
    this.logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
  }
  this._activeAgents.delete(agent.taskId)
}
```

This keeps `_watchdogLoop` as a coordination method but removes the inline kill mechanics.

Commit: `refactor: extract killActiveAgent helper from watchdog loop`

---

### Extract 4: Config hot-reload → separate concern (lower priority)

`reloadConfig()` at 45 lines reads from settings and mutates `this.config` and `this.runAgentDeps`. This could move to a `ConfigReloader` or be a free function `reloadAgentManagerConfig(config, runAgentDeps, logger)`. This is lower priority — it's self-contained and infrequently touched.

---

## Key Invariants to Preserve

1. **`_terminalCalled` deduplication guard** — prevents watchdog and completion racing. The Set must be passed into `handleTaskTerminal` and the cleanup `setTimeout` must run in the `finally` block.

2. **`resolveDependents` 11-argument call** — don't change the argument list. The goal is to hide it inside `terminal-handler.ts`, not refactor it.

3. **`_lastTaskDeps` exposed via `_` prefix** — tests check this map directly. The `DepsFingerprint` type alias and the map must remain accessible for tests.

4. **`static _depsFingerprint`** — tests call `AgentManagerImpl._depsFingerprint(...)` directly. Keep the static method as a delegate to `computeDepsFingerprint` for backward compat.

5. **`_concurrency`, `_activeAgents`, `_processingTasks`** — exposed via `_` for tests. These stay on the class.

6. **Fire-and-forget `_spawnAgent`** — must remain synchronous (returns void). The `_agentPromises` tracking set must still include the promise for proper shutdown drain.

---

## Testing

```bash
npm run typecheck
npm test             # Vitest unit tests
npm run test:main    # Main-process integration tests
```

The test file for AgentManager is at `src/main/agent-manager/__tests__/`. The tests reference `_terminalCalled`, `_depsFingerprint`, `_lastTaskDeps`, `_concurrency`, `_activeAgents` — all of these must remain accessible (no `private` keyword on these `_` prefix fields).

---

## Worktree Setup

```bash
git worktree add -b chore/agent-manager-decomp ~/worktrees/BDE/Users-ryan-projects-BDE/agent-manager-decomp main
```

Do each Extract step as a separate commit. Run the full test suite after each commit.

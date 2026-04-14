# AgentManagerImpl God Class Split

## Goal

Refactor `AgentManagerImpl` (854 LOC) in `src/main/agent-manager/index.ts` into 7 focused, single-responsibility modules. Each extracted module owns one distinct concern: WIP tracking, watchdog management, task claiming, worktree lifecycle, shutdown coordination, settings management, and agent spawning. This improves testability, maintainability, and follows the Clean Code principle of one file = one subject.

## Prerequisites

**MUST complete before this task:**
- Task 3: DB injection seam (`03-db-injection-seam.md`)

**Should coordinate with:**
- Task 2: run-agent split (`02-run-agent-sdk-adapter-split.md`) — both touch `index.ts`; run sequentially

## Motivation (brief)

`AgentManagerImpl` currently mixes eight distinct concerns:
1. **Drain loop** — polling queued tasks, checking preconditions
2. **WIP tracking** — concurrency state, slot management
3. **Watchdog management** — agent health checks, termination
4. **Task claiming** — validation, dependency checking, repo resolution
5. **Worktree lifecycle** — setup, prune, cleanup
6. **Shutdown coordination** — graceful termination, re-queuing
7. **Settings management** — hot-reload config, concurrency updates
8. **Agent spawning** — process launch, metrics, error handling

## Proposed Module Breakdown

| New File | Responsibility | Key Exports |
|----------|---------------|-------------|
| `drain-loop.ts` | Polling orchestration, task fetching, precondition checks | `runDrain(deps)` |
| `wip-tracker.ts` | Concurrency state, available slot calculation | `getAvailableSlots()`, `updateMaxSlots()` |
| `watchdog-loop.ts` | Agent health checks, idle/timeout/rate-limit verdicts | `runWatchdog(deps)` |
| `task-claimer.ts` | Task mapping, dependency blocking, repo path resolution | `processQueuedTask(raw, map, deps)` |
| `worktree-manager.ts` | Worktree setup, prune, cleanup | `prepareWorktreeForTask()`, `runPruneLoop()` |
| `shutdown-coordinator.ts` | Graceful termination, agent abort, re-queue | `executeShutdown(deps, timeoutMs)` |
| `config-manager.ts` | Hot-reload settings, concurrency update | `reloadConfiguration(deps)` |

Each module receives its dependencies via a typed `Deps` interface (no global singletons).

## Implementation Steps

1. Create `src/main/agent-manager/drain-loop.ts` — extract `_drainLoop()`, `_validateDrainPreconditions()`, `_drainQueuedTasks()`. Export `async runDrain(deps: DrainLoopDeps): Promise<void>` with typed interface.

2. Create `src/main/agent-manager/wip-tracker.ts` — extract WIP/concurrency state helpers. Export pure functions `getAvailableSlots()`, `updateMaxSlots()`.

3. Create `src/main/agent-manager/watchdog-loop.ts` — extract `_watchdogLoop()`, `killActiveAgent()`. Export `async runWatchdog(deps: WatchdogDeps): Promise<void>`.

4. Create `src/main/agent-manager/task-claimer.ts` — extract `_validateAndClaimTask()`, `_processQueuedTask()`, `resolveRepoPath()`. Export `async processQueuedTask(raw, statusMap, deps)`.

5. Create `src/main/agent-manager/worktree-manager.ts` — extract `_prepareWorktreeForTask()`, `_pruneLoop()`. Export `prepareWorktreeForTask()`, `runPruneLoop()`.

6. Create `src/main/agent-manager/shutdown-coordinator.ts` — extract `stop()` internals (timer cleanup, agent abort, re-queuing, event flushing). Export `executeShutdown(deps, timeoutMs)`.

7. Create `src/main/agent-manager/config-manager.ts` — extract `reloadConfig()`. Export `reloadConfiguration(deps)`.

8. Refactor `src/main/agent-manager/index.ts` — reduce to constructor + orchestration wiring (~250 LOC). Import from all 7 new modules. **Public interface (`AgentManager` exported class, constructor signature) must remain identical.**

9. Update `docs/modules/agent-manager/index.md` — add rows for the 7 new modules.

## Files to Change

**Create (7 new files):**
- `src/main/agent-manager/drain-loop.ts`
- `src/main/agent-manager/wip-tracker.ts`
- `src/main/agent-manager/watchdog-loop.ts`
- `src/main/agent-manager/task-claimer.ts`
- `src/main/agent-manager/worktree-manager.ts`
- `src/main/agent-manager/shutdown-coordinator.ts`
- `src/main/agent-manager/config-manager.ts`

**Modify:**
- `src/main/agent-manager/index.ts` — 854 → ~250 LOC, import from new modules, public interface unchanged
- `docs/modules/agent-manager/index.md` — add rows for 7 new modules

**Do NOT modify:**
- `src/main/index.ts` — IPC wiring unchanged
- `src/main/agent-manager/run-agent.ts` — separate task
- Any IPC handler files

## How to Test

Write unit tests for each extracted module in `src/main/agent-manager/__tests__/`:

- **drain-loop.test.ts** — precondition validation (circuit open, token invalid, shuttingDown), task fetching, metrics increment
- **wip-tracker.test.ts** — slot calculation, max slot updates when below active count
- **watchdog-loop.test.ts** — verdict-based kills, terminal callback invocation, concurrency state updates
- **task-claimer.test.ts** — missing repo path, dependency blocking, concurrent claim guard
- **worktree-manager.test.ts** — success/failure paths, error truncation, prune delegation
- **shutdown-coordinator.test.ts** — timer cleanup, drain wait with timeout, agent abort + re-queue, event flushing
- **config-manager.test.ts** — hot-reload of maxConcurrent/maxRuntimeMs, requiresRestart for worktreeBase

Existing integration tests must pass unchanged:
```bash
npm run typecheck && npm test && npm run test:main
```

`AgentManagerImpl` public interface is identical — existing mocks/stubs work without changes.

## Why

`withRetry` (the sync variant) uses `Atomics.wait` to backoff on `SQLITE_BUSY`, which blocks the calling OS thread. On Electron's main thread this freezes the entire app — no IPC, no UI repaints, no watchdog ticks — for up to ~5 s per contended write. The agent-manager drain loop, watchdog, and completion pipeline all call hot-path data functions that use `withRetry`, meaning every WAL contention event under concurrent agent load can lock up the process. `withRetryAsync` already exists and is safe; it simply isn't used yet on these paths.

## What Changes

- `src/main/data/sprint-task-crud.ts` — `writeTaskUpdate` switches from `withRetry` to `withRetryAsync`, making `updateTask`, `forceUpdateTask`, and `createReviewTaskFromAdhoc` return `Promise`-wrapped results. `createTask` is similarly converted.
- `src/main/data/sprint-queue-ops.ts` — `claimTask` and `releaseTask` switch to `withRetryAsync`. `getActiveTaskCount` is a read-only query with no busy-retry today; it stays synchronous (it cannot produce `SQLITE_BUSY` without a write lock). `getQueuedTasks` likewise stays sync.
- `src/main/data/sprint-pr-ops.ts` — `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, and `updateTaskMergeableState` switch to `withRetryAsync`. Read-only helpers (`listTasksWithOpenPrs`) stay sync.
- `src/main/data/sprint-task-repository.ts` — `IAgentTaskRepository`, `IDashboardRepository`, and `ISprintPollerRepository` interface method signatures updated to return `Promise` where the underlying implementation goes async.
- Cascade: all agent-manager call sites that `await` the now-async repo methods (`drain-loop.ts`, `task-claimer.ts`, `run-agent.ts`, `resolve-success-phases.ts`, `resolve-failure-phases.ts`, `watchdog-loop.ts`, `completion.ts`, `terminal-handler.ts`, `orphan-recovery.ts`, `shutdown-coordinator.ts`).
- Sprint PR poller call sites updated to `await` async repo methods.
- `withRetry` (sync) kept for cold-path callers: migrations, startup reads, handler code that calls synchronous query helpers not on the hot path.

## Capabilities

### New Capabilities

- `sqlite-async-hot-paths`: Hot-path SQLite writes in the agent-manager data layer (`updateTask`, `createTask`, `claimTask`, `releaseTask`, `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `updateTaskMergeableState`) execute with `withRetryAsync`, guaranteeing the Electron main thread yields to the event loop during backoff rather than blocking.

### Modified Capabilities

*(none — this is a correctness fix to existing write semantics, not a behaviour change visible to callers)*

## Impact

- **Data layer** (`src/main/data/`): three files gain async signatures; `sprint-task-repository.ts` interface updated.
- **Agent manager** (`src/main/agent-manager/`): ~10 files gain `await` on repo write calls; existing `async` functions absorb this with no new control-flow complexity.
- **Sprint PR poller** (`src/main/sprint-pr-poller.ts`): two polling call sites `await` the now-async repository methods.
- **IPC handlers / services**: cold-path callers that use `sprint-service.ts` or direct `sprint-queries` remain synchronous and untouched.
- **Tests**: existing repo mock implementations in agent-manager tests need method signatures updated to return `Promise`; test logic (arrange/act/assert) remains the same.
- **No new npm dependencies.**
- **No schema or IPC channel changes.**

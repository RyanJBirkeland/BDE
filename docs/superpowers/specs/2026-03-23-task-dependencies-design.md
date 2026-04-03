# Task Dependency System — Design Spec

**Date:** 2026-03-23
**Status:** Draft

## Problem

BDE's AgentManager drain loop claims any queued task with available slots — there is no concept of ordering or prerequisite relationships between tasks. This means pipeline chains (A before B), fan-out/fan-in patterns, and soft ordering hints are all impossible. The field mapper already maps `dependsOn` ↔ `depends_on`, but nothing else in the system supports dependencies.

## Requirements

1. **Pipeline chains** — Task B runs only after Task A completes (e.g., "build API" → "build UI that calls API")
2. **Fan-out / fan-in** — Multiple tasks run in parallel, then a final task runs when all are done
3. **Soft ordering** — Advisory "prefer to run after X" without hard blocking
4. **Configurable failure behavior** — Per-edge `hard` (block dependents on failure) or `soft` (unblock anyway) with default = block
5. **Cross-sprint dependencies** — Any task can depend on any other task regardless of sprint
6. **Lightweight UI** — Show dependency info on task cards; set dependencies during task create/edit
7. **Cycle detection** — Prevent deadlocks at creation time

## Non-Goals

- Visual graph editor / drag-to-link UI (future)
- Automatic dependency inference from task content
- Conditional dependencies (run B only if A produces output X)

## Design

### Data Model

#### New type: `TaskDependency`

```typescript
// src/shared/types.ts
export interface TaskDependency {
  id: string // task ID this depends on
  type: 'hard' | 'soft' // hard = block on fail, soft = unblock regardless
}
```

#### Updated `SprintTask` interface

```typescript
// Added field
depends_on: TaskDependency[] | null
```

When `depends_on` is `null` or `[]`, the task has no dependencies.

#### New task status: `blocked`

```typescript
status: 'backlog' | 'queued' | 'blocked' | 'active' | 'done' | 'cancelled' | 'failed' | 'error'
```

`blocked` means "this task has unsatisfied hard dependencies." The drain loop ignores `blocked` tasks. When all dependencies resolve, the system automatically transitions `blocked → queued`.

#### Constants update

Add `BLOCKED: 'blocked'` to `TASK_STATUS` in `src/shared/constants.ts`. The derived `TaskStatusValue` type propagates automatically. The inline `SprintTask.status` union in `src/shared/types.ts` must also be updated independently (it is not derived from `TASK_STATUS`).

#### Supabase schema

Single column addition to `sprint_tasks`:

```sql
ALTER TABLE sprint_tasks ADD COLUMN depends_on JSONB DEFAULT NULL;
```

No new tables. The JSONB column stores `TaskDependency[]`.

#### Field mapper

Already maps `dependsOn` ↔ `depends_on` — no change needed (`src/main/queue-api/field-mapper.ts:5`).

#### Update allowlist

Add `depends_on` to `UPDATE_ALLOWLIST` in `src/main/data/sprint-queries.ts:10`.

### Reverse Index

An in-memory `Map<string, Set<string>>` mapping `dependencyTaskId → Set<dependentTaskIds>` maintained by the AgentManager. This enables O(1) lookup of "which tasks depend on this one?" when a task completes.

#### Lifecycle

1. **Built on startup** — query all tasks with non-null `depends_on`, populate the map
2. **Updated on task create/update** — when `depends_on` changes, update affected entries
3. **Pruned on task delete** — remove the task from all sets, remove its own entry

#### Implementation location

New module: `src/main/agent-manager/dependency-index.ts`

```typescript
export interface DependencyIndex {
  /** Rebuild from a full task list (startup) */
  rebuild(tasks: Array<{ id: string; depends_on: TaskDependency[] | null }>): void

  /** Update when a task's depends_on changes */
  update(taskId: string, oldDeps: TaskDependency[] | null, newDeps: TaskDependency[] | null): void

  /** Remove a task entirely (deleted) */
  remove(taskId: string): void

  /** Get all task IDs that directly depend on the given task */
  getDependents(taskId: string): Set<string>

  /** Check if all dependencies of a task are satisfied */
  areDependenciesSatisfied(
    taskId: string,
    deps: TaskDependency[],
    getTaskStatus: (id: string) => string | undefined
  ): { satisfied: boolean; blockedBy: string[] }
}
```

### Dependency Satisfaction Rules

A dependency is **satisfied** when the depended-on task reaches a terminal state, subject to the edge type:

| Dependency status | `hard` edge                                                             | `soft` edge |
| ----------------- | ----------------------------------------------------------------------- | ----------- |
| `done`            | Satisfied                                                               | Satisfied   |
| `cancelled`       | **Not satisfied** (task was abandoned, prerequisite work not done)      | Satisfied   |
| `failed`          | **Not satisfied** (prerequisite work failed)                            | Satisfied   |
| `error`           | **Not satisfied** (same as failed — watchdog kill, spawn timeout, etc.) | Satisfied   |
| Task deleted      | Satisfied (dependency no longer exists — don't block forever)           | Satisfied   |

**Rationale:** Hard dependencies mean "I need this task's output." If the task was cancelled, failed, or errored, that output doesn't exist. Only `done` satisfies a hard dep. Soft dependencies mean "prefer to run after" — any terminal state unblocks.

### Status Transitions

#### New transitions involving `blocked`

```
Task created with depends_on (unsatisfied hard deps)
  → status = 'blocked'

Task created with depends_on (all deps already satisfied)
  → status = 'queued' (or 'backlog' if user hasn't queued it)

Dependency task reaches terminal status (done/cancelled/failed/error):
  For each dependent task (from reverse index):
    If dependent.status === 'blocked':
      Re-evaluate all deps using satisfaction rules above
      If all dependencies satisfied:
        → dependent transitions 'blocked' → 'queued'
      Else:
        → dependent stays 'blocked'
```

#### Manual unblock

Users can manually transition a `blocked` task to `queued` via the UI — this overrides dependency checks (escape hatch for when a failed dependency doesn't actually matter).

#### Queuing a task with dependencies

When a user moves a task from `backlog` → `queued`:

- If the task has unsatisfied hard dependencies, transition to `blocked` instead of `queued`
- Show a toast: "Task blocked — waiting on N dependencies"

### Drain Loop Changes

**File:** `src/main/agent-manager/index.ts` (lines 273–350)

The drain loop currently calls `fetchQueuedTasks(available)` which returns only `status='queued'` tasks. Since `blocked` is a separate status, **no filtering changes are needed in the drain loop itself** — blocked tasks are never returned by `getQueuedTasks()`.

The dependency logic lives in the **status transition layer**, not the drain loop. This keeps the drain loop simple and fast.

### Dependency Resolution Trigger Points

`resolveDependents()` must be called from **every code path** that transitions a task to a terminal status. In BDE, task completion is a two-phase process:

1. **Agent finishes** → `resolveSuccess()` pushes branch + opens PR → task stays `active` (not terminal yet)
2. **PR poller** → `markTaskDoneByPrNumber()` or `markTaskCancelledByPrNumber()` → task reaches `done` or `cancelled`
3. **Agent failure** → `resolveFailure()` → task reaches `failed` (after max retries)
4. **Watchdog** → task reaches `error`
5. **Manual status change** — user marks task done/cancelled via UI

The trigger points where `resolveDependents()` must be called:

| Code path                                 | File                                              | Terminal status |
| ----------------------------------------- | ------------------------------------------------- | --------------- |
| `resolveFailure()` (retries exhausted)    | `src/main/agent-manager/completion.ts:80`         | `failed`        |
| Watchdog kill (max-runtime, idle-timeout) | `src/main/agent-manager/index.ts` (watchdog loop) | `error`         |
| `markTaskDoneByPrNumber()`                | `src/main/data/sprint-queries.ts:227`             | `done`          |
| `markTaskCancelledByPrNumber()`           | `src/main/data/sprint-queries.ts:249`             | `cancelled`     |

**PR poller refactoring required:** Both `markTaskDoneByPrNumber()` and `markTaskCancelledByPrNumber()` currently return `void` and perform bulk updates by `pr_number` without revealing which task IDs were affected. To call `resolveDependents(taskId)`, the implementation must refactor these functions to:

1. Query for matching task IDs before the update (e.g., `SELECT id FROM sprint_tasks WHERE pr_number = $1 AND status = 'active'`)
2. Perform the update
3. Return the affected task IDs: `Promise<string[]>` instead of `Promise<void>`

The `sprint-local.ts` wrappers and `sprint-pr-poller.ts` callers must be updated to consume the returned IDs and call `resolveDependents()` for each.
| Manual status update via IPC | `src/main/handlers/sprint-local.ts` | any terminal |

**Implementation approach:** Rather than scattering `resolveDependents()` calls across 5+ locations, add a centralized hook. After any `updateTask()` call that changes `status` to a terminal value, call `resolveDependents()`. This can be done by:

1. Wrapping `updateTask()` with a dependency-aware version that checks if the new status is terminal
2. Or adding a post-update event listener that the dependency system subscribes to

Option 1 (wrapper) is simpler and keeps the call explicit. The wrapper lives in the agent-manager and delegates to `sprint-queries.updateTask()` + `resolveDependents()`.

### Cycle Detection

**File:** New utility in `src/main/agent-manager/dependency-index.ts`

```typescript
export function detectCycle(
  taskId: string,
  proposedDeps: TaskDependency[],
  getDepsForTask: (id: string) => TaskDependency[] | null
): string[] | null // returns cycle path or null
```

Uses depth-first traversal from each proposed dependency, following their `depends_on` chains. If `taskId` is found in any chain, returns the cycle path for error reporting.

Called:

- When creating a task with `depends_on`
- When updating a task's `depends_on`
- Returns an error to the caller (API 400 or UI validation error) with the cycle path

### Queue API Changes

**File:** `src/main/queue-api/router.ts`

**Note:** The current router only has `PATCH /queue/tasks/:id/status` (handled by `handleUpdateStatus()`). There is no general-purpose `PATCH /queue/tasks/:id`. Dependency updates require one of:

- **Option A:** Add a new `PATCH /queue/tasks/:id` route for general field updates (including `depends_on`), separate from the status-only route
- **Option B:** Extend the existing `/status` endpoint to accept `dependsOn` (semantically wrong — it's not a status field)

**Recommended: Option A.** Add `PATCH /queue/tasks/:id` as a general update route. The existing `/status` route remains for backwards compatibility with external runners that only need to update status.

#### POST /queue/tasks (create)

- Accept optional `dependsOn` field in request body
- Run cycle detection before insert
- If task has unsatisfied hard dependencies and status would be `queued`, set `blocked` instead

Update `CreateTaskInput` in `src/main/data/sprint-queries.ts:75` to include `depends_on?: TaskDependency[] | null`. Update the `createTask()` insert to pass through `depends_on`.

#### PATCH /queue/tasks/:id (new route)

- Accept any field in `UPDATE_ALLOWLIST` (which now includes `depends_on`)
- Run cycle detection when `depends_on` is in the patch
- Re-evaluate blocked/queued status after dependency change

#### GET /queue/tasks/:id (read)

- Include `dependsOn` in response (already mapped by field mapper)

#### GET /queue/health

- Add `blocked` count to `QueueStats`

### Sprint Queries Changes

**File:** `src/main/data/sprint-queries.ts`

#### `QueueStats`

Add `blocked: number` field to the `QueueStats` interface (line 31) and initialize it to `0` in `getQueueStats()` (line 181). The counting loop at line 201 will automatically pick it up via the `if (s in stats)` check.

Also update the health response serialization in `src/main/queue-api/router.ts:186-199` (`handleHealth`) to include `blocked` and `error` in the response object (both are currently missing despite being in `QueueStats`). Update `QueueHealthResponse` in `src/shared/queue-api-contract.ts:6-17` to match.

#### `getBlockedTasks()`

New function to fetch all blocked tasks (for UI):

```typescript
export async function getBlockedTasks(): Promise<SprintTask[]> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks')
    .select('*')
    .eq('status', 'blocked')
  if (error) throw error
  return data ?? []
}
```

#### `getTasksWithDependencies()`

New function for reverse index rebuild on startup:

```typescript
export async function getTasksWithDependencies(): Promise<
  Array<{ id: string; depends_on: TaskDependency[] | null; status: string }>
> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks')
    .select('id, depends_on, status')
    .not('depends_on', 'is', null)
  if (error) throw error
  return data ?? []
}
```

### UI Changes

#### Partition function (`src/renderer/src/lib/partitionSprintTasks.ts`)

Add a `case TASK_STATUS.BLOCKED:` to the switch statement. Blocked tasks go into the `todo` bucket (they are conceptually "waiting to be queued") and are rendered with a visual blocked indicator. This keeps the kanban column count stable.

Update `SprintPartition` interface if a dedicated `blocked` bucket is preferred — but reusing `todo` with a visual distinction is simpler and avoids kanban layout changes.

#### Task Card (`src/renderer/src/components/sprint/TaskCard.tsx`)

- Show a `blocked` badge when `task.status === 'blocked'`
- Below the task title, show dependency chips: "Depends on: Task A (hard), Task B (soft)"
- Failed hard dependencies shown in red; satisfied dependencies shown in green/muted
- Add "Unblock" button on blocked cards (manual override → transitions to `queued`)

#### Task Create/Edit Form

- Add a "Dependencies" field — multi-select dropdown of existing tasks
- Each selected dependency gets a `hard`/`soft` toggle (default: `hard`)
- Show cycle detection errors inline if the user creates a circular dependency

#### Sprint Kanban

- Blocked tasks render in the Todo column with a blocked overlay/badge
- This avoids adding a new kanban column while making blocked status clearly visible

### IPC Changes

New handlers registered in `src/main/index.ts`:

```typescript
// Validate dependencies (cycle detection) before save
'sprint:validate-dependencies' → (taskId, proposedDeps) → { valid: boolean; cycle?: string[] }

// Manual unblock
'sprint:unblock-task' → (taskId) → SprintTask
```

### Testing Strategy

#### Unit tests

- **`dependency-index.test.ts`** — rebuild, update, remove, getDependents, areDependenciesSatisfied with all satisfaction rules (hard+done=satisfied, hard+failed=not, hard+cancelled=not, hard+error=not, soft+any=satisfied, deleted=satisfied)
- **`cycle-detection.test.ts`** — no cycle, self-cycle, A→B→A, A→B→C→A, diamond (not a cycle), deep chain
- **`completion.test.ts`** — extend existing tests for `resolveDependents`: hard dep done → unblock, hard dep failed → stay blocked, hard dep cancelled → stay blocked, soft dep failed → unblock, mixed deps, no dependents (no-op)
- **`partitionSprintTasks.test.ts`** — extend to verify blocked tasks land in todo bucket

#### Integration tests

- **Drain loop skips blocked tasks** — create task with unmet dep, verify drain loop doesn't claim it
- **End-to-end pipeline** — Task A (queued) → completes → PR merged → Task B (blocked → queued) → claimed
- **Fan-in** — Tasks A+B parallel → Task C blocked on both → A done → C still blocked → B done → C queued
- **Soft dependency failure** — Task A fails → Task B (soft dep on A) → unblocked
- **Hard dependency failure** — Task A fails → Task B (hard dep on A) → stays blocked
- **Hard dependency cancelled** — Task A cancelled → Task B (hard dep on A) → stays blocked
- **Manual unblock** — Task blocked → user clicks unblock → task queued
- **PR poller triggers resolution** — Task A's PR merged → `markTaskDoneByPrNumber` → dependents unblocked

### Error Handling

| Scenario                                        | Behavior                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Dependency target doesn't exist                 | Reject at creation time (API 400: "Task {id} not found")                             |
| Dependency target deleted after creation        | Treat as satisfied (the work is gone, don't block forever)                           |
| Cycle detected                                  | Reject at creation/update time (API 400 with cycle path)                             |
| Reverse index out of sync                       | Rebuild on next startup; log warning                                                 |
| Supabase unavailable during `resolveDependents` | Log error; blocked tasks stay blocked until next completion event or startup rebuild |

### Migration Path

1. Add `depends_on` JSONB column to Supabase `sprint_tasks` table (default NULL)
2. Add `blocked` to the status enum/check constraint if one exists
3. All existing tasks have `depends_on = NULL` — no migration of existing data needed
4. Deploy backend changes first (drain loop already ignores non-queued tasks)
5. Deploy UI changes (dependency display and editing)

### Files Changed (Complete List)

| File                                                  | Change                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`                                 | Add `TaskDependency` interface, add `depends_on` to `SprintTask`, add `blocked` to status union                                                                                                                                                                                                                 |
| `src/shared/constants.ts`                             | Add `BLOCKED: 'blocked'` to `TASK_STATUS`                                                                                                                                                                                                                                                                       |
| `src/shared/queue-api-contract.ts`                    | Add `blocked` and `error` to `QueueHealthResponse.queue` type (both currently missing). `RUNNER_WRITABLE_STATUSES` does not need `blocked` (only the system transitions to/from blocked, not external runners)                                                                                                  |
| `src/main/data/sprint-queries.ts`                     | Add `depends_on` to `UPDATE_ALLOWLIST`, add `depends_on` to `CreateTaskInput` + `createTask()`, add `blocked` to `QueueStats`, add `getBlockedTasks()`, add `getTasksWithDependencies()`, refactor `markTaskDoneByPrNumber` and `markTaskCancelledByPrNumber` to return affected task IDs (`Promise<string[]>`) |
| `src/main/agent-manager/dependency-index.ts`          | **New file** — DependencyIndex implementation + cycle detection                                                                                                                                                                                                                                                 |
| `src/main/agent-manager/index.ts`                     | Initialize DependencyIndex on startup, call `resolveDependents` from terminal status transitions                                                                                                                                                                                                                |
| `src/main/agent-manager/completion.ts`                | Call `resolveDependents` after `resolveFailure` sets `failed`                                                                                                                                                                                                                                                   |
| `src/main/queue-api/router.ts`                        | Add `PATCH /queue/tasks/:id` route, add `blocked` to health response                                                                                                                                                                                                                                            |
| `src/main/queue-api/field-mapper.ts`                  | No change needed (already maps `dependsOn`)                                                                                                                                                                                                                                                                     |
| `src/main/handlers/sprint-local.ts`                   | Update `markTaskDoneByPrNumber` wrapper to consume returned task IDs and call `resolveDependents` for each                                                                                                                                                                                                      |
| `src/main/handlers/git-handlers.ts`                   | Update PR merge/close handlers to consume returned task IDs and call `resolveDependents` for each                                                                                                                                                                                                               |
| `src/main/sprint-pr-poller.ts`                        | Update poller's `markTaskDoneByPrNumber`/`markTaskCancelledByPrNumber` calls to consume returned task IDs and call `resolveDependents`                                                                                                                                                                          |
| `src/main/index.ts`                                   | Register `sprint:validate-dependencies` and `sprint:unblock-task` IPC handlers                                                                                                                                                                                                                                  |
| `src/renderer/src/lib/partitionSprintTasks.ts`        | Add `case TASK_STATUS.BLOCKED:` → todo bucket                                                                                                                                                                                                                                                                   |
| `src/renderer/src/components/sprint/TaskCard.tsx`     | Blocked badge, dependency chips, unblock button                                                                                                                                                                                                                                                                 |
| `src/renderer/src/components/sprint/SprintCenter.tsx` | Task create/edit form dependency field                                                                                                                                                                                                                                                                          |

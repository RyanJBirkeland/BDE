# WS3: Split Sprint Store

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 0.5-1 day
**Dependencies:** None

## Problem

`useSprintStore` has ~19 properties bundling 5 unrelated concerns: task CRUD, UI selection state, PR merge tracking, task output events, and queue health. All sprint components subscribe to everything, causing unnecessary re-renders and making the store hard to reason about.

### Current SprintState (~19 properties)

```typescript
interface SprintState {
  // Task data (CRUD)
  tasks: SprintTask[]
  loading: boolean
  loadError: string | null

  // UI state (selection, drawers)
  selectedTaskId: string | null
  logDrawerTaskId: string | null
  repoFilter: string | null
  generatingIds: Set<string>

  // PR tracking
  prMergedMap: Record<string, boolean>

  // Task output events (SSE) — note: uses TaskOutputEvent from queue-api-contract, not AgentEvent
  taskEvents: Record<string, TaskOutputEvent[]>
  latestEvents: Record<string, TaskOutputEvent>

  // Queue health
  queueHealth: QueueHealth | null

  // Actions
  loadData: () => Promise<void>
  createTask: (input) => Promise<SprintTask>
  updateTask: (id, patch) => Promise<void>
  deleteTask: (id) => Promise<void>
  launchTask: (task) => Promise<void>
  setTasks: (tasks) => void
  setPrMergedMap: (updater) => void
  setGeneratingIds: (updater) => void
  setSelectedTaskId: (id) => void
  setLogDrawerTaskId: (id) => void
  setRepoFilter: (filter) => void
  mergeSseUpdate: (update) => void
  initTaskOutputListener: () => () => void
}
```

Note: The actual store uses `TaskOutputEvent` from `queue-api-contract` for event types, and `setPrMergedMap`/`setGeneratingIds` with functional updater pattern.

## Solution

Split into 3 focused stores along domain boundaries:

### 1. `useSprintTasks` — Task data and CRUD

```typescript
// src/renderer/src/stores/sprintTasks.ts
interface SprintTasksState {
  tasks: SprintTask[]
  loading: boolean
  loadError: string | null
  prMergedMap: Record<string, boolean>

  loadData: () => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<SprintTask>
  updateTask: (id: string, patch: Partial<SprintTask>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  launchTask: (task: SprintTask) => Promise<void>
  setTasks: (tasks: SprintTask[]) => void
  mergeSseUpdate: (update: SseTaskUpdate) => void
}
```

Owns: task list, loading state, CRUD operations, PR merge status, SSE task updates.

### 2. `useSprintUI` — UI selection and filter state

```typescript
// src/renderer/src/stores/sprintUI.ts
interface SprintUIState {
  selectedTaskId: string | null
  logDrawerTaskId: string | null
  repoFilter: string | null
  generatingIds: Set<string>

  setSelectedTaskId: (id: string | null) => void
  setLogDrawerTaskId: (id: string | null) => void
  setRepoFilter: (filter: string | null) => void
  setGeneratingIds: (updater: (prev: Set<string>) => Set<string>) => void
}
```

Owns: which task is selected, which drawer is open, active filter, spec generation tracking. Pure synchronous state — no async actions, no IPC calls.

### 3. `useSprintEvents` — Task output event stream

```typescript
// src/renderer/src/stores/sprintEvents.ts
interface SprintEventsState {
  taskEvents: Record<string, TaskOutputEvent[]>
  latestEvents: Record<string, TaskOutputEvent>
  queueHealth: QueueHealth | null

  initTaskOutputListener: () => () => void
  fetchQueueHealth: () => Promise<void>
  clearTaskEvents: (taskId: string) => void
}
```

Owns: real-time agent events, queue health polling. Handles SSE listener lifecycle.

## Changes

### 1. Create three new store files

- `src/renderer/src/stores/sprintTasks.ts`
- `src/renderer/src/stores/sprintUI.ts`
- `src/renderer/src/stores/sprintEvents.ts`

### 2. Migrate state and actions

Move each property/action from `sprint.ts` to the appropriate new store. Mostly redistribution. The `generatingIds` actions change from `setPrMergedMap`/`setGeneratingIds` (functional updater pattern) to the same pattern in the new store — preserve the existing API style.

### 3. Delete `src/renderer/src/stores/sprint.ts`

After all consumers are migrated.

### 4. Update consumers (~8-12 files)

Each consumer currently doing:

```typescript
const tasks = useSprintStore((s) => s.tasks)
const selectedTaskId = useSprintStore((s) => s.selectedTaskId)
const taskEvents = useSprintStore((s) => s.taskEvents)
```

Becomes:

```typescript
const tasks = useSprintTasks((s) => s.tasks)
const selectedTaskId = useSprintUI((s) => s.selectedTaskId)
const taskEvents = useSprintEvents((s) => s.taskEvents)
```

### Consumer File Map

| File                                  | Current Selectors                                                    | New Store(s)          |
| ------------------------------------- | -------------------------------------------------------------------- | --------------------- |
| `SprintCenter.tsx`                    | tasks, selectedTaskId, logDrawerTaskId, updateTask, deleteTask, etc. | All 3                 |
| `KanbanBoard.tsx`                     | (receives via props from SprintCenter)                               | None (no change)      |
| `TaskTable.tsx`                       | (receives via props)                                                 | None (no change)      |
| `TaskCard.tsx`                        | latestEvents                                                         | sprintEvents          |
| `TicketEditor.tsx`                    | createTask, updateTask                                               | sprintTasks           |
| `LogDrawer.tsx`                       | taskEvents                                                           | sprintEvents          |
| `SprintView.tsx`                      | (routing only)                                                       | None                  |
| `AgentsView.tsx`                      | (verify — may use sprint store)                                      | Check and update      |
| `hooks/useSprintPolling.ts`           | loadData, tasks (active check)                                       | sprintTasks           |
| `hooks/usePrStatusPolling.ts`         | tasks, prMergedMap                                                   | sprintTasks           |
| `hooks/useSprintKeyboardShortcuts.ts` | selectedTaskId, tasks                                                | sprintTasks, sprintUI |
| `App.tsx`                             | (if any sprint subscriptions)                                        | Check                 |
| `StatusBar.tsx`                       | (if any sprint subscriptions)                                        | Check                 |

Note: `NewTicketModal.tsx` and `QueueDashboard.tsx` may receive data via props rather than direct store access — verify before migration. The 3 hook files listed above are confirmed direct consumers.

### 5. Update tests

Existing `sprint.test.ts` splits into:

- `sprintTasks.test.ts`
- `sprintUI.test.ts`
- `sprintEvents.test.ts`

### 6. Cross-store communication

The stores are independent — no store imports another. Where coordination is needed (e.g., `createTask` needs to add to `generatingIds`), the calling component orchestrates:

```typescript
// In SprintCenter or a custom hook
const createTask = useSprintTasks((s) => s.createTask)
const setGeneratingIds = useSprintUI((s) => s.setGeneratingIds)

const handleCreate = async (input) => {
  const task = await createTask(input)
  setGeneratingIds((prev) => new Set([...prev, task.id]))
}
```

If this becomes unwieldy, extract a `useSprintActions()` custom hook that composes across stores.

## Verification

- `npm run typecheck` passes
- `npm test` passes
- `grep -r "useSprintStore" src/renderer` returns zero results
- Each store file < 150 LOC

## Risk

Low. Pure state redistribution. Selectors are type-checked, so missing migrations will fail at compile time.

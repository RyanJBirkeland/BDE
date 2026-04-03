# WS6: Decompose SprintCenter

**Date:** 2026-03-20
**Status:** Draft
**Effort:** 0.5-1 day
**Dependencies:** WS3 (Split Sprint Store)

## Problem

`SprintCenter.tsx` (at `src/renderer/src/components/sprint/SprintCenter.tsx`) is ~456 LOC with ~18 store selectors orchestrating 9+ sub-components. It manages task lifecycle, polling, keyboard shortcuts, drawer state, and layout in a single component.

## Solution

Extract into a layout shell + toolbar + 1 new custom hook (`useSprintTaskActions`). Note: `useSprintPolling` and `useSprintKeyboardShortcuts` hooks already exist — this workstream updates them to use the split stores from WS3.

## Architecture

```
src/renderer/src/components/sprint/
  SprintCenter.tsx              — Layout shell, renders toolbar + content area (~150 LOC)
  SprintToolbar.tsx             — Filters, create button, view toggle (~80 LOC)

src/renderer/src/hooks/
  useSprintPolling.ts           — Already exists, update to use split stores
  useSprintKeyboardShortcuts.ts — Already exists, update to use split stores
  useSprintTaskActions.ts       — NEW: Task lifecycle callbacks (~80 LOC)
```

### SprintCenter (Layout Shell)

```typescript
// src/renderer/src/components/sprint/SprintCenter.tsx (~150 LOC)

export function SprintCenter() {
  // After WS3, selectors use split stores
  const tasks = useSprintTasks((s) => s.tasks)
  const selectedTaskId = useSprintUI((s) => s.selectedTaskId)
  const logDrawerTaskId = useSprintUI((s) => s.logDrawerTaskId)
  const repoFilter = useSprintUI((s) => s.repoFilter)

  // Custom hooks
  useSprintPolling()
  useSprintKeyboardShortcuts({ setModalOpen, setConflictDrawerOpen })
  const actions = useSprintTaskActions()

  // Derived state
  const filteredTasks = useMemo(() =>
    repoFilter ? tasks.filter(t => t.repo === repoFilter) : tasks,
    [tasks, repoFilter]
  )

  return (
    <div className="sprint-center">
      <SprintToolbar />
      {/* Content area: KanbanBoard or TaskTable based on view mode */}
      {/* Drawers: LogDrawer, SpecDrawer, ConflictDrawer, HealthCheckDrawer */}
    </div>
  )
}
```

### SprintToolbar

```typescript
// src/renderer/src/components/sprint/SprintToolbar.tsx (~80 LOC)

export function SprintToolbar() {
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)
  const repos = useSprintTasks((s) => [...new Set(s.tasks.map(t => t.repo).filter(Boolean))])

  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="sprint-toolbar">
      <RepoFilterDropdown repos={repos} value={repoFilter} onChange={setRepoFilter} />
      <Button onClick={() => setModalOpen(true)}>New Task</Button>
      <ViewToggle /> {/* Kanban vs Table */}
      {modalOpen && <NewTicketModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}
```

### useSprintTaskActions (NEW)

Consolidates the scattered callback handlers currently inline in SprintCenter. Must match actual behavior:

```typescript
// src/renderer/src/hooks/useSprintTaskActions.ts (~80 LOC)
import { TASK_STATUS } from '@shared/constants'

export function useSprintTaskActions() {
  const updateTask = useSprintTasks((s) => s.updateTask)
  const deleteTask = useSprintTasks((s) => s.deleteTask)
  const launchTask = useSprintTasks((s) => s.launchTask)
  const createTask = useSprintTasks((s) => s.createTask)

  const handleDragEnd = useCallback(
    (taskId: string, newStatus: string) => {
      updateTask(taskId, { status: newStatus })
    },
    [updateTask]
  )

  const handleMarkDone = useCallback(
    (task: SprintTask) => {
      updateTask(task.id, { status: TASK_STATUS.DONE })
    },
    [updateTask]
  )

  const handleStop = useCallback(
    async (task: SprintTask) => {
      if (!task.agent_run_id) return // guard: no agent to stop
      if (!confirm('Stop this agent?')) return
      await window.api.killAgent(task.agent_run_id)
      await updateTask(task.id, { status: TASK_STATUS.CANCELLED })
    },
    [updateTask]
  )

  // Rerun creates a NEW task (cloned from original), not an in-place mutation
  const handleRerun = useCallback(
    async (task: SprintTask) => {
      await createTask({
        title: task.title,
        prompt: task.prompt,
        repo: task.repo,
        priority: task.priority,
        template_name: task.template_name
      })
    },
    [createTask]
  )

  const handleDelete = useCallback(
    async (task: SprintTask) => {
      if (!confirm(`Delete "${task.title}"?`)) return
      await deleteTask(task.id)
    },
    [deleteTask]
  )

  return {
    handleDragEnd,
    handleMarkDone,
    handleStop,
    handleRerun,
    handleDelete,
    handleLaunch: launchTask
  }
}
```

## Changes

### 1. Create `useSprintTaskActions.ts`

New hook at `src/renderer/src/hooks/useSprintTaskActions.ts`. Extracts all task action callbacks from SprintCenter.

### 2. Update existing hooks for WS3 store split

Update `useSprintPolling.ts` and `useSprintKeyboardShortcuts.ts` to import from the new split stores (`useSprintTasks`, `useSprintUI`, `useSprintEvents`) instead of the monolithic `useSprintStore`.

Note: `useSprintKeyboardShortcuts` currently accepts `{ setModalOpen, setConflictDrawerOpen }` as arguments — preserve this signature.

### 3. Create `SprintToolbar.tsx`

Extract toolbar UI from SprintCenter. Move modal state and repo filter UI.

### 4. Rewrite `SprintCenter.tsx`

Reduce from ~456 LOC to ~150 LOC. Replace inline callbacks with `useSprintTaskActions()`. Keep layout rendering and drawer management.

### 5. Update tests

- Extract `SprintCenter.test.tsx` assertions about toolbar into `SprintToolbar.test.tsx`
- Add unit tests for `useSprintTaskActions` (pure callback logic)
- Update existing hook tests to use split store mocks

## File Size Targets

| File                            | Target LOC    |
| ------------------------------- | ------------- |
| `SprintCenter.tsx`              | ~150          |
| `SprintToolbar.tsx`             | ~80           |
| `useSprintTaskActions.ts`       | ~80 (new)     |
| `useSprintPolling.ts`           | ~40 (updated) |
| `useSprintKeyboardShortcuts.ts` | ~50 (updated) |

## Verification

- `npm run typecheck` passes
- `npm test` passes
- SprintCenter.tsx < 200 LOC
- Store selector count per component < 15
- `handleStop` uses `TASK_STATUS.CANCELLED` (not 'failed')
- `handleRerun` creates new task (not in-place mutation)

## Risk

Low. UI extraction with callback redistribution. Components already receive most data via props from SprintCenter — the inner components don't change. Key risk: ensure `handleStop` status and `handleRerun` clone-vs-mutate behavior match the current implementation exactly.

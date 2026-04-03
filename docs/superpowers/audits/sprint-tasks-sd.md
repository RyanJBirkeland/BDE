# Sprint & Tasks Domain -- Senior Developer Audit

**Auditor**: SD (Code Quality Lens)
**Date**: 2026-03-27
**Scope**: Views (SprintView, TaskWorkbenchView), Components (sprint/_, task-workbench/_), Store (sprintTasks.ts), CSS (sprint-pipeline-neon, task-workbench-neon, sprint-neon)

---

## 1. Executive Summary

The Sprint & Tasks domain is broadly functional with a well-structured optimistic update system and proper DOMPurify sanitization on innerHTML usage. However, several significant issues exist: a native `confirm()` call bypasses the app's modal system and blocks the renderer thread; multiple production components are orphaned (only imported in tests); large amounts of duplicated code exist between LogDrawer and TaskMonitorPanel; and the `handleSubmit` callback in WorkbenchForm has stale closure risks due to missing dependencies. The overall code quality is good with proper use of `useShallow`, `useCallback`, and `useMemo`, but the accumulated dead code from successive UI redesigns significantly increases the maintenance surface.

---

## 2. Critical Issues

### 2.1 Native `confirm()` blocks renderer thread (SprintDetailPane.tsx:120)

**File**: `src/renderer/src/components/sprint/SprintDetailPane.tsx`, line 120

```ts
if (confirm(`Delete task "${task.title}"?`)) {
```

This uses the browser-native `confirm()` dialog, which **blocks the entire renderer process**. Every other component in this domain uses the app's `useConfirm()` hook or `ConfirmModal` for async non-blocking confirmations. This is inconsistent and can freeze the UI. Additionally, the task title is interpolated directly into the confirm message -- while `confirm()` is not an XSS vector (it displays plain text), this is a code smell suggesting the author may have been unaware of the app's confirm system.

**Fix**: Replace with `useConfirm()` from `../ui/ConfirmModal`, matching the pattern used in `SpecDrawer.tsx`.

### 2.2 Double toast and double delete on SprintDetailPane (SprintDetailPane.tsx:118-125)

**File**: `src/renderer/src/components/sprint/SprintDetailPane.tsx`, lines 118-125

```ts
const handleDelete = useCallback(() => {
  if (!task || !onDelete) return
  if (confirm(`Delete task "${task.title}"?`)) {
    onDelete(task.id)
    onClose()
    toast.success('Task deleted')
  }
}, [task, onDelete, onClose])
```

The `onDelete` prop ultimately calls `useSprintTasks.deleteTask()`, which already calls `toast.success('Task deleted')` (sprintTasks.ts:174). This results in **two "Task deleted" toasts** firing for each delete operation.

---

## 3. Significant Issues

### 3.1 Stale closure in `handleSubmit` callback (WorkbenchForm.tsx:217)

**File**: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`, line 217

```ts
;[createOrUpdateTask, resetForm, setOperationalChecks, repo]
```

The dependency array is missing `mode` and `taskId`, which are referenced inside the callback body at line 212: `toast.success(mode === 'edit' && taskId ? 'Task updated' : 'Task created')`. While this only affects the toast message text (not data correctness), it means switching from create to edit mode could show the wrong success message. More concerning, the early `return` paths inside `handleSubmit` (lines 186-206) also reference `useTaskWorkbenchStore.getState()` for structural/semantic checks, which is safe since it reads from the store directly rather than the closure.

### 3.2 Optimistic create uses `Date.now()` for temp IDs (sprintTasks.ts:183)

**File**: `src/renderer/src/stores/sprintTasks.ts`, line 183

```ts
id: `temp-${Date.now()}`
```

If two tasks are created in the same millisecond (e.g., batch creation via TicketEditor), they will get the same temp ID. This could cause the second task to overwrite the first in the optimistic state. Use `crypto.randomUUID()` instead, which is already used in `TicketEditor.tsx:35`.

### 3.3 `pendingCreates` array grows without bounds on edge case (sprintTasks.ts:206-278)

**File**: `src/renderer/src/stores/sprintTasks.ts`

When `createTask` succeeds and the server returns an `id`, the temp ID is cleaned up from `pendingCreates` (line 227). When the server call fails, cleanup also happens (line 274). However, if `result?.id` is falsy (line 224) -- the success path where the server returns a result without an `id` field -- the temp ID is never removed from `pendingCreates`, and the optimistic task with the temp ID persists indefinitely in the store and will be preserved during every subsequent `loadData()` poll merge (lines 110-114).

### 3.4 Race condition in spec generation fire-and-forget (sprintTasks.ts:235-264)

**File**: `src/renderer/src/stores/sprintTasks.ts`, lines 235-264

After a task is created, if no spec is provided, a background `generatePrompt` call fires. The `.then()` handler updates the task's spec/prompt by matching on `result.id`. If the user deletes the task before the spec generation completes, the `.then()` handler will attempt to map over tasks and update a non-existent task. This is harmless (the map won't match), but the toast notification "Spec ready for..." (line 250) will still fire, and the "View Spec" action callback will try to select a deleted task.

### 3.5 LogDrawer and TaskMonitorPanel are near-identical clones

**Files**: `src/renderer/src/components/sprint/LogDrawer.tsx` (252 lines), `src/renderer/src/components/sprint/TaskMonitorPanel.tsx` (337 lines)

These two components share approximately 80% of their logic:

- Both have identical `useEffect` hooks for resetting state on agent change (LogDrawer:44-49, TaskMonitorPanel:57-62)
- Both have identical `catchUp` polling logic (LogDrawer:52-87, TaskMonitorPanel:65-98)
- Both have identical `displayEvents` memoization with thinking-event collapsing (LogDrawer:99-113, TaskMonitorPanel:107-122)
- Both have identical `handleOpenInAgents` and `handleCopyLog` callbacks
- Both use `exitCode` state that is never set (LogDrawer:31, TaskMonitorPanel:47) -- declared and initialized to `null` but never written to via any `setExitCode` call

This violates DRY and means bug fixes must be applied twice. Extract a shared `useAgentLogs(taskId, agentRunId, taskStatus)` hook.

### 3.6 `exitCode` state is never set (LogDrawer.tsx:31, TaskMonitorPanel.tsx:47)

**Files**: Both LogDrawer and TaskMonitorPanel

```ts
const [exitCode, setExitCode] = useState<number | null>(null)
```

The `setExitCode` function is never called anywhere in either component. The `exitCode` variable is read in the status label ternary (LogDrawer:168, TaskMonitorPanel:148) but will always be `null`. This is dead state.

### 3.7 Unbounded `logContent` state growth (LogDrawer.tsx:64, TaskMonitorPanel.tsx:77)

**Files**: Both LogDrawer and TaskMonitorPanel

```ts
setLogContent((prev) => prev + stripAnsi(result.content))
```

For long-running agents, the `logContent` string grows indefinitely with each 2-second poll. There is no cap or ring buffer. For a task running 60 minutes, this could accumulate megabytes of log text in React state, causing rendering overhead on every state update. Consider capping to the last N bytes or implementing virtualized rendering.

### 3.8 `ConflictDrawer` branchInfo dependency array concern (ConflictDrawer.tsx:29-76)

**File**: `src/renderer/src/components/sprint/ConflictDrawer.tsx`, line 76

The `useEffect` dependency array is `[open, tasks]`, but `branchInfo` is referenced in the guard at line 36 (`if (branchInfo[task.id] && !branchInfo[task.id].loading) continue`). Since `branchInfo` is not in the dependency array, the stale closure could skip fetching for tasks that were previously loaded in a prior open/close cycle, even though the data is reset when the drawer closes (line 83). The reset effect runs, but the fetch effect may fire before the reset effect due to React's effect ordering.

---

## 4. Minor Issues

### 4.1 Duplicated `formatElapsed` function

**Files**: `TaskPill.tsx:35-41`, `TaskDetailDrawer.tsx:23-29`

Identical implementations. Extract to a shared utility.

### 4.2 Duplicated `getDotColor` function

**Files**: `TaskPill.tsx:20-33`, `TaskDetailDrawer.tsx:41-58`

Nearly identical with slight differences (TaskDetailDrawer handles `failed`/`error`/`cancelled`). Extract to shared utility.

### 4.3 Duplicated `getStatusDisplay` function

**Files**: `SprintDetailPane.tsx:56-79`, `SprintTaskList.tsx:54-81`

Identical implementations. Extract to shared utility.

### 4.4 Duplicated `statusBadgeVariant` function

**Files**: `SprintDetailPane.tsx:38-54`, `TaskMonitorPanel.tsx:23-37`

Nearly identical. Extract to shared utility.

### 4.5 Duplicated `PRIORITY_OPTIONS` constant

**Files**: `WorkbenchForm.tsx:12-18`, `NewTicketModal.tsx:29-35`, `TaskTable.tsx:15-21`, `SprintTaskRow.tsx:42-48`

Four copies of the same constant. Extract to `lib/constants.ts`.

### 4.6 Inline styles in TaskMonitorPanel and SprintTaskRow

**Files**: `TaskMonitorPanel.tsx` (entire component uses inline `style={{}}` with `tokens.*`), `SprintTaskRow.tsx` (entire component uses inline styles)

Both files use inline styles extensively instead of CSS classes, violating the project's neon CSS convention documented in CLAUDE.md: "Do NOT use inline `tokens.*` styles for neon views -- use CSS classes."

### 4.7 `SpecPanel` initializes `draft` from `spec` prop but does not sync on prop change

**File**: `src/renderer/src/components/sprint/SpecPanel.tsx`, line 13

```ts
const [draft, setDraft] = useState(spec)
```

If the parent's `spec` prop changes while the panel is open (e.g., from a polling update), the draft will still show the stale initial value. This could cause the user to save old content over a newer server version.

### 4.8 `WorkbenchForm` keyboard shortcut re-registers on every submit cycle (WorkbenchForm.tsx:253-266)

**File**: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`, lines 253-266

The `useEffect` for the `Cmd+Enter` shortcut has `[submitting, handleSubmit]` in its dependency array, which means it re-registers the event listener on every submit cycle. While functionally correct, this is a minor inefficiency; using a ref for `submitting` would avoid the re-registration.

### 4.9 `SprintCenter` uses local `selectedTaskId` state instead of sprintUI store

**File**: `src/renderer/src/components/sprint/SprintCenter.tsx`, line 77

```ts
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
```

SprintPipeline uses `useSprintUI((s) => s.selectedTaskId)` from the store, but SprintCenter uses local `useState`. This means the selected task is not persisted across view switches. If SprintCenter is still in use, this is inconsistent with SprintPipeline's behavior.

### 4.10 Missing `operationalLoading` reset on error path (WorkbenchForm.tsx:143)

**File**: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`, line 143

`operationalLoading` is set to `true` at line 143 but only reset implicitly when `setOperationalChecks` is called (store line 171 sets `operationalLoading: false`). If the operational check throws before `setOperationalChecks` is called, `operationalLoading` stays `true` forever. The `try` block does not have a corresponding `catch` for this specific operation (the outer `finally` only resets `submitting`).

---

## 5. Dead Code Inventory

| #   | File                                | Lines | Description                                                                              |
| --- | ----------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| 1   | `sprint/CircuitPipelineExample.tsx` | 1-104 | Example/demo component, never imported in production code                                |
| 2   | `sprint/SprintTaskList.example.tsx` | 1-150 | Example/demo component, never imported anywhere                                          |
| 3   | `sprint/PRList.tsx`                 | 1-194 | Not imported by any production component (only test mock)                                |
| 4   | `sprint/LogDrawer.tsx`              | 1-252 | Not imported by any production component (only tests)                                    |
| 5   | `sprint/TaskMonitorPanel.tsx`       | 1-337 | Not imported by any production component (only tests)                                    |
| 6   | `sprint/SpecDrawer.tsx`             | 1-305 | Not imported by any production component (only tests + docs)                             |
| 7   | `sprint/KanbanBoard.tsx`            | 1-236 | Not imported by any production component (only tests)                                    |
| 8   | `sprint/KanbanColumn.tsx`           | 1-140 | Only imported by KanbanBoard (which is dead)                                             |
| 9   | `sprint/TaskCard.tsx`               | 1-253 | Only imported by KanbanColumn (which is dead)                                            |
| 10  | `sprint/BulkActionBar.tsx`          | 1-110 | Not imported by any production component (only tests)                                    |
| 11  | `sprint/NewTicketModal.tsx`         | 1-436 | Not imported by any production component (only tests)                                    |
| 12  | `sprint/SprintTaskRow.tsx`          | 1-528 | Not imported by any production component (only tests + docs)                             |
| 13  | `sprint/TaskTable.tsx`              | 1-536 | Not imported by any production component (only tests)                                    |
| 14  | `sprint/AgentStatusChip.tsx`        | 1-32  | Only imported by TaskCard (which is dead)                                                |
| 15  | `sprint/TaskEventSubtitle.tsx`      | 1-82  | Only imported by TaskCard (which is dead)                                                |
| 16  | `sprint/EventCard.tsx`              | 1-371 | Imported by LogDrawer + TaskMonitorPanel (both dead in production)                       |
| 17  | `sprint/LogDrawer.tsx:31`           | 31    | `exitCode` state + `setExitCode` -- never written to                                     |
| 18  | `sprint/TaskMonitorPanel.tsx:47`    | 47    | `exitCode` state + `setExitCode` -- never written to                                     |
| 19  | `sprint/SprintDetailPane.tsx:237`   | 237   | `_onMarkDone` parameter destructured with underscore prefix, never used in ActionButtons |
| 20  | `sprint/SprintDetailPane.md`        | all   | Documentation file for removed/legacy component                                          |
| 21  | `sprint/SprintTaskList.README.md`   | all   | Documentation file referencing dead SpecDrawer import                                    |
| 22  | `sprint/SprintTaskRow.md`           | all   | Documentation file for dead component                                                    |

**Total estimated dead code**: ~3,700+ lines across 16 components (plus 3 markdown docs). This represents the old SprintCenter-era UI that has been superseded by SprintPipeline. The dead code constitutes roughly 60% of the `sprint/` component directory by line count.

### Dead CSS (estimated)

`sprint-neon.css` (1400 lines) likely contains substantial dead CSS for the old SprintCenter layout (`.sprint-center__*`, `.kanban-*`, `.task-card*`, `.spec-drawer*`, `.log-drawer*`, `.bulk-action-bar*`, `.sprint-tasks__*`, `.new-ticket-modal*`). A CSS usage audit against the live component tree would likely find 40-60% of these selectors unused.

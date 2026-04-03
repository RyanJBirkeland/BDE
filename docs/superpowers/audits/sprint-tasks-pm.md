# Sprint & Tasks Domain — PM Audit

**Date:** 2026-03-27
**Scope:** SprintView, TaskWorkbenchView, `components/sprint/*`, `components/task-workbench/*`, `stores/sprintTasks.ts`

---

## 1. Executive Summary

The Sprint & Tasks domain provides a two-view workflow: Task Workbench for creation/editing, and Task Pipeline for monitoring execution. The core happy path is functional with good optimistic updates, toast notifications, and readiness checks. However, there are several broken or confusing workflows around error recovery, the relationship between the two creation paths (NewTicketModal vs. WorkbenchForm), missing loading/empty states on secondary panels, and silent failures that leave users stranded. The "blocked" task state has limited self-service recovery options, and navigating between the two views during edit flows loses context.

---

## 2. Critical Issues

### C1. "Launch" and "Queue Now" do the same thing in WorkbenchActions

**Files:** `src/renderer/src/components/task-workbench/WorkbenchActions.tsx` (lines 39-56), `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` (lines 361-363)

Both "Queue Now" and "Launch" call `handleSubmit('queue')`. The `onLaunch` prop is wired to `() => handleSubmit('queue')` (line 363). Despite different button styling and different disabled logic (`canQueue` vs `canLaunch`), both actions produce the same result: a queued task. Users see a "Launch" button that implies immediate agent execution, but it just queues. This is a trust-breaking UX mismatch.

### C2. SprintDetailPane uses browser `confirm()` for delete — bypasses app's ConfirmModal

**File:** `src/renderer/src/components/sprint/SprintDetailPane.tsx` (line 120)

`handleDelete` calls `confirm(...)` (native browser dialog), which looks jarring in Electron and is inconsistent with every other destructive action in the app (which uses `<ConfirmModal />`). In Electron, `window.confirm()` renders a system dialog that breaks the neon aesthetic and could confuse users.

### C3. Task "Edit" from Pipeline navigates to Workbench but does not load the task

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx` (line 276), `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` (lines 264-267, 309, 329)

The `onEdit` callback in `SprintPipeline` is `() => setView('task-workbench')` — it navigates to the Workbench view but does NOT call `loadTask(task)`. The user lands on a blank "New Task" form instead of seeing the selected task's data. Compare with `SprintCenter` which correctly wires `handleEditInWorkbench` (calls `loadTask` then `setView`). This means Task Pipeline users cannot edit existing tasks — the "Edit" button is effectively broken.

### C4. Re-run creates a duplicate task — no warning, original persists in failed state

**File:** `src/renderer/src/hooks/useSprintTaskActions.ts` (lines 127-145)

`handleRerun` calls `window.api.sprint.create(...)` to create a brand-new task with `status: TASK_STATUS.QUEUED`. The original failed/done task remains in the list. Users are not warned that this creates a duplicate, the original is not archived/cancelled, and over time the failed section accumulates stale copies. There's no link between the original and the re-run, making it impossible to trace retry history.

---

## 3. Significant Issues

### S1. Two competing task creation UIs with different capabilities

**Files:** `src/renderer/src/components/sprint/NewTicketModal.tsx`, `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`

`NewTicketModal` (used from SprintCenter's "+" button) and `WorkbenchForm` (TaskWorkbench view) both create tasks but with different feature sets:

- NewTicketModal: has 8 spec templates (feature, bugfix, refactor, audit, ux, infra, test, performance) but NO readiness checks, NO copilot, NO dependencies, NO queue-with-warnings flow
- WorkbenchForm: has 4 spec templates (feature, bugfix, refactor, test), readiness checks, copilot, dependencies, but NO audit/ux/infra/performance templates

Users don't know which to use. The modal is quick but limited; the Workbench is powerful but requires a view switch. The template sets are inconsistent, creating confusion about which templates exist.

### S2. Blocked tasks have no way to manually unblock

**File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` (lines 299-315)

For blocked tasks, the drawer shows an "Unblock" button that calls `onLaunch(task)` — which tries to launch an agent, not unblock. The launch will set status to `active` and spawn an agent, completely bypassing the dependency system. There's no UI to remove or override blocking dependencies. Users with legitimately blocked tasks that need manual override have no path except direct SQLite.

### S3. No loading indicator during spec generation in WorkbenchForm

**File:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` (lines 231-245)

`handleGenerate` sets a local `generating` state that only shows "Generating..." on the button itself. But the spec textarea has no visual indicator that content is about to appear. If the network is slow, users might start typing in the empty textarea, only to have their content replaced when the generated spec arrives (line 239: `setField('spec', result.spec)` overwrites without merging).

### S4. TaskDetailDrawer only opens when `drawerOpen` AND `selectedTask` are both set

**File:** `src/renderer/src/components/sprint/SprintPipeline.tsx` (lines 265-279)

Clicking a TaskPill sets `selectedTaskId` (via `handleTaskClick`) but does NOT set `drawerOpen = true`. The `setSelectedTaskId` in `sprintUI.ts` (line 56) does set `drawerOpen: id !== null`, but SprintPipeline uses its own `selectedTaskId` from `useSprintUI` — and the task click only calls `setSelectedTaskId`. The drawer visibility depends on the store's `drawerOpen` flag, which IS set correctly by `setSelectedTaskId`. However, closing the drawer sets both `drawerOpen: false` and `selectedTaskId: null` (line 137-140), and the auto-select on first load (lines 113-120) sets the ID but might not trigger the drawer for returning users who previously closed it.

### S5. SpecPanel shows raw text, not rendered markdown

**File:** `src/renderer/src/components/sprint/SpecPanel.tsx` (lines 54-57)

The spec is displayed in a `<pre>` tag with `whiteSpace: pre-wrap`. Meanwhile, `SprintDetailPane` renders specs with `renderMarkdown()` (line 330-332). Users editing specs in SpecPanel see raw markdown, but viewing in the detail pane shows rendered HTML. This inconsistency makes editing confusing — users can't see how their spec will look until they close the panel.

### S6. No error feedback when `depends_on` tasks are missing from the task list

**File:** `src/renderer/src/components/sprint/SprintDetailPane.tsx` (lines 98-103)

`dependencyTasks` filters out deps where `allTasks.find(...)` returns undefined, silently dropping them. If a dependency was deleted or has an invalid ID, the user sees fewer deps than expected with no indication that some are missing. Same silent dropping in `TaskDetailDrawer.tsx` (lines 60-68).

### S7. No way to cancel a queued task from the pipeline

**File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` (lines 276-298)

For queued tasks, the drawer shows Launch, Edit, and Delete. There is no "Cancel" or "Move back to Backlog" action. Users who queued a task by mistake must either delete it and recreate, or wait for it to be picked up by an agent. Backlog demotion is only available indirectly.

### S8. WorkbenchForm loses copilot conversation history on form reset

**File:** `src/renderer/src/stores/taskWorkbench.ts` (line 145)

`resetForm()` resets `copilotMessages` back to just the welcome message. If a user spent time researching in the copilot, created a task, and wants to create a related follow-up, all their copilot context is lost. The reset is called after every successful submit (WorkbenchForm line 211).

### S9. Semantic checks fire on every spec keystroke (debounced 2s) hitting the LLM

**File:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` (lines 89-130)

The semantic check effect fires an LLM call (`window.api.workbench.checkSpec`) after a 2s debounce on EVERY spec change. For active typists, this means an LLM call roughly every 2 seconds during editing. There's no backoff, no cap on concurrent calls, and no cancellation of stale requests. While individual calls may be fast (haiku model), this could be expensive and unnecessary noise.

---

## 4. Minor Issues

### M1. Duplicate `formatElapsed` and `getDotColor` helper functions

**Files:** `TaskDetailDrawer.tsx` (lines 23-58), `TaskPill.tsx` (lines 20-41)

Both components define their own `formatElapsed` and `getDotColor` with identical logic. Should be extracted to a shared utility.

### M2. Duplicate `statusBadgeVariant` and `getStatusDisplay` functions

**Files:** `SprintDetailPane.tsx` (lines 38-79), `SprintTaskList.tsx` (lines 32-81), `TaskMonitorPanel.tsx` (lines 23-37)

Three separate implementations of status-to-badge-variant mapping with slightly different return types and logic. `SprintTaskList` returns `'muted'` for backlog while `SprintDetailPane` returns `'default'`.

### M3. PipelineBacklog empty state uses inline styles instead of CSS classes

**File:** `src/renderer/src/components/sprint/PipelineBacklog.tsx` (line 57)

`<div style={{ fontSize: '10px', color: 'var(--neon-text-dim)', padding: '8px 0' }}>` — should use a neon CSS class per the codebase convention.

### M4. DoneHistoryPanel items are not keyboard-accessible

**File:** `src/renderer/src/components/sprint/DoneHistoryPanel.tsx` (lines 18-23)

`done-history__item` uses `onClick` on a `<div>` with no `role`, `tabIndex`, or `onKeyDown`. Unlike `PipelineBacklog` cards which correctly implement keyboard interaction patterns.

### M5. TaskMonitorPanel uses extensive inline styles instead of CSS classes

**File:** `src/renderer/src/components/sprint/TaskMonitorPanel.tsx` (throughout, ~80 lines of inline styles)

Violates the neon styling convention documented in CLAUDE.md. All other sprint components use BEM CSS classes in dedicated neon CSS files.

### M6. SpecEditor template buttons don't indicate current selection

**File:** `src/renderer/src/components/task-workbench/SpecEditor.tsx` (lines 67-79)

After clicking a template button (e.g., "Feature"), there's no visual indication that the feature template was selected. The button looks the same as all others. Compare with `NewTicketModal` which has `--active` class toggling.

### M7. WorkbenchCopilot "Insert into spec" doesn't confirm or show what was inserted

**File:** `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx` (lines 152-158)

`handleInsert` appends content to the spec silently. No toast, no scroll-to-bottom of the spec editor, no visual flash. Users may not realize the insert worked, especially if the copilot panel is resized to cover the spec.

### M8. Priority P3 is the default but "More options" hides it — users can't change priority in basic mode

**File:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` (lines 304-347)

Priority is behind the "More options" toggle. Users who always want P1/P2 must click the toggle every time. There's no way to change the default or remember the preference.

### M9. Cmd+Enter shortcut only triggers "queue" action, not the visible primary action

**File:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` (lines 253-266)

Cmd+Enter always calls `handleSubmit('queue')`. If a user intends to save to backlog (the secondary action), there's no keyboard shortcut for it. The shortcut isn't documented in the UI either.

### M10. CircuitPipeline component referenced but never read in this audit — used only in SprintCenter (the legacy view)

**File:** `src/renderer/src/components/sprint/CircuitPipeline.tsx`

SprintCenter and SprintPipeline are two different layout approaches for the same data. SprintCenter (two-column list + detail) uses CircuitPipeline; SprintPipeline (horizontal stages) does not. Users may see one or the other depending on which view is loaded, with different navigation paradigms.

---

## 5. User Journey Map

```
                            TASK CREATION & EXECUTION FLOW
================================================================================

  START
    |
    v
  [Task Workbench View]                    [Task Pipeline / Sprint Center]
    |                                        |
    |  Fill title + repo                     |  Click "+" button
    |  (Optional) Write/generate spec        |       |
    |  (Optional) Use AI copilot             |       v
    |  Readiness checks run                  |  [NewTicketModal]
    |       |                                |    Quick mode: title+repo only
    |       v                                |    Template mode: title+repo+spec
    |  +-----------+  +----------+           |       |
    |  |Save Backlog|  |Queue Now|           |       v
    |  +-----------+  +----------+           |   "Save" --> Backlog
    |       |              |                 |
    |       v              v                 |
    |   BACKLOG         QUEUED               |
    |       |              |                 |
    |       |              |  <-- AgentManager drain loop picks up
    |       |              v
    |       |           ACTIVE  -----> agent runs in worktree
    |       |              |
    |       |         +----+----+
    |       |         |         |
    |       |         v         v
    |       |       DONE      FAILED/ERROR
    |       |         |         |
    |       |    (PR opened)   (notes show error)
    |       |         |         |
    |       |         v         v
    |       |    PR REVIEW    [Re-run] --> creates NEW queued task (!)
    |       |         |                     original stays in failed list
    |       |    (merge/close)
    |       |         |
    |       v         v
    |      END       END

  ERROR RECOVERY PATHS:
  =====================

  ACTIVE + stuck agent ----> HealthCheckDrawer "Rescue" ----> QUEUED (re-drainable)

  ACTIVE + merge conflict --> ConflictDrawer "Fix Conflicts" -> spawns resolution agent

  BLOCKED (deps unmet) ----> "Unblock" button [BUG: actually launches agent,
                              bypassing deps]
                              No proper unblock/override UI exists.

  FAILED/ERROR ------------> "Re-run" creates duplicate task in QUEUED
                              Original task persists (no archive/cancel)
                              No "Edit & Retry" workflow

  QUEUED (by mistake) -----> No "Move to Backlog" button
                              Must DELETE and recreate, or wait for agent pickup


  VIEW NAVIGATION PAIN POINTS:
  ============================

  Pipeline "Edit" btn --X--> Workbench (blank form! Task not loaded)  [BUG]
  SprintCenter "Edit"  ---> Workbench (task loaded correctly via loadTask)
  Workbench submit     ---> Form resets (copilot context lost)
                              No "Go to Pipeline" navigation offered


  TWO CREATION PATHS (user confusion):
  =====================================

  NewTicketModal (from SprintCenter "+"):
    - 8 templates, Quick/Template tabs
    - NO readiness checks
    - NO copilot
    - NO dependency config
    - Always saves to Backlog

  WorkbenchForm (Task Workbench view):
    - 4 templates
    - 3-tier readiness checks
    - AI copilot sidebar
    - Dependency config (in advanced)
    - Save to Backlog OR Queue Now

  --> Users don't know which to use
  --> Template sets are different
  --> Quality gates only exist in Workbench path
```

# Sprint & Tasks Domain -- Architectural Audit (AX Lens)

**Date:** 2026-03-27
**Scope:** SprintView, TaskWorkbenchView, `components/sprint/` (27 components), `components/task-workbench/` (6 components), `stores/sprintTasks.ts`, `stores/sprintUI.ts`, `stores/taskWorkbench.ts`, plus 3 CSS files.

---

## 1. Executive Summary

The Sprint & Tasks domain has a **dual-layout problem**: `SprintCenter` (legacy two-column list+detail) and `SprintPipeline` (new vertical pipeline) both exist as fully independent orchestrators, each wiring up identical hooks, stores, and side effects. This duplication means every new feature or bug fix must be synchronized across both paths. The `sprintTasks` store is well-designed with clean optimistic update semantics, but it leaks task-creation business logic (background spec generation, toast orchestration) that belongs in a service layer. The task-workbench boundary is architecturally clean -- it owns its own store and has no circular dependencies with the pipeline -- but `WorkbenchForm` has grown into a 375-line god component that mixes form state, submission logic, readiness checks, semantic validation, and keyboard shortcuts.

---

## 2. Critical Issues (Must Fix)

### C1. Dual Orchestrator Duplication -- SprintCenter vs SprintPipeline

**Files:**

- `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintCenter.tsx` (255 lines)
- `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintPipeline.tsx` (303 lines)

Both components independently:

- Subscribe to `useSprintTasks` (tasks, loading, loadError) -- SprintCenter L40-46, SprintPipeline L32-40
- Call `useSprintTaskActions()` -- SprintCenter L61-69, SprintPipeline L60-68
- Call `useHealthCheck(tasks)` -- SprintCenter L71, SprintPipeline L70
- Initialize `initTaskOutputListener()` -- SprintCenter L87-91, SprintPipeline L84-87
- Wire `setOpenLogDrawerTaskId` -- SprintCenter L94-97, SprintPipeline L90-93
- Call `useTaskToasts()` -- SprintCenter L106, SprintPipeline L102
- Call `useSprintPolling()`, `usePrStatusPolling()`, `useSprintKeyboardShortcuts()` -- SprintCenter L109-111, SprintPipeline L105-110
- Auto-select first task on load -- SprintCenter L114-118, SprintPipeline L113-120

**Impact:** Any fix to polling, notification, or lifecycle logic must be applied twice. If both views are mounted simultaneously (possible in the panel system), duplicate polling and event listeners will fire.

**Fix:** Extract a shared `useSprintOrchestration()` hook that encapsulates all side effects (polling, events, notifications, auto-selection), returning only the derived data and action handlers both layouts need.

### C2. Massive Component Surface With Orphaned Legacy Components

**Files:** 27 files in `components/sprint/`, many serving the same role under different layouts.

Component overlap map:
| Concern | SprintCenter path | SprintPipeline path | Status |
|---|---|---|---|
| Task list | `SprintTaskList` | `PipelineBacklog` + `PipelineStage` | Parallel |
| Task detail | `SprintDetailPane` | `TaskDetailDrawer` | Parallel |
| Task card | `TaskCard` (DnD) | `TaskPill` (motion) | Parallel |
| Log viewer | `LogDrawer` | `TaskMonitorPanel` | Near-identical |
| Spec viewer | `SpecDrawer` | `SpecPanel` | Parallel |
| Task table | `TaskTable` + `SprintTaskRow` | (unused in pipeline) | Legacy only |
| Kanban | `KanbanBoard` + `KanbanColumn` | (unused in pipeline) | Legacy only |

`LogDrawer` (252 lines) and `TaskMonitorPanel` (337 lines) share ~80% identical code: state management for log content, agent events, display events collapsing, "Open in Agents" navigation, and copy-log functionality. The only differences are: LogDrawer has a steer-input, and TaskMonitorPanel uses inline `tokens.*` styles instead of CSS classes.

**Impact:** ~800 lines of duplicated or near-duplicated UI code. Feature parity drift is inevitable.

**Fix:** Determine which layout is the canonical path going forward. If SprintPipeline is the future, deprecate SprintCenter and its exclusive subtree (`KanbanBoard`, `KanbanColumn`, `TaskCard`, `BulkActionBar`, `SprintTaskRow`, `TaskTable`, `SprintTaskList`, `SprintDetailPane`, `LogDrawer`, `SpecDrawer`, `ConflictDrawer`, `HealthCheckDrawer`, `PRList`). Extract shared log-viewing logic into a `useAgentLogViewer` hook.

### C3. `SprintTask` Type Re-export Creates Phantom Coupling

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintCenter.tsx` L34

```typescript
export type { SprintTask }
```

Six components (`TaskCard`, `LogDrawer`, `TaskMonitorPanel`, `KanbanColumn`, `KanbanBoard`, `SpecDrawer`) import `SprintTask` from `./SprintCenter` instead of from `../../../../shared/types`. This creates a dependency on SprintCenter purely for a type alias, making it impossible to tree-shake or remove SprintCenter without updating all importers.

**Impact:** Artificial coupling that blocks cleanup.

**Fix:** All components should import `SprintTask` directly from `src/shared/types`. Remove the re-export from SprintCenter.

---

## 3. Significant Issues (Should Fix)

### S1. `sprintTasks` Store Leaks Business Logic

**File:** `/Users/ryan/projects/BDE/src/renderer/src/stores/sprintTasks.ts` L180-278

The `createTask` action contains:

- Optimistic UI update (L206-209) -- appropriate for a store
- IPC call to backend (L212-222) -- appropriate
- Background spec generation with template detection (L231-264) -- business logic
- Toast notifications with action callbacks (L250-257) -- UI orchestration
- Cross-store mutation via `useSprintUI.getState()` (L233, L253-254) -- coupling

A Zustand store action should not orchestrate multi-step business flows with cross-store side effects. This makes `createTask` untestable without mocking window.api, toast, and sprintUI.

**Fix:** Extract task creation orchestration into a `useCreateTask` hook or a `taskCreationService` that composes the store action, spec generation, and toast notification as separate steps.

### S2. `WorkbenchForm` Is a God Component

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/task-workbench/WorkbenchForm.tsx` (375 lines)

Responsibilities mixed into one component:

1. Form field rendering (title, repo, priority, playground toggle)
2. Submission logic with create-or-update branching (L53-86)
3. Debounced semantic check triggering (L89-130)
4. Operational check orchestration with warning aggregation (L142-218)
5. Keyboard shortcut handling (L253-266)
6. Spec generation via IPC (L231-245)
7. Copilot research delegation (L247-250)

**Fix:** Extract `useWorkbenchSubmission()` (handles create/update/queue logic), `useSemanticChecks()` (debounced spec checking), and move keyboard shortcuts to the parent `TaskWorkbench`.

### S3. Duplicated Helper Functions Across Components

Multiple files define identical or near-identical utility functions:

- `formatElapsed(startedAt)`: `TaskPill.tsx` L35-41, `TaskDetailDrawer.tsx` L23-29
- `formatTimestamp(iso)`: `TaskDetailDrawer.tsx` L31-38
- `getDotColor(status)`: `TaskPill.tsx` L20-33, `TaskDetailDrawer.tsx` L41-58
- `statusBadgeVariant(status)`: `SprintDetailPane.tsx` L38-54, `TaskMonitorPanel.tsx` L23-37
- `getStatusDisplay(task)`: `SprintDetailPane.tsx` L56-79, `SprintTaskList.tsx` L54-81
- `priorityVariant(priority)`: `SprintTaskRow.tsx` L54-58, `TaskTable.tsx` L49-53
- `PRIORITY_OPTIONS`: `WorkbenchForm.tsx` L12-18, `NewTicketModal.tsx` L29-35, `TaskTable.tsx` L43-48, `SprintTaskRow.tsx` L42-48

**Fix:** Create `src/renderer/src/lib/task-format.ts` exporting shared `formatElapsed`, `getDotColor`, `statusBadgeVariant`, `getStatusDisplay`, `priorityVariant`, and `PRIORITY_OPTIONS`.

### S4. Inconsistent Styling Approaches

The sprint domain mixes three styling patterns:

1. **CSS classes** (neon convention): `PipelineBacklog`, `PipelineStage`, `TaskPill`, `SprintTaskList`
2. **Inline `tokens.*` styles**: `TaskMonitorPanel` (entire component, ~50 style objects), `SprintTaskRow` (~30 style objects), `EventCard`, `TicketEditor`
3. **Inline `var(--neon-*)` CSS variables**: `PipelineBacklog` L27, L57, L64 use inline `style={{ color: 'var(--neon-blue)' }}`

Per CLAUDE.md: "Do NOT use inline `tokens.*` styles for neon views -- use CSS classes." `TaskMonitorPanel` and `SprintTaskRow` violate this directly.

**Fix:** Migrate `TaskMonitorPanel` and `SprintTaskRow` to CSS classes in `sprint-pipeline-neon.css`. Remove inline `var(--neon-*)` usage in `PipelineBacklog`.

### S5. `NewTicketModal` Is Functionally Superseded

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/NewTicketModal.tsx` (435 lines)

This modal duplicates the task creation flow now handled by `TaskWorkbench`. It has its own:

- Template system (8 templates, L37-69) vs WorkbenchForm's `SpecEditor` (4 templates, SpecEditor.tsx L5-26)
- Priority options (identical constant, redefined)
- Repo selector (identical pattern)
- Quick/template mode tabs

Per CLAUDE.md: "Task creation removed from pipeline (lives in Task Workbench only)."

**Fix:** Remove `NewTicketModal` entirely. It's already not imported by `SprintPipeline`.

### S6. `SpecPanel` Buttons Use Wrong CSS Namespace

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SpecPanel.tsx` L63-80

The Save/Edit/Cancel buttons use `task-drawer__btn` classes, which belong to `TaskDetailDrawer`'s CSS namespace. This creates implicit coupling between SpecPanel and TaskDetailDrawer's styles.

**Fix:** Define `.spec-panel__btn` classes in `sprint-pipeline-neon.css`.

---

## 4. Minor Issues (Nice to Fix)

### M1. `CircuitPipeline` Does Not Use `partitionSprintTasks()`

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/CircuitPipeline.tsx` L24-43

`countForStage()` manually filters tasks by raw status strings, duplicating the partitioning logic in `partitionSprintTasks()`. The pipeline view's "Done" count would differ from the CircuitPipeline count because `partitionSprintTasks` treats `active+pr_status=open` as "awaitingReview" rather than "in-progress", but CircuitPipeline counts raw `active` status.

### M2. `DoneHistoryPanel` Uses `task-pill__badge` Class

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/DoneHistoryPanel.tsx` L25-27

Borrows `.task-pill__badge` class from TaskPill's namespace for repo badges, creating cross-component CSS coupling.

### M3. `HealthCheckDrawer` Bypasses Store for Task Updates

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/HealthCheckDrawer.tsx` L27

Calls `window.api.sprint.update()` directly instead of going through `useSprintTasks.updateTask()`. This skips optimistic updates and pending-field protection.

### M4. `TaskWorkbenchStore.setField()` Uses Unsafe String Keys

**File:** `/Users/ryan/projects/BDE/src/renderer/src/stores/taskWorkbench.ts` L141

```typescript
setField: (field, value) => set({ [field]: value } as Partial<TaskWorkbenchState>)
```

The `field` parameter is typed as `string`, allowing setting arbitrary keys. Should be constrained to a union of valid field names.

### M5. `SprintCenter` Has Local `selectedTaskId` State

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintCenter.tsx` L77

SprintCenter uses `useState<string | null>(null)` for `selectedTaskId`, while SprintPipeline uses `useSprintUI((s) => s.selectedTaskId)`. This means navigating from Dashboard to SprintCenter won't preserve the selected task from SprintUI state.

### M6. `TicketEditor` Creates Tasks Sequentially

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/TicketEditor.tsx` L88-99

The `createAll()` function uses a sequential `for...of` loop with `await`. For 5+ tickets, this creates a noticeable delay. Could use `Promise.allSettled()` for parallel creation.

### M7. Three Markdown README Files in Sprint Components

**Files:**

- `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintDetailPane.md`
- `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintTaskList.README.md`
- `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintTaskRow.md`

Per conventions, documentation should not be scattered as component-level .md files.

---

## 5. Architecture Diagram

```
                          VIEWS
                +-----------+-----------+
                |                       |
         SprintView              TaskWorkbenchView
                |                       |
         SprintPipeline          TaskWorkbench
         (orchestrator)          (orchestrator)
                |                  /          \
    +-----------+--------+    WorkbenchForm  WorkbenchCopilot
    |           |        |        |
PipelineBacklog |  TaskDetailDrawer   |
    |      PipelineStage    |    SpecEditor
    |           |           |    ReadinessChecks
    |       TaskPill    SpecPanel    WorkbenchActions
    |                   DoneHistoryPanel
    |
    +--- [LEGACY: SprintCenter orchestrator]
              |
    +---------+----------+----------+
    |         |          |          |
 CircuitPipeline  SprintTaskList  SprintDetailPane
    |              |
 KanbanBoard   TaskTable / SprintTaskRow
    |
 KanbanColumn
    |
 TaskCard (DnD)
    |
 AgentStatusChip, TaskEventSubtitle

                    STORES
    +---------------+---------------+
    |               |               |
sprintTasks     sprintUI      taskWorkbench
(data+actions)  (UI state)    (form+copilot)
    |               |               |
    +-------+-------+       (no cross-deps)
            |
     [cross-store call:
      createTask() -> sprintUI.addGeneratingId()]

                  DATA FLOW
    +-----------------------------------------+
    | window.api.sprint.*  (IPC to main)      |
    |   .list()  .create()  .update()         |
    |   .delete() .readLog() .generatePrompt()|
    +-----------------------------------------+
              ^                |
              |                v
         sprintTasks       components
         (optimistic)      (via selectors)
              ^
              |
    +-----------------------------------------+
    | SSE: mergeSseUpdate()                   |
    | DB watcher: sprint:externalChange       |
    +-----------------------------------------+

                  HOOK LAYER
    +-------------------------------------------+
    | useSprintPolling     (loadData interval)  |
    | usePrStatusPolling   (PR status checks)   |
    | useSprintTaskActions (launch/stop/rerun)  |
    | useSprintKeyboardShortcuts               |
    | useHealthCheck       (stuck task detect)  |
    | useTaskToasts        (notifications)      |
    | useReadinessChecks   (structural Tier 1)  |
    +-------------------------------------------+
         Used by BOTH SprintCenter AND
         SprintPipeline (duplication risk)
```

---

## Summary of Recommendations by Priority

| Priority    | Issue                                            | Effort     | Impact                             |
| ----------- | ------------------------------------------------ | ---------- | ---------------------------------- |
| Critical    | C1: Extract shared orchestration hook            | Medium     | Eliminates duplicate side effects  |
| Critical    | C2: Deprecate legacy SprintCenter subtree        | Large      | Removes ~1200 lines of dead weight |
| Critical    | C3: Fix SprintTask import paths                  | Small      | Removes phantom coupling           |
| Significant | S1: Extract createTask business logic from store | Medium     | Improves testability               |
| Significant | S2: Split WorkbenchForm                          | Medium     | Single responsibility              |
| Significant | S3: Extract shared task-format utilities         | Small      | DRY                                |
| Significant | S4: Migrate inline tokens to CSS classes         | Medium     | Style consistency                  |
| Significant | S5: Remove NewTicketModal                        | Small      | Dead code removal                  |
| Significant | S6: Fix SpecPanel CSS namespace                  | Small      | Decoupling                         |
| Minor       | M1-M7: Various small fixes                       | Small each | Polish                             |

# Proposal — Task Workbench Modal

## Why

Adding and editing a sprint task today is funneled through a single 480px right-edge **slide-over drawer** (`WorkbenchPanel`) inside Task Planner. Three problems:

- The drawer header is hardcoded `"New Task"` even when editing an existing task — the body shows `"Edit: T-40 ..."` while the title still says New, which is a flat-out lie.
- The form is cramped. 480px squeezes the spec textarea, dependency picker, and validation list into a single narrow column.
- The embedded AI Copilot panel renders *inside* the same 480px drawer, so the form and Copilot fight each other for horizontal space — making both worse than either would be alone.

On top of the drawer's own issues, **Task Pipeline's "Edit" button does not open the drawer in place** — it calls `setView('planner')`, jumping the user off the Pipeline view and onto Task Planner before opening the drawer. Two surface changes for one user intent.

The fix is one canonical add/edit surface that has room to breathe and opens in place from any view that needs it.

> Note: CLAUDE.md mentions a `Cmd+0` "Task Workbench" view, but no such view exists in `VIEW_REGISTRY` or `src/renderer/src/views/` today. CLAUDE.md is stale; the retirement language refers only to the drawer.

## What Changes

Replace the drawer with a single canonical **Add/Edit Task modal** that hosts the existing `TaskWorkbench` component.

- **Retire** `WorkbenchPanel` (`src/renderer/src/components/planner/WorkbenchPanel.tsx` + `.css`) and `PlannerView`'s local `workbenchOpen` state.
- **Introduce** `TaskWorkbenchModal` — the new shell. Centered on the viewport at ~1200×800 (max 95vw / 90vh), form column ~65% / Copilot ~35% side-by-side, with a title that reflects mode: `"New Task"` for create, `"Edit T-<id>: <title>"` for edit.
- **Centralize** modal open/close state in a small Zustand store (`taskWorkbenchModal`) so any view can launch it without owning local boolean state or jumping views.
- **Remove the view-jump** from Task Pipeline's Edit handler — clicking Edit opens the modal in place; closing it returns the user to the Pipeline.
- **Confirm-on-dirty** dismissal: ESC, backdrop click, and the X button all check whether the workbench form is dirty (changed from baseline) and prompt before discarding.

## Impact

**Affected code (renderer only — no main-process or IPC changes):**

- New: `src/renderer/src/components/task-workbench/TaskWorkbenchModal.tsx` + `.css`
- New: `src/renderer/src/stores/taskWorkbenchModal.ts` (open/close + mode + originating task id)
- New: `src/renderer/src/hooks/useFormDirty.ts` (or co-located helper) — derive a `dirty` boolean from the existing `taskWorkbench` store snapshot vs. its baseline.
- Edit: `src/renderer/src/components/sprint/SprintPipeline.tsx` — `onEdit` opens the modal instead of `setView('planner')`.
- Edit: `src/renderer/src/views/PlannerView.tsx` — `handleAddTask` / `handleEditTask` open the modal; remove `workbenchOpen` local state and `<WorkbenchPanel>` render.
- Edit: `src/renderer/src/App.tsx` — mount `<TaskWorkbenchModal />` once at the app root.
- Delete: `src/renderer/src/components/planner/WorkbenchPanel.tsx` + `.css`.

**Affected behavior:**

- Pipeline "Edit" no longer changes views.
- Modal title reflects edit vs. create mode (no more lying "New Task" header).
- Existing form state, validation checks, Copilot streaming, and persistence are unchanged — only the host changes.

**Non-goals:**

- No changes to the `taskWorkbench` Zustand store fields, the form components (`WorkbenchForm`, `WorkbenchCopilot`, `SpecEditor`, `ValidationChecks`, `WorkbenchActions`), the `workbench:chatStream` IPC channel, the synthesizer, validation logic, or task creation/update services.
- No redesign of the form itself. This change is strictly the host surface.

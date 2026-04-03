# Sprint Pipeline — UX QA Audit

**Date:** 2026-03-29
**Scope:** 29 files (14 source, 9 tests, 6 supporting modules)
**Persona:** UX QA Engineer

---

## Cross-Reference with Synthesis Final Report (2026-03-28)

### Previously Reported — Now Fixed

| Synthesis ID | Issue                                               | Evidence                                                                                                                                                                                                        |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-3         | Pipeline "Edit" button navigates to blank Workbench | **Fixed.** `SprintPipeline.tsx:278` now calls `useTaskWorkbenchStore.getState().loadTask(selectedTask)` before `setView('task-workbench')`. The `onEdit` callback in the drawer correctly loads the task first. |

### Previously Reported — Still Open

| Synthesis ID         | Issue                                                         | Current Status                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-1               | Dual orchestrator duplication (SprintCenter + SprintPipeline) | SprintCenter is dead code but still exists in the repo. SprintPipeline is the active pipeline. No shared hook yet.                                                                                        |
| UX-1                 | Agent failure notes not actionable                            | Failed tasks in `PipelineBacklog.tsx:79` show raw `task.notes` truncated to 40 chars with no recovery guidance. "No details" shown when notes are null.                                                   |
| 3.5 (window.confirm) | Native browser dialogs in Electron                            | Not present in Sprint Pipeline files — already clean here.                                                                                                                                                |
| 3.7 (inline styles)  | Inline `tokens.*` styles for neon views                       | `TicketEditor.tsx` (lines 288-430) uses 30+ inline style objects via `tokens.*`. `PipelineBacklog.tsx:57,64,87` uses inline styles for colors. `SpecPanel.tsx:41-51` uses inline styles for the textarea. |

---

## Findings

### Critical

**SP-UX-001: ConflictDrawer and HealthCheckDrawer are unreachable from the pipeline UI**

- **File:** `src/renderer/src/components/sprint/SprintPipeline.tsx:110`
- **Evidence:** `setConflictDrawerOpen: () => {}` is passed to `useSprintKeyboardShortcuts` as a no-op. Neither `ConflictDrawer` nor `HealthCheckDrawer` are imported or rendered in `SprintPipeline.tsx`. The `useHealthCheck` hook runs (line 71) and computes `visibleStuckTasks`, but the result is discarded — neither the return value nor any UI element exposes stuck tasks to the user.
- **Impact:** Users have no way to discover stuck tasks or merge conflicts from the pipeline view. The health check runs server-side but the results are silently thrown away.
- **Fix:** Render `HealthCheckDrawer` and `ConflictDrawer` in SprintPipeline. Wire `visibleStuckTasks` from `useHealthCheck()` to the drawer. Add a visible indicator (badge/icon) in the header when stuck tasks or conflicts exist.

**SP-UX-002: CircuitPipeline component in sprint/ is dead code — never imported**

- **File:** `src/renderer/src/components/sprint/CircuitPipeline.tsx` (95 lines)
- **Evidence:** `grep` for `import.*CircuitPipeline.*from.*sprint` returns zero results. A separate `CircuitPipeline` exists in `src/renderer/src/components/neon/CircuitPipeline.tsx` and is exported from the neon index. The sprint-local copy is orphaned.
- **Impact:** Maintenance burden. Developers may modify the wrong file.
- **Fix:** Delete `src/renderer/src/components/sprint/CircuitPipeline.tsx`.

### Significant

**SP-UX-003: Task selection does not open the drawer on single click — requires prior drawer state**

- **File:** `src/renderer/src/stores/sprintUI.ts:56`
- **Evidence:** `setSelectedTaskId: (id) => set({ selectedTaskId: id, drawerOpen: id !== null })` does auto-open the drawer. However, `SprintPipeline.tsx:124-129` calls `setSelectedTaskId(id)` on task click, which opens the drawer. But then `handleCloseDrawer` (line 138) sets `setDrawerOpen(false)` AND `setSelectedTaskId(null)`. After closing, the next click re-opens correctly. **However**, when the user clicks a TaskPill in PipelineStage, the pill calls `onTaskClick(task.id)` which calls `handleTaskClick` which calls `setSelectedTaskId`. This works. But clicking a task in `PipelineBacklog` also calls `onTaskClick(task.id)` via the same path. So backlog/failed items open the drawer — but the drawer action buttons show "Launch" for backlog tasks, which may confuse users since the "Add to queue" button already exists inline.
- **Impact:** Minor confusion — two paths to launch exist (backlog inline button + drawer Launch button) with different behaviors (one queues, the other spawns an agent directly).
- **Fix:** Clarify the backlog drawer Launch button label to match its actual behavior (it calls `onLaunch` which triggers `launchTask`, not "add to queue"). Consider making the backlog drawer show "Queue" instead of "Launch" since backlog tasks should be queued first.

**SP-UX-004: "Unblock" button on blocked tasks calls `onLaunch` — misleading label vs action**

- **File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:329-333`
- **Evidence:** For blocked tasks, the primary button says "Unblock" but calls `onLaunch(task)`. The `onLaunch` prop is wired to `launchTask` in `SprintPipeline.tsx:270`, which calls `useSprintTasks.launchTask()`. This spawns an agent (line 302 of `sprintTasks.ts`) and sets the task to active, bypassing the dependency system entirely. The actual unblock IPC is `sprint:unblockTask` which sets the status to queued.
- **Impact:** Clicking "Unblock" on a blocked task does not unblock it in the dependency sense — it forcefully launches it, ignoring unmet dependencies. This is dangerous because the agent may work on code that depends on incomplete upstream work.
- **Fix:** Wire the "Unblock" button to call `sprint:unblockTask` IPC instead of `launchTask`. Alternatively, rename the button to "Force Launch" with a confirmation dialog explaining that dependencies are unmet.

**SP-UX-005: `onMarkDone` callback is unused — parameter renamed to `_onMarkDone`**

- **File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:263`
- **Evidence:** The `ActionButtons` component receives `onMarkDone` but prefixes it with `_onMarkDone` (line 263). No status branch renders a "Mark Done" button. The prop is passed from `SprintPipeline.tsx:272` as `onMarkDone={handleMarkDone}`.
- **Impact:** Users cannot manually mark a task as done from the pipeline UI. The only way a task reaches "done" is through the agent completion handler or PR merge. For tasks that were completed manually (e.g., user did the work themselves), there is no UI affordance.
- **Fix:** Add a "Mark Done" button for `active` and `queued` tasks in the `ActionButtons` switch cases, or add it as a secondary action across all non-terminal statuses.

**SP-UX-006: SpecPanel does not show save success/failure feedback**

- **File:** `src/renderer/src/components/sprint/SpecPanel.tsx:15-17`
- **Evidence:** `handleSave` calls `onSave(draft)` and `setEditing(false)` synchronously. The `onSave` callback in `SprintPipeline.tsx:291` calls `handleSaveSpec(selectedTask.id, newSpec)` which calls `updateTask(taskId, { spec })`. If the update fails, the SpecPanel has already exited edit mode and shows the old spec (from the `spec` prop). The user sees the original content with no indication that their edit was lost.
- **Impact:** Silent data loss when spec save fails. User believes their edit was saved.
- **Fix:** Make `onSave` async, show a loading spinner during save, and only exit edit mode on success. On failure, stay in edit mode and show an error toast.

**SP-UX-007: DoneHistoryPanel items lack keyboard accessibility**

- **File:** `src/renderer/src/components/sprint/DoneHistoryPanel.tsx:19-23`
- **Evidence:** `done-history__item` elements use `onClick` but lack `role="button"`, `tabIndex={0}`, and `onKeyDown` handlers. Compare with `PipelineBacklog.tsx:33-38` which correctly includes `role="button"`, `tabIndex={0}`, and `onKeyDown` for Enter/Space.
- **Impact:** Done history items are not keyboard-navigable. Screen readers will not announce them as interactive elements.
- **Fix:** Add `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler for Enter/Space to each `done-history__item`.

**SP-UX-008: SpecPanel overlay has no keyboard dismiss (Escape key)**

- **File:** `src/renderer/src/components/sprint/SpecPanel.tsx:22-87`
- **Evidence:** The overlay has `onClick={onClose}` on the backdrop, but no `onKeyDown` handler for Escape. Neither the overlay nor the panel has `role="dialog"` or `aria-modal="true"`. Compare with `ConfirmModal` which handles Escape. In edit mode, pressing Escape does nothing — user must click Cancel or the X button.
- **Impact:** Keyboard users cannot dismiss the spec panel. Focus is not trapped inside the modal.
- **Fix:** Add Escape key handler, `role="dialog"`, `aria-modal="true"`, and focus trapping to SpecPanel.

**SP-UX-009: DoneHistoryPanel overlay has no keyboard dismiss (Escape key)**

- **File:** `src/renderer/src/components/sprint/DoneHistoryPanel.tsx:11`
- **Evidence:** Same pattern as SpecPanel — backdrop `onClick={onClose}` only. No Escape key handler, no `role="dialog"`, no `aria-modal`.
- **Impact:** Keyboard-only users cannot dismiss the done history panel.
- **Fix:** Add Escape key handler, `role="dialog"`, `aria-modal="true"` to DoneHistoryPanel.

**SP-UX-010: "Add to queue" performs optimistic status update with no validation feedback**

- **File:** `src/renderer/src/components/sprint/SprintPipeline.tsx:131-136`
- **Evidence:** `handleAddToQueue` calls `updateTask(task.id, { status: 'queued' })`. In `sprint-local.ts:98-148`, the `sprint:update` handler runs structural validation, semantic spec check, and dependency check when transitioning to queued. If any check fails, it throws an error. The `sprintTasks.ts` store catches this error (line 162) and shows `toast.error`. However, the optimistic update on line 139 has already moved the task from backlog to the queued stage visually. The `loadData()` revert (line 163) then refreshes the entire task list, causing the task to jump back to backlog.
- **Impact:** The task briefly appears in the "Queued" stage, then snaps back to backlog with only a toast error. The error message comes from the server and may be technical (e.g., "Cannot queue task -- spec quality checks failed: spec must have at least 2 ## headings"). No guidance on how to fix the issue.
- **Fix:** Pre-validate before the optimistic update (at least check for spec existence). Format the validation error messages to be user-friendly with specific guidance (e.g., "Add a spec with at least 2 sections before queuing").

**SP-UX-011: Drawer resize handle has no visual affordance and no ARIA**

- **File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:129`
- **Evidence:** `<div className="task-drawer__resize-handle" onMouseDown={handleResizeStart} />` — no `role`, no `aria-label`, no `tabIndex`, no cursor CSS verification (cursor is set programmatically during drag via `document.body.style.cursor` but not on the element itself on hover).
- **Impact:** The resize handle is invisible to screen readers and keyboard users. Sighted users may not discover it exists.
- **Fix:** Add `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize drawer"`, `tabIndex={0}`, and a CSS `cursor: col-resize` on the handle element. Support keyboard resizing with arrow keys.

### Moderate

**SP-UX-012: Loading state shows only text — no skeleton or spinner**

- **File:** `src/renderer/src/components/sprint/SprintPipeline.tsx:172-176`
- **Evidence:** `{loading && tasks.length === 0 && (<div className="pipeline-empty-state"><p className="pipeline-empty-state__title">Loading tasks...</p></div>)}` — plain text only, no spinner, no skeleton stages.
- **Impact:** On slow connections, the user sees a static "Loading tasks..." message with no visual indication of progress or activity. Other views (PR Station) use skeleton loaders.
- **Fix:** Add a spinner component or skeleton stages to the loading state.

**SP-UX-013: Failed task notes truncated to 40 chars with no way to see full text from backlog**

- **File:** `src/renderer/src/components/sprint/PipelineBacklog.tsx:79`
- **Evidence:** `{task.notes ? task.notes.slice(0, 40) : 'No details'}` — hard truncation at 40 characters, no ellipsis, no tooltip, no "show more" affordance.
- **Impact:** Error messages like "Fast-fail exhausted after 3 attempts" get cut to "Fast-fail exhausted after 3 attempts" (happens to fit) but longer messages are unreadable. Users must click the task and open the drawer to see full notes.
- **Fix:** Add CSS text-overflow ellipsis and a tooltip showing the full notes on hover. Or increase the truncation limit.

**SP-UX-014: TicketEditor uses `tokens.*` inline styles throughout (30+ style objects)**

- **File:** `src/renderer/src/components/sprint/TicketEditor.tsx:288-430`
- **Evidence:** The entire `styles` object (lines 288-430) uses `tokens.color.*`, `tokens.space.*`, `tokens.size.*`, `tokens.radius.*`, `tokens.font.*` for inline styles. This violates the CLAUDE.md convention: "Do NOT use inline `tokens.*` styles for neon views -- use CSS classes."
- **Impact:** These styles will not adapt to theme changes. They cannot be overridden by CSS without `!important`. Inconsistent with other sprint pipeline components that use CSS classes.
- **Fix:** Create a `ticket-editor-neon.css` file with BEM classes (`.ticket-*`) and replace all inline styles.

**SP-UX-015: TicketEditor "View Sprint Board" navigates to 'sprint' view — potentially dead view type**

- **File:** `src/renderer/src/components/sprint/TicketEditor.tsx:132`
- **Evidence:** `onClick={() => usePanelLayoutStore.getState().setView('sprint')}` — The view type `'sprint'` corresponds to the Task Pipeline view (the `View` union includes `'sprint'`). This works but the button text says "View Sprint Board" which could be confusing since the actual view is called "Task Pipeline" in the sidebar (per `VIEW_LABELS`).
- **Impact:** Minor naming inconsistency. User clicks "View Sprint Board" and lands on "Task Pipeline".
- **Fix:** Rename the button to "View Task Pipeline" to match the sidebar label.

**SP-UX-016: "Re-run" creates a new task — user may not realize original task remains**

- **File:** `src/renderer/src/hooks/useSprintTaskActions.ts:127-145`
- **Evidence:** `handleRerun` calls `window.api.sprint.create(...)` to create a brand new task with `status: TASK_STATUS.QUEUED`, using the original task's title, repo, prompt, spec, and priority. The original failed/done task remains in the list unchanged. The toast says "Task re-queued as new ticket" which is accurate but the "Re-run" button label implies the same task will be retried.
- **Impact:** Users may accumulate duplicate tasks without realizing it. The original task stays in the failed list.
- **Fix:** Either (a) rename the button to "Clone & Queue" to clarify behavior, or (b) add a "Delete original?" confirmation after re-run succeeds.

**SP-UX-017: ConflictDrawer error handling swallows fetch failures silently**

- **File:** `src/renderer/src/components/sprint/ConflictDrawer.tsx:64-69`
- **Evidence:** `.catch(() => { if (controller.signal.aborted) return; setBranchInfo(prev => ({ ...prev, [task.id]: { ...prev[task.id], loading: false } })) })` — On failure, loading stops but `files` stays as the empty array from the initial state (line 43). The UI then shows "Could not load file details." (line 196), which is the right behavior. However, there is no retry mechanism and no indication of what went wrong.
- **Impact:** If GitHub is unreachable, all conflict rows show "Could not load file details" with no way to retry.
- **Fix:** Add a "Retry" button next to "Could not load file details" that re-fetches the branch info.

**SP-UX-018: SpecPanel textarea uses inline styles instead of CSS classes**

- **File:** `src/renderer/src/components/sprint/SpecPanel.tsx:41-52`
- **Evidence:** The textarea has 9 inline style properties including `background`, `border`, `borderRadius`, `color`, `fontFamily`, `fontSize`, `padding`, `resize`, `outline`. These should be CSS classes per the neon styling convention.
- **Impact:** Cannot be themed. Inconsistent with the rest of the pipeline which uses CSS classes.
- **Fix:** Move textarea styles to `sprint-pipeline-neon.css` under a `.spec-panel__textarea` class.

### Minor

**SP-UX-019: PipelineBacklog empty state uses inline styles**

- **File:** `src/renderer/src/components/sprint/PipelineBacklog.tsx:57`
- **Evidence:** `<div style={{ fontSize: '10px', color: 'var(--neon-text-dim)', padding: '8px 0' }}>No backlog tasks</div>` — inline styles instead of a CSS class.
- **Impact:** Minor theming inconsistency.
- **Fix:** Create a `.pipeline-sidebar__empty` CSS class.

**SP-UX-020: DoneHistoryPanel empty state uses inline styles**

- **File:** `src/renderer/src/components/sprint/DoneHistoryPanel.tsx:34`
- **Evidence:** `<div style={{ padding: '16px', textAlign: 'center', color: 'var(--neon-text-dim)', fontSize: '11px' }}>No completed tasks yet</div>` — inline styles.
- **Impact:** Minor theming inconsistency.
- **Fix:** Create a `.done-history__empty` CSS class.

**SP-UX-021: TaskPill does not visually distinguish failed/error/cancelled statuses**

- **File:** `src/renderer/src/components/sprint/TaskPill.tsx:12-18`
- **Evidence:** `getStatusClass` returns `''` (empty string) for `failed`, `error`, and `cancelled` statuses. Similarly, `getDotColor` returns `var(--neon-cyan)` (the default) for these statuses. These tasks are shown in the "failed" partition of PipelineBacklog, not in PipelineStage, so TaskPill is typically not rendered for them. However, if the partition logic changes, failed task pills would look identical to queued ones.
- **Impact:** Low — failed tasks are currently shown in the backlog sidebar, not as pills. But the inconsistency with `getDotColor` in TaskDetailDrawer (which does handle failed/error/cancelled) creates a maintenance risk.
- **Fix:** Add `case 'failed': case 'error': case 'cancelled': return 'var(--neon-red)'` to TaskPill's `getDotColor` and add a `task-pill--failed` class to `getStatusClass` for completeness.

**SP-UX-022: `formatElapsed` and `getDotColor` duplicated between TaskPill and TaskDetailDrawer**

- **File:** `src/renderer/src/components/sprint/TaskPill.tsx:21-42`, `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:23-58`
- **Evidence:** Both files define `formatElapsed` (nearly identical) and `getDotColor` (TaskDetailDrawer handles more statuses). This was flagged in the synthesis report (section 3.4) as a cross-cutting theme.
- **Impact:** If elapsed formatting logic changes, both must be updated in sync.
- **Fix:** Extract both to `src/renderer/src/lib/task-format.ts` as recommended in the synthesis report.

**SP-UX-023: ConflictDrawer branchInfo state not cleared when tasks prop changes**

- **File:** `src/renderer/src/components/sprint/ConflictDrawer.tsx:76`
- **Evidence:** The `useEffect` dependency array for fetching branch info is `[open, tasks]`. The `branchInfo` state is cleared when the drawer closes (line 80-84) but not when the `tasks` array changes while the drawer is open. If a new conflicting task appears while the drawer is open, its fetch will run. But if a task is removed from the array, its stale `branchInfo` entry remains in state until the drawer is closed and reopened.
- **Impact:** Stale branch info could be shown for tasks that are no longer conflicting.
- **Fix:** Clean up `branchInfo` entries for tasks not in the current `tasks` array when `tasks` changes.

**SP-UX-024: HealthCheckDrawer "Rescue" resets to queued but does not clear `claimed_by`**

- **File:** `src/renderer/src/components/sprint/HealthCheckDrawer.tsx:27`
- **Evidence:** `await window.api.sprint.update(task.id, { status: TASK_STATUS.QUEUED, agent_run_id: null })` — sets status to queued and clears `agent_run_id`, but does not clear `claimed_by`. Per CLAUDE.md gotchas: "Must clear BOTH `status` AND `claimed_by` — if `claimed_by` stays set, the drain loop skips the task."
- **Impact:** Rescued tasks may remain invisible to the drain loop because `claimed_by` is still set. The task appears queued in the UI but never gets picked up by the agent manager.
- **Fix:** Add `claimed_by: null` to the update patch: `{ status: TASK_STATUS.QUEUED, agent_run_id: null, claimed_by: null }`.

---

## Summary Table

| ID        | Severity    | Component                   | Issue                                                   | Fix Effort |
| --------- | ----------- | --------------------------- | ------------------------------------------------------- | ---------- |
| SP-UX-001 | Critical    | SprintPipeline              | ConflictDrawer and HealthCheckDrawer unreachable        | M          |
| SP-UX-002 | Critical    | CircuitPipeline (sprint/)   | Dead code — never imported                              | S          |
| SP-UX-003 | Significant | PipelineBacklog + Drawer    | Dual launch paths from backlog (inline + drawer)        | S          |
| SP-UX-004 | Significant | TaskDetailDrawer            | "Unblock" button force-launches, bypassing dependencies | S          |
| SP-UX-005 | Significant | TaskDetailDrawer            | onMarkDone unused — no manual "Mark Done" button        | S          |
| SP-UX-006 | Significant | SpecPanel                   | No save success/failure feedback                        | S          |
| SP-UX-007 | Significant | DoneHistoryPanel            | Items lack keyboard accessibility                       | S          |
| SP-UX-008 | Significant | SpecPanel                   | No Escape key dismiss, no dialog role/aria              | S          |
| SP-UX-009 | Significant | DoneHistoryPanel            | No Escape key dismiss, no dialog role/aria              | S          |
| SP-UX-010 | Significant | SprintPipeline + store      | Queue validation failure causes visual snap-back        | M          |
| SP-UX-011 | Significant | TaskDetailDrawer            | Resize handle has no visual affordance or ARIA          | S          |
| SP-UX-012 | Moderate    | SprintPipeline              | Loading state is plain text — no spinner/skeleton       | S          |
| SP-UX-013 | Moderate    | PipelineBacklog             | Failed notes truncated to 40 chars, no tooltip          | S          |
| SP-UX-014 | Moderate    | TicketEditor                | 30+ inline `tokens.*` styles violating convention       | M          |
| SP-UX-015 | Moderate    | TicketEditor                | "View Sprint Board" label vs "Task Pipeline" name       | S          |
| SP-UX-016 | Moderate    | useSprintTaskActions        | "Re-run" creates duplicate — misleading label           | S          |
| SP-UX-017 | Moderate    | ConflictDrawer              | No retry on fetch failure                               | S          |
| SP-UX-018 | Moderate    | SpecPanel                   | Textarea uses inline styles                             | S          |
| SP-UX-019 | Minor       | PipelineBacklog             | Empty state inline styles                               | S          |
| SP-UX-020 | Minor       | DoneHistoryPanel            | Empty state inline styles                               | S          |
| SP-UX-021 | Minor       | TaskPill                    | No visual distinction for failed/error/cancelled        | S          |
| SP-UX-022 | Minor       | TaskPill + TaskDetailDrawer | formatElapsed/getDotColor duplicated                    | S          |
| SP-UX-023 | Minor       | ConflictDrawer              | Stale branchInfo when tasks change while open           | S          |
| SP-UX-024 | Minor       | HealthCheckDrawer           | Rescue does not clear `claimed_by` — task may get stuck | S          |

**Totals:** 2 Critical, 9 Significant, 7 Moderate, 6 Minor = **24 findings**

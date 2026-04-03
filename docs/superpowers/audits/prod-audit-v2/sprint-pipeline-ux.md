# Sprint Pipeline UX -- Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 10 source files in `src/renderer/src/components/sprint/`, plus `sprintTasks.ts`, `sprintUI.ts`, `sprint-local.ts`, `useSprintTaskActions.ts`, `lib/task-format.ts`
**Persona:** UX QA Engineer
**Baseline:** `docs/superpowers/audits/prod-audit/sprint-pipeline-ux.md` (24 findings)

---

## Remediation Status per Finding

### SP-UX-001 (Critical): ConflictDrawer and HealthCheckDrawer unreachable from pipeline UI

**Status: FIXED**

`SprintPipeline.tsx` now imports and renders both `<ConflictDrawer>` (line 356) and `<HealthCheckDrawer>` (line 362). The `setConflictDrawerOpen` is properly wired to the keyboard shortcuts hook (lines 124-130) instead of a no-op. `visibleStuckTasks` from `useHealthCheck()` is passed to HealthCheckDrawer (line 364). Both `conflictDrawerOpen` and `healthCheckDrawerOpen` are read from `useSprintUI` store (lines 53-54).

---

### SP-UX-002 (Critical): CircuitPipeline in sprint/ is dead code

**Status: FIXED**

`src/renderer/src/components/sprint/CircuitPipeline.tsx` no longer exists. Glob search returns no results. The neon-level `CircuitPipeline` component in `components/neon/` remains as the canonical version.

---

### SP-UX-003 (Significant): Dual launch paths from backlog (inline + drawer)

**Status: NOT FIXED**

`PipelineBacklog.tsx` still has inline "Add to queue" button (line 52) that calls `onAddToQueue`, while clicking the backlog card opens the drawer which shows a "Launch" button calling `onLaunch` (direct agent spawn). Two different behaviors remain accessible from the same context without clear distinction.

---

### SP-UX-004 (Significant): "Unblock" button force-launches, bypassing dependencies

**Status: FIXED**

`TaskDetailDrawer.tsx:336` now calls `onUnblock ? onUnblock(task) : onLaunch(task)` where `onUnblock` is wired to `handleUnblock` in `SprintPipeline.tsx:187-197`, which calls `window.api.sprint.unblockTask(task.id)`. The `sprint:unblockTask` handler in `sprint-local.ts:278-313` properly validates spec quality before setting status to `queued`. The button label remains "Unblock" which now correctly describes the action.

---

### SP-UX-005 (Significant): onMarkDone unused -- no manual "Mark Done" button

**Status: NOT FIXED**

`TaskDetailDrawer.tsx` no longer receives an `onMarkDone` prop at all -- it was removed from the interface (lines 10-21). The `ActionButtons` component still has no "Mark Done" button for any status. The `handleMarkDone` callback exists in `useSprintTaskActions.ts:88-99` but is never passed to the drawer. Users still cannot manually mark a task as done from the pipeline UI.

---

### SP-UX-006 (Significant): SpecPanel no save success/failure feedback

**Status: FIXED**

`SpecPanel.tsx:39-50` now has `handleSave` as an `async` function with `setSaving(true)`, a try/catch that calls `toast.success('Spec saved')` on success and `toast.error(...)` on failure, and only exits edit mode (`setEditing(false)`) inside the try block after successful save. A `saving` state disables the Save/Cancel buttons during the operation (lines 98, 108).

---

### SP-UX-007 (Significant): DoneHistoryPanel items lack keyboard accessibility

**Status: FIXED**

`DoneHistoryPanel.tsx:32-40` now has `role="button"`, `tabIndex={0}`, `aria-label={task.title}`, and an `onKeyDown` handler for Enter/Space on each `.done-history__item`.

---

### SP-UX-008 (Significant): SpecPanel no Escape key dismiss, no dialog role/aria

**Status: PARTIALLY FIXED**

`SpecPanel.tsx:24-37` now has an Escape key handler that exits edit mode (reverting draft) or closes the panel. However, the overlay still lacks `role="dialog"` and `aria-modal="true"` -- the `spec-panel-overlay` div (line 54) has only `onClick={onClose}`. Focus trapping is still not implemented.

---

### SP-UX-009 (Significant): DoneHistoryPanel no Escape key dismiss, no dialog role/aria

**Status: FIXED**

`DoneHistoryPanel.tsx:11-17` has an Escape key handler. The overlay div (line 20) now has `role="dialog"`, `aria-modal="true"`, and `aria-label="Completed Tasks"`.

---

### SP-UX-010 (Significant): Queue validation failure causes visual snap-back

**Status: NOT FIXED**

`SprintPipeline.tsx:163-173` calls `updateTask(task.id, { status: 'queued' })` which still performs an optimistic update in `sprintTasks.ts:130-133` before the IPC call. On failure, the store calls `loadData()` to revert (line 171), still causing the snap-back behavior. The error messages from `sprint-local.ts` remain technical (e.g., "Cannot queue task -- spec quality checks failed: spec must have at least 2 ## headings"). No pre-validation is done client-side.

---

### SP-UX-011 (Significant): Drawer resize handle has no visual affordance or ARIA

**Status: FIXED**

`TaskDetailDrawer.tsx:123-131` now has `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize drawer"`, `tabIndex={0}`, and `style={{ cursor: 'col-resize' }}` on the resize handle element. Keyboard resizing with arrow keys is still not implemented, but the discoverability and screen reader issues are resolved.

---

### SP-UX-012 (Moderate): Loading state shows only text -- no spinner/skeleton

**Status: FIXED**

`SprintPipeline.tsx:221-226` now renders `<Spinner size="md" />` (imported from `../ui/Spinner`, line 23) alongside the "Loading tasks..." text.

---

### SP-UX-013 (Moderate): Failed notes truncated to 40 chars, no tooltip

**Status: FIXED**

`PipelineBacklog.tsx:78` now uses `title={task.notes || 'No details'}` as a tooltip attribute, and CSS properties `textOverflow: 'ellipsis'`, `overflow: 'hidden'`, `whiteSpace: 'nowrap'` (inline styles) instead of the hard `.slice(0, 40)` truncation. The full notes text is shown on hover.

---

### SP-UX-014 (Moderate): TicketEditor uses 30+ inline `tokens.*` styles

**Status: NOT FIXED**

`TicketEditor.tsx:316-458` still contains the full `styles` object with 30+ inline style definitions using `tokens.*` values. No `ticket-editor-neon.css` file has been created. The component still violates the project's neon styling convention.

---

### SP-UX-015 (Moderate): "View Sprint Board" label vs "Task Pipeline" name

**STATUS: NOT FIXED**

`TicketEditor.tsx:161` still reads "View Sprint Board" while the sidebar labels this view as "Task Pipeline". The `setView('sprint')` call is correct, but the button text remains mismatched.

---

### SP-UX-016 (Moderate): "Re-run" creates duplicate -- misleading label

**STATUS: PARTIALLY FIXED**

In `TaskDetailDrawer.tsx`, the button label for done/failed/error/cancelled statuses has been changed to "Clone & Queue" (lines 397, 410), which accurately describes the behavior. However, `PipelineBacklog.tsx:89` still uses the label "Re-run" for the inline failed card action, which is inconsistent.

---

### SP-UX-017 (Moderate): ConflictDrawer no retry on fetch failure

**STATUS: FIXED**

`ConflictDrawer.tsx:199-208` now shows a "Retry" `<Button>` next to "Could not load file details." that calls `fetchBranchInfo(task.id, task)`. The `fetchBranchInfo` function (lines 29-65) is extracted as a `useCallback` and can be called for individual tasks.

---

### SP-UX-018 (Moderate): SpecPanel textarea uses inline styles

**STATUS: NOT FIXED**

`SpecPanel.tsx:72-84` still uses inline styles on the textarea (9 properties: width, height, background, border, borderRadius, color, fontFamily, fontSize, padding, resize, outline). No `.spec-panel__textarea` CSS class has been created.

---

### SP-UX-019 (Minor): PipelineBacklog empty state inline styles

**STATUS: NOT FIXED**

`PipelineBacklog.tsx:57` still uses `style={{ fontSize: '10px', color: 'var(--neon-text-dim)', padding: '8px 0' }}` inline.

---

### SP-UX-020 (Minor): DoneHistoryPanel empty state inline styles

**STATUS: NOT FIXED**

`DoneHistoryPanel.tsx:52` still uses `style={{ padding: '16px', textAlign: 'center', color: 'var(--neon-text-dim)', fontSize: '11px' }}` inline.

---

### SP-UX-021 (Minor): TaskPill no visual distinction for failed/error/cancelled

**STATUS: NOT FIXED**

`TaskPill.tsx:13-19` `getStatusClass` still returns `''` for failed, error, and cancelled statuses. No `task-pill--failed` class exists. `getDotColor` is now imported from `lib/task-format.ts` which does handle these statuses with `var(--neon-red)`, so the dot color is correct, but the pill itself has no visual class.

---

### SP-UX-022 (Minor): formatElapsed/getDotColor duplicated between TaskPill and TaskDetailDrawer

**STATUS: FIXED**

Both `TaskPill.tsx:5` and `TaskDetailDrawer.tsx:4` now import from `../../lib/task-format`. The shared `task-format.ts` at `src/renderer/src/lib/task-format.ts` contains both `formatElapsed` and `getDotColor` with proper handling of all statuses including failed/error/cancelled.

---

### SP-UX-023 (Minor): ConflictDrawer stale branchInfo when tasks change while open

**STATUS: PARTIALLY FIXED**

`ConflictDrawer.tsx:80-86` clears `branchInfo` when the drawer closes (`!open`), and the `fetchedRef` is cleared at the same time. However, the stale entry issue (task removed from array while drawer is open) is only partially addressed -- `fetchedRef.current` prevents re-fetches for known tasks but doesn't clean up entries for tasks that are no longer in the `tasks` prop.

---

### SP-UX-024 (Minor): HealthCheckDrawer Rescue does not clear `claimed_by`

**STATUS: FIXED**

`HealthCheckDrawer.tsx:27-31` now sends `{ status: TASK_STATUS.QUEUED, agent_run_id: null, claimed_by: null }` in the update call.

---

## New Issues Found

### SP-UX-025 (Minor): SpecPanel overlay still missing `role="dialog"` and `aria-modal`

- **File:** `src/renderer/src/components/sprint/SpecPanel.tsx:54`
- **Evidence:** The `spec-panel-overlay` div has no ARIA attributes. Compare with `DoneHistoryPanel.tsx:20` which was remediated to include `role="dialog" aria-modal="true" aria-label="..."`.
- **Impact:** Screen readers will not announce the spec panel as a modal dialog. Focus is not signaled as trapped.
- **Fix:** Add `role="dialog"`, `aria-modal="true"`, `aria-label="Task Spec"` to the overlay div.

### SP-UX-026 (Minor): PipelineBacklog failed card inline styles inconsistent with backlog cards

- **File:** `src/renderer/src/components/sprint/PipelineBacklog.tsx:78,87`
- **Evidence:** Failed card meta uses inline `style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}` and the re-run button uses `style={{ color: 'var(--neon-red)' }}`. These should be CSS classes for consistency.
- **Impact:** Minor theming inconsistency within the same component.
- **Fix:** Create `.failed-card__meta` and `.failed-card__action--rerun` CSS classes.

### SP-UX-027 (Minor): SprintPipeline body uses inline `display: 'none'` for empty state

- **File:** `src/renderer/src/components/sprint/SprintPipeline.tsx:249`
- **Evidence:** `style={{ display: tasks.length === 0 ? 'none' : undefined }}` -- inline style toggle for visibility. Should use a CSS class or conditional rendering.
- **Impact:** Minor. The element is still in the DOM when hidden, which could confuse screen readers.
- **Fix:** Use conditional rendering (`{tasks.length > 0 && <div className="sprint-pipeline__body">...`)

---

## Summary Table

| ID        | Original Severity | Status              | Notes                                                    |
| --------- | ----------------- | ------------------- | -------------------------------------------------------- |
| SP-UX-001 | Critical          | **Fixed**           | ConflictDrawer + HealthCheckDrawer fully wired           |
| SP-UX-002 | Critical          | **Fixed**           | Dead CircuitPipeline deleted                             |
| SP-UX-003 | Significant       | **Not Fixed**       | Dual launch paths still exist                            |
| SP-UX-004 | Significant       | **Fixed**           | Unblock now calls proper IPC with spec validation        |
| SP-UX-005 | Significant       | **Not Fixed**       | No Mark Done button; prop removed entirely               |
| SP-UX-006 | Significant       | **Fixed**           | Async save with toast feedback                           |
| SP-UX-007 | Significant       | **Fixed**           | Full keyboard accessibility added                        |
| SP-UX-008 | Significant       | **Partially Fixed** | Escape handler added; missing role/aria-modal/focus trap |
| SP-UX-009 | Significant       | **Fixed**           | Escape + role + aria-modal + aria-label                  |
| SP-UX-010 | Significant       | **Not Fixed**       | Optimistic snap-back + technical error messages          |
| SP-UX-011 | Significant       | **Fixed**           | ARIA + cursor on resize handle                           |
| SP-UX-012 | Moderate          | **Fixed**           | Spinner component added                                  |
| SP-UX-013 | Moderate          | **Fixed**           | CSS ellipsis + title tooltip                             |
| SP-UX-014 | Moderate          | **Not Fixed**       | 30+ inline tokens.\* styles remain                       |
| SP-UX-015 | Moderate          | **Not Fixed**       | "View Sprint Board" label still mismatched               |
| SP-UX-016 | Moderate          | **Partially Fixed** | Drawer says "Clone & Queue"; backlog still says "Re-run" |
| SP-UX-017 | Moderate          | **Fixed**           | Retry button added                                       |
| SP-UX-018 | Moderate          | **Not Fixed**       | SpecPanel textarea inline styles remain                  |
| SP-UX-019 | Minor             | **Not Fixed**       | PipelineBacklog empty state inline styles                |
| SP-UX-020 | Minor             | **Not Fixed**       | DoneHistoryPanel empty state inline styles               |
| SP-UX-021 | Minor             | **Not Fixed**       | TaskPill still no CSS class for failed statuses          |
| SP-UX-022 | Minor             | **Fixed**           | Extracted to shared task-format.ts                       |
| SP-UX-023 | Minor             | **Partially Fixed** | Clears on close, but stale entries possible while open   |
| SP-UX-024 | Minor             | **Fixed**           | claimed_by: null now included                            |

**New Issues:** SP-UX-025 (Minor), SP-UX-026 (Minor), SP-UX-027 (Minor)

---

## Overall Assessment

**12 of 24 findings Fixed, 3 Partially Fixed, 9 Not Fixed, 3 New Issues found.**

The critical findings (SP-UX-001, SP-UX-002) are fully resolved. The most impactful fixes include wiring the ConflictDrawer/HealthCheckDrawer, fixing the Unblock button to use proper IPC, adding save feedback to SpecPanel, extracting shared formatting utilities, and adding keyboard accessibility to DoneHistoryPanel.

The remaining work falls into two categories:

1. **Functional gaps (higher priority):** SP-UX-005 (no Mark Done button), SP-UX-010 (queue validation snap-back with technical errors), SP-UX-003 (confusing dual launch paths from backlog).

2. **Styling debt (lower priority):** SP-UX-014/018/019/020 (inline styles), SP-UX-015 (label mismatch), SP-UX-021 (TaskPill missing failed class). These are convention violations that affect maintainability and theming but not functionality.

The pipeline is in significantly better shape than the baseline audit. The critical path (stuck task discovery, conflict resolution, dependency-safe unblocking, spec save reliability) is now functional and accessible.

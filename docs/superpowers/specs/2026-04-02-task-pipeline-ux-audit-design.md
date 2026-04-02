# Task Pipeline UX Audit — Design Spec

## Overview

The Task Pipeline (Cmd+4) is BDE's operational monitoring view — where users watch tasks flow through Backlog → Queued → Blocked → Active → Review → Done. A 3-auditor review (Product Designer, UX Designer, Frontend Engineer) identified 42 findings across broken features, operational UX gaps, and design system drift.

A 10-task stress test confirmed the pipeline cannot run unattended: 83% push failure rate, every task required manual status intervention, and key features (conflict detection, dependency visualization) are either broken or invisible.

**Goal:** Transform the pipeline from a manually-babysit view into a genuinely autonomous monitoring dashboard.

## Audit Sources

- Product Designer: 23 findings (information architecture, lifecycle visibility, interactions)
- UX Designer: 26 findings (visual hierarchy, neon consistency, accessibility)
- Frontend Engineer: 23 findings (bugs, performance, state management, testing)
- Stress test: `docs/superpowers/audits/2026-04-02-pipeline-stress-test-pain-points.md`

## Phasing

Three phases, each producing a shippable improvement:

1. **Fix What's Broken** — repair dead features, remove dead code, fix data bugs
2. **Operational UX** — zombie detection, retry, dependency visibility, filters, keyboard nav
3. **Design System + Accessibility** — neon primitives, font sizes, focus indicators, ARIA, tests

---

## Phase 1: Fix What's Broken

12 findings. Goal: a pipeline where all existing features actually work.

### C1: ConflictDrawer filter uses invalid status values

**Bug:** `SprintPipeline.tsx:137` filters with `['awaiting-review', 'in-progress'].includes(t.status)`. These are UI partition labels, not DB statuses (`active`, `done`, `queued`, etc.). The filter always returns an empty array — ConflictDrawer never shows any conflicts.

**Fix:** Change the filter to use actual DB statuses + PR mergeable state:
```ts
const conflictingTasks = useMemo(
  () => tasks.filter(
    (t) => t.pr_url && t.pr_mergeable_state === 'dirty' &&
           (t.status === 'active' || t.status === 'done')
  ),
  [tasks]
)
```

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

### C2: `createTask` drops `depends_on` from IPC call

**Bug:** `sprintTasks.ts` `createTask()` accepts `depends_on` in the input but never passes it to `window.api.sprint.create()`. Dependencies are silently lost.

**Fix:** Add `depends_on` to the IPC payload:
```ts
const created = await window.api.sprint.create({
  title: data.title,
  repo: data.repo,
  // ... existing fields
  depends_on: data.depends_on || undefined
})
```
Also set the optimistic task's `depends_on` to `data.depends_on ?? null` instead of hardcoded `null`.

**Files:** `src/renderer/src/stores/sprintTasks.ts`

### C5: No entry points for ConflictDrawer / HealthCheckDrawer

**Problem:** Both drawers exist but have no visible buttons, badges, or indicators in the pipeline UI. HealthCheckDrawer only auto-opens when stuck tasks are detected. ConflictDrawer has no trigger at all.

**Fix:** Add indicator badges in the pipeline header:
- Heart-pulse icon + count for stuck tasks (from HealthCheck detection)
- Git-merge icon + count for conflicting PRs (from conflict filter)
- Clicking opens the respective drawer
- Badges only appear when count > 0 (zero = hidden, not "0")
- Use neon accent colors: orange for health, red for conflicts

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### H10: SSE merge ignores pending updates

**Bug:** `sprintTasks.ts` `mergeSseUpdate()` directly overwrites task fields without checking the `pendingUpdates` TTL map. If a user makes an optimistic update and an SSE event arrives within 2 seconds, the user sees their change briefly revert.

**Fix:** Apply the same pending-field protection from `loadData()` inside `mergeSseUpdate()`:
```ts
mergeSseUpdate: (update) => {
  set((s) => {
    const pending = s.pendingUpdates[update.taskId]
    return {
      tasks: s.tasks.map((t) => {
        if (t.id !== update.taskId) return t
        const merged = { ...t, ...update }
        if (pending && Date.now() - pending.ts <= PENDING_UPDATE_TTL) {
          for (const field of pending.fields) {
            (merged as any)[field] = (t as any)[field]
          }
        }
        return merged
      })
    }
  })
}
```

**Files:** `src/renderer/src/stores/sprintTasks.ts`

### M4: Dead arrival animation

**Problem:** CSS `@keyframes task-arrive` and `.task-pill--arriving` exist but the class is never applied in `TaskPill.tsx`.

**Fix:** Track when a task first appears in a new stage (compare current stage to a ref of previous stage). Apply `task-pill--arriving` class for 500ms on stage transition. Use a `useEffect` with a timeout to remove it.

**Files:** `src/renderer/src/components/sprint/TaskPill.tsx`

### L3: Dead drag-and-drop callbacks

**Decision:** Remove `handleDragEnd` and `handleReorder` from `useSprintTaskActions.ts`. DnD between pipeline stages is not a current priority and the callbacks add confusion.

**Files:** `src/renderer/src/hooks/useSprintTaskActions.ts`

### L3b: Dead multi-select state (cleanup only)

**Problem:** `sprintUI.ts` has `selectedTaskIds`, `toggleTaskSelection`, `selectRange`, `clearSelection` with no UI consumers.

**Decision:** Leave the store state in place (it's not harmful). The UI wiring moves to Phase 2 (M5).

**Files:** No changes — deferred to Phase 2.

### L5: Wrong shortcut in empty state

**Bug:** Empty state says "Open Task Workbench (Cmd+0)" but the actual shortcut is `N`.

**Fix:** Change to "Press N to create your first task" or add a clickable button that dispatches `bde:open-task-workbench`.

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

### M9: No error boundary

**Problem:** A malformed task crashes the entire pipeline view with a white screen.

**Fix:** Wrap the pipeline body content in a React error boundary with a fallback that shows "Something went wrong" + "Retry" button. At minimum, wrap `TaskDetailDrawer` and the stage rendering independently so a single bad task doesn't take down the whole view.

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

### M10: Polling selector subscribes to full tasks array

**Problem:** `useSprintPolling` selects `s.tasks` just to derive `hasActiveTasks`. Every task mutation triggers re-evaluation.

**Fix:** Use a derived boolean selector:
```ts
const hasActiveTasks = useSprintTasks((s) => s.tasks.some(t => t.status === 'active'))
```

**Files:** `src/renderer/src/hooks/useSprintPolling.ts`

### M11: TaskDetailDrawer re-renders on any task change

**Problem:** Subscribes to `s.tasks` for dependency stats even when unrelated tasks change.

**Fix:** Extract dependency computation into a memoized selector that only triggers when dependency task statuses change:
```ts
const depIds = useMemo(() => task.depends_on?.map(d => d.id) ?? [], [task.depends_on])
const depsDone = useSprintTasks(
  useCallback((s) => s.tasks.filter(t => depIds.includes(t.id) && t.status === 'done').length, [depIds])
)
```

**Files:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`

### L1: Drawer doesn't toggle on re-click

**Fix:** In `sprintUI.ts` `setSelectedTaskId`, if `id === state.selectedTaskId`, set `selectedTaskId: null, drawerOpen: false` (toggle behavior).

**Files:** `src/renderer/src/stores/sprintUI.ts`

### L2: Escape key inconsistency

**Fix:** Update `useSprintKeyboardShortcuts` Escape handler to progressively close layers:
1. If spec panel open → let it handle
2. If drawer open → close drawer, deselect task
3. If neither → close log/conflict/health drawers

**Files:** `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`

---

## Phase 2: Operational UX

14 findings. Goal: a pipeline that can run unattended with clear status visibility.

### C3: Zombie task indicator

**Problem:** Tasks where agents finished + PR opened but status stuck at `active` look identical to actively running tasks. This was the #1 stress test issue.

**Design:** Add a visual indicator on TaskPill for zombie states:
- If task is `active` AND has `pr_url` or `pr_status` set → show a warning badge (amber clock icon) and change pill border to amber
- If task is `active` AND elapsed time > `max_runtime_ms` (or default 60min) → show stale indicator (red clock icon)
- Add CSS class `.task-pill--zombie` with amber border and pulsing warning icon
- Tooltip: "Agent finished but task not marked done — click to resolve"
- Clicking the warning badge could offer: "Mark Done" / "Retry" / "View PR"

**Files:** `src/renderer/src/components/sprint/TaskPill.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### C4: Retry action for errored tasks

**Design:** Add a "Retry" button to `ActionButtons` for `failed`/`error` status tasks. This is distinct from "Clone & Queue" — it resets the SAME task:
- Resets: `status=queued, claimed_by=null, notes=null, started_at=null, completed_at=null, fast_fail_count=0, agent_run_id=null`
- Requires a new IPC endpoint `sprint:retry` that atomically resets all fields + cleans up stale worktree/branch
- Show confirm dialog: "Retry this task? Previous agent work and logs will be cleared."
- Button styling: cyan accent (like "Queue"), with a refresh icon

**Files:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`, `src/main/handlers/sprint-local.ts` (new IPC), `src/renderer/src/hooks/useSprintTaskActions.ts`

### H7: "Awaiting Review" bucket visibility

**Fix:** Add a subtitle or tooltip under the "Review" stage label: "PRs awaiting merge". When showing task count, distinguish: "3 PRs open". Consider a small PR icon next to the stage label.

**Files:** `src/renderer/src/components/sprint/PipelineStage.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### H8: Dependency chain visibility

**Design:** Make the dependency line in TaskDetailDrawer interactive:
- Instead of "2 deps — 1/2 complete", show a list:
  - "→ Task A (done ✓)" — clickable, navigates to that task
  - "→ Task B (active ⟳)" — clickable, shows why this task is blocked
- For blocked tasks, add a prominent "Blocked by:" section at the top of the drawer with the blocking task names
- Use accent colors: done deps = cyan, active deps = purple, blocked deps = orange

**Files:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### H9: Failure mode visibility on pills

**Design:** Add a failure-mode badge or icon to failed TaskPills:
- Push failed (branch exists, no PR): git-branch icon + "push failed" tooltip
- Agent failed (no branch): x-circle icon + "agent failed" tooltip
- Fast-fail exhausted (3 quick failures): zap icon + "fast-fail" tooltip
- Cancelled: slash icon

Determine mode from: `pr_status`, `pr_url`, `fast_fail_count`, `notes` content.

**Files:** `src/renderer/src/components/sprint/TaskPill.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### H11: Filter/search UI

**Design:** Add a filter bar below the pipeline header:
- Text search input (filters by task title, case-insensitive)
- Repo filter chips (like PR Station): "All" + one chip per repo
- Status filter chips: "All" / "Active" / "Blocked" / "Failed" (quick-filter to a stage)
- The store state already exists (`repoFilter`, `searchQuery`, `statusFilter`) — just needs UI
- CSS: `.pipeline-filter-bar` with neon styling, repo chips styled like `.agent-list__repo-chip`

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### H12: Header stats expansion

**Fix:** Add blocked, failed, and review counts to the header alongside existing active/queued/done:
- Blocked: orange accent
- Failed: red accent
- Review: blue accent
- Make each stat clickable → sets the status filter to that bucket
- Consider using `StatCounter` neon primitives for consistency with Dashboard

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### M1: Resizable sidebar

**Fix:** Same pattern as Agents view: add CSS `resize: horizontal` with `min-width: 180px`, `max-width: 400px`. Replace inline width with `.pipeline-sidebar` class update.

**Files:** `src/renderer/src/assets/sprint-pipeline-neon.css`

### M2: Cost/duration on completed tasks

**Design:** Show total duration and cost on completed task pills and in the detail drawer:
- TaskPill (done): show "23m / $1.40" badge below title
- TaskDetailDrawer: add Duration and Cost fields for completed tasks
- Data source: `started_at` → `completed_at` for duration, `cost_events` table for cost (may need new IPC to aggregate)

**Files:** `src/renderer/src/components/sprint/TaskPill.tsx`, `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`

### M3: Progress indicator for active tasks

**Design:** Add a subtle activity indicator to active TaskPills:
- Show "last event: 30s ago" or a mini pulsing dot that dims when no recent events
- Source: agent events store (already available), check timestamp of latest event for this task's `agent_run_id`
- If no events in 5+ minutes: dim the dot and show "idle" label

**Files:** `src/renderer/src/components/sprint/TaskPill.tsx`

### M6: Keyboard shortcuts

**Design:** Add to `useSprintKeyboardShortcuts`:
- Arrow Up/Down: navigate between tasks within current stage
- Arrow Left/Right: move selection between stages
- `R`: retry selected task (if failed/error)
- `L`: launch selected task (if backlog/queued)
- `D`: delete selected task (with confirm)
- `?`: toggle shortcuts help overlay
- Enter: open detail drawer for selected task

**Files:** `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`, `src/renderer/src/components/sprint/SprintPipeline.tsx`

### M7: Spec panel markdown rendering

**Fix:** Use a markdown renderer in SpecPanel read mode. The app likely has markdown-capable rendering already (PR Station shows PR descriptions). Keep raw textarea for edit mode.

**Files:** `src/renderer/src/components/sprint/SpecPanel.tsx`

### L6: Done stage truncation

**Fix:** Replace the 5-pill display with a compact summary: "42 completed (5 today)" as a clickable link to DoneHistoryPanel. Or make the done count badge clickable to open the history panel directly.

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

### M5: Multi-select with bulk actions

**Problem:** Store state exists (`selectedTaskIds`, `toggleTaskSelection`, `selectRange`, `clearSelection`) but no UI wires it up. The stress test showed frequent need for bulk intervention on errored tasks.

**Design:** Wire up multi-select:
- Shift+Click for range select, Cmd+Click for toggle
- Bulk action bar appears when 2+ tasks selected (floats at bottom of pipeline center)
- Actions: Bulk Re-queue, Bulk Cancel, Bulk Delete
- Clear selection button
- Selection count badge

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`, `src/renderer/src/components/sprint/TaskPill.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

---

## Phase 3: Design System + Accessibility

16 findings. Goal: pipeline matches Dashboard/Agents quality bar.

### H1: Font size minimums

**Fix:** Bump all 8-9px instances to 10px minimum:
- `.pipeline-sidebar__label`: 9px → 10px
- `.pipeline-sidebar__count`: 9px → 10px
- `.backlog-card__meta`: 9px → 10px
- `.backlog-card__action`: 9px → 11px
- `.pipeline-sidebar__expand`: 9px → 10px
- `.pipeline-stage__count`: 9px → 10px
- `.pipeline-stage__dot` text: 9px → 10px
- `.task-pill__badge`: 8px → 10px
- `.task-pill__time`: 9px → 10px

**Files:** `src/renderer/src/assets/sprint-pipeline-neon.css`

### H2: Inline styles → CSS classes

**Fix:** Extract all inline `style={{}}` props to CSS classes in `sprint-pipeline-neon.css`:
- `PipelineBacklog.tsx`: 5 inline style blocks → `.pipeline-sidebar__label--backlog`, `.pipeline-sidebar__label--failed`, `.pipeline-sidebar__empty`, `.failed-card__meta`, `.failed-card__action`
- `TaskPill.tsx`: badge colors → `.task-pill__badge--{repo}`
- `DoneHistoryPanel.tsx`: 3 inline style blocks → `.done-history__badge`, `.done-history__empty`
- `SpecPanel.tsx`: textarea + pre → `.spec-panel__textarea`, `.spec-panel__pre`
- `TaskDetailDrawer.tsx`: PR link margin → `.task-drawer__pr-link`
- `SprintPipeline.tsx`: error hint margin → `.sprint-pipeline__error-hint`

**Files:** All pipeline components + `sprint-pipeline-neon.css`

### H3: Migrate drawer CSS to neon tokens

**Fix:** Move ConflictDrawer and HealthCheckDrawer styles from `sprint.css` (legacy `--glass-*` tokens) to `sprint-pipeline-neon.css` (neon `--neon-*` tokens):
- `--glass-tint-dark` → `var(--neon-surface-deep)`
- `--glass-tint-mid` → `var(--neon-purple-surface)`
- `--glass-blur-lg` → `var(--neon-glass-blur)`
- `--bde-text` → `var(--neon-text)`
- `--bde-text-muted` → `var(--neon-text-muted)`
- `--bde-danger-gradient` → `var(--neon-red-surface)` + border
- `--bde-warning-gradient` → `var(--neon-orange-surface)` + border

**Files:** `src/renderer/src/assets/sprint.css` (remove), `src/renderer/src/assets/sprint-pipeline-neon.css` (add)

### H4: Adopt neon primitives

**Fix:** Replace bespoke elements with neon primitives:
- Header stats → `StatCounter` components (or `StatusBar` wrapper)
- Stage cards → wrap in `NeonCard` where appropriate
- Header → consider `StatusBar` primitive

This is the single highest-impact change for visual consistency across views.

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

### H5: Focus indicators

**Fix:** Add `:focus-visible` rules to `sprint-pipeline-neon.css` for all interactive elements:
```css
.task-pill:focus-visible,
.backlog-card:focus-visible,
.failed-card:focus-visible,
.task-drawer__btn:focus-visible,
.backlog-card__action:focus-visible {
  box-shadow: 0 0 0 2px var(--neon-cyan);
  outline: none;
}
```

**Files:** `src/renderer/src/assets/sprint-pipeline-neon.css`

### H6: Focus trapping in modals

**Fix:** Add focus trapping to SpecPanel and DoneHistoryPanel. Auto-focus the close button on open. Trap Tab between first and last focusable elements within the modal.

**Files:** `src/renderer/src/components/sprint/SpecPanel.tsx`, `src/renderer/src/components/sprint/DoneHistoryPanel.tsx`

### M8: Reduced-motion gaps

**Fix:** Import `useReducedMotion()` in SpecPanel. Add `@media (prefers-reduced-motion: reduce)` rules for ConflictDrawer and HealthCheckDrawer slide transitions.

**Files:** `src/renderer/src/components/sprint/SpecPanel.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### M12: ARIA semantics

**Fix:**
- Conflict rows: add `role="button"`, `tabIndex={0}`, `aria-expanded`, `onKeyDown` for Enter/Space
- Pipeline stages: add `role="region"`, `aria-label={stageName}`
- Pipeline center: `role="region"`, `aria-label="Pipeline stages"`
- Done history list: `role="list"` on container, `role="listitem"` on items

**Files:** `ConflictDrawer.tsx`, `PipelineStage.tsx`, `DoneHistoryPanel.tsx`

### M13: Loading skeleton

**Fix:** Show sidebar + stage headers in dim/disabled state during loading, with spinner overlaid. This gives structural context while data loads.

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`, `src/renderer/src/assets/sprint-pipeline-neon.css`

### M14 + C6: Missing tests

**Fix:** Create test files for:
- `src/renderer/src/stores/__tests__/sprintTasks.test.ts` — optimistic updates, SSE merge, pending-field TTL, `createTask` with deps, WIP limits
- `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts` — pure function, every status mapping, `awaitingReview` override, done sorting
- `src/renderer/src/hooks/__tests__/useSprintPolling.test.ts` — adaptive interval, SSE refresh
- `src/renderer/src/hooks/__tests__/useSprintTaskActions.test.ts` — WIP limit, confirm flow, error handling

**Files:** New test files as listed

### L4: Done pills opacity

**Fix:** Change `.task-pill--done` from `opacity: 0.5` to `opacity: 0.7`. Or keep full opacity and use `color: var(--neon-text-dim)` on the title only.

**Files:** `src/renderer/src/assets/sprint-pipeline-neon.css`

### L7: Page entrance animation

**Fix:** Wrap pipeline root in `motion.div` with `VARIANTS.fadeIn`, gated by `useReducedMotion()`.

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

### L8: Empty state onboarding card

**Fix:** Replace bare centered text with a `NeonCard` containing an icon, brief explanation, and a "Create Task" button.

**Files:** `src/renderer/src/components/sprint/SprintPipeline.tsx`

### L9: Status color mismatch

**Fix:** Add `review` case to `getDotColor()` returning `var(--neon-blue)`.

**Files:** `src/renderer/src/lib/task-format.ts`

### L10: Resize handle keyboard support

**Fix:** Add `onKeyDown` to resize handle: Left/Right arrow adjusts width ±10px, Shift+arrow ±50px.

**Files:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`

---

## Summary

| Phase | Findings | Focus |
|-------|----------|-------|
| 1 | 12 | Fix broken features, remove dead code, data correctness |
| 2 | 14 | Operational UX for unattended pipeline monitoring |
| 3 | 16 | Design system alignment, accessibility, tests |

**Key new IPC needed:** `sprint:retry` (Phase 2, C4) — atomic task reset with worktree cleanup.

**Key architectural decisions:**
- Wire up multi-select with bulk actions (M5) rather than removing dead code
- Remove dead DnD callbacks (L3) since DnD is not a priority
- Use neon primitives in header (H4) for cross-view consistency

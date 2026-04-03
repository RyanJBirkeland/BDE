# Team 2 — Sprint & Task Management Audit

## Executive Summary

The Sprint & Task Management layer is the most feature-rich surface in BDE, spanning 15+ components, 3 Zustand stores, and a 2,046-line CSS file (`sprint.css`). It has solid bones — DnD kanban, real-time agent monitoring, spec editing, readiness checks — but the visual treatment is stuck in "functional IDE" mode with `border-radius: 4px` cards, flat surfaces, no ambient glow, and minimal micro-interactions. The feast-site aesthetic is absent here.

Key themes:

1. **sprint.css is bloated** — ~400 lines of dead/duplicated code (design-mode, duplicate `.spec-drawer__prompt-*` rules, unused PR-confirm). Needs pruning before feast-site treatment.
2. **TaskCard is the most-seen component but feels flat** — no glassmorphism, no hover lift, no ambient glow. The card's `border-radius: 4px` is 5x smaller than feast-site's 20px target.
3. **TaskMonitorPanel and EventCard use inline styles** — 200+ lines of `style={{...}}` that should be CSS classes, blocking theme consistency and making the feast-site migration harder.
4. **TaskWorkbench components are 100% inline styles** — WorkbenchForm, WorkbenchCopilot, WorkbenchActions, ReadinessChecks all use `tokens.color.*` inline. These need CSS classes for the redesign.
5. **Two overlapping output viewers** — LogDrawer (bottom sheet) and TaskMonitorPanel (side panel) coexist in SprintCenter. LogDrawer is always rendered but often hidden behind TaskMonitorPanel.

---

## UX Designer Findings

### KanbanBoard & Columns

**Current state:** 3-column grid with `gap: 16px`, columns use `background: var(--glass-tint-dark)` and `border-radius: var(--bde-radius-md)` (6px). Column headers are uppercase 11px text in a `var(--glass-tint-mid)` band.

**Issues:**

- **Border radius too tight.** Columns at 6px feel utilitarian. Feast-site cards use 20px. Recommend `border-radius: var(--bde-radius-xl)` (target 20px) for columns, 16px for cards.
- **No ambient glow on columns.** Active column should have a subtle `radial-gradient(circle, rgba(0,211,127,0.06) 0%, transparent 70%)` behind it to signal "this is where action is."
- **Drop target feedback is minimal.** `.kanban-col--drop-target` only changes border-color and background. Should add `box-shadow: 0 0 20px rgba(0,211,127,0.12)` and scale the column slightly (`transform: scale(1.005)`).
- **Column header lacks visual weight.** The uppercase text is fine but the count badge (`bde-count-badge`) is 10px with 1px border — too small. Bump to 11px, use `background: var(--bde-accent-dim)` for the active column.
- **Empty state is plain.** The `kanban-col__empty` + `kanban-col__drop-hint` uses a dashed border which feels dated. Replace with a subtle dotted outline inside a rounded box with `opacity: 0.5` text.
- **No stagger animation on column load.** Cards enter with `bde-slide-up-fade` (good) but columns themselves pop in simultaneously. Add stagger: `animation-delay: calc(var(--col-index) * 60ms)`.

**Specific CSS changes for `.kanban-col`:**

```css
/* FROM */
.kanban-col {
  border-radius: var(--bde-radius-md); /* 6px */
  background: var(--glass-tint-dark);
  border: 1px solid var(--bde-border);
}

/* TO */
.kanban-col {
  border-radius: var(--bde-radius-xl); /* 20px */
  background: rgba(5, 5, 7, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--bde-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}
```

### TaskCard

**Current state:** Cards use `border-radius: var(--bde-radius-sm)` (4px), `background: var(--glass-tint-dark)`, with a subtle inset top shadow. High-priority cards get a 2px left border in danger color. Dragging cards get `scale(1.02)` and `box-shadow: var(--bde-shadow-md)`.

**Issues:**

- **4px border-radius is the #1 aesthetic gap.** This is the most visible element in the Sprint view. Needs `border-radius: 16px` minimum.
- **No hover state.** Cards have zero hover feedback — no border brighten, no lift, no glow. This is a core feast-site pattern missing.
- **Drag overlay lacks depth.** The DragOverlay renders a `TaskCard` with no extra styling. It should get `box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 4px 16px rgba(0,211,127,0.08)` and `transform: rotate(2deg) scale(1.04)`.
- **Badge cluster is dense.** Priority badge, repo badge, spec dot, PR badge, conflict badge, blocked badge — up to 6 badges on one card. The `gap: 6px` flex-wrap works but visually the card becomes a badge soup. Consider grouping: left = status badges, right = meta badges.
- **The spec dot uses raw emoji** (`📄`). Replace with a lucide icon (`FileText`) for consistency.
- **"Writing spec..." badge** uses `opacity: 0.7` pulsing between 0.3-0.7. Should use the accent color with a shimmer animation instead of opacity fade.
- **Dependency chips** (`task-card__dep-chip`) use `var(--color-surface)` and `var(--color-border)` — these are legacy CSS variable names that may not resolve in the new token system. They should use `var(--bde-surface)` and `var(--bde-border)`.

**Specific CSS changes for `.task-card`:**

```css
/* FROM */
.task-card {
  background: var(--glass-tint-dark);
  border: 1px solid var(--bde-border);
  border-radius: var(--bde-radius-sm); /* 4px */
  padding: 10px 12px;
  box-shadow: inset 0 1px 0 var(--bde-hover-subtle);
}

/* TO */
.task-card {
  background: rgba(17, 17, 24, 0.75);
  border: 1px solid var(--bde-border);
  border-radius: 16px;
  padding: 14px 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.task-card:hover {
  border-color: var(--bde-border-hover);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.3),
    0 0 8px rgba(0, 211, 127, 0.05);
  transform: translateY(-1px);
}

.task-card:active {
  transform: scale(0.97);
}
```

### TaskTable

**Current state:** Collapsible sections with standard HTML table layout. Rows have `padding: 9px 8px`, hover highlights the row via `background: var(--glass-tint-dark)`. Priority dot is an 8px circle. Action buttons appear on hover (done button has `opacity: 0` -> `1` transition).

**Issues:**

- **Table borders feel old-school.** `border-bottom: 1px solid color-mix(...)` on every cell is dense. Consider removing row separators and using alternating row subtle tints or simply hover-highlight only.
- **Section headers need feast-site treatment.** The collapsible headers (`bde-task-section__header`) are functional but flat. Add a subtle gradient underline like the column headers.
- **"Show more" button** at bottom is unstyled text. Should be a ghost button with `border-radius: 12px` and hover glow.
- **Title truncation at `max-width: 300px`** is fixed. Should be `100%` of its column width with `text-overflow: ellipsis`.
- **Action buttons cluster** (`bde-task-table__actions-cell`) lacks visual hierarchy. "Sprint" and "Retry" are accent-colored but same size as other actions.
- **No sort indicators** on table headers. The `th` elements have no visual affordance indicating they're sortable (they aren't yet, but they should be).

### TaskMonitorPanel

**Current state:** Entire component is inline `style={{...}}` using design tokens. Fixed 3-section layout: header (title + badge + close), agent status line, scrollable body with EventCards, footer with action buttons.

**Issues:**

- **All inline styles block theming.** ~100 lines of inline CSS. These should be extracted to `.task-monitor` classes in sprint.css.
- **No glassmorphism.** The panel uses `background: tokens.color.surface` (flat `#141414`). Should use glass-surface treatment since it overlays the kanban.
- **Footer actions are cramped.** Stop, Re-run, Open in Agents, Copy Log, Close — 5 buttons in a 40px-height footer. Needs breathing room: `padding: 10px 16px` with `flex-wrap: wrap`.
- **The scrollable body has no fade-out** at top/bottom to indicate more content. Add CSS mask: `mask-image: linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)`.

### Drawers (Log, Spec)

**SpecDrawer:**

- **Width is hardcoded to 420px.** Should be `min(480px, 40vw)` for larger monitors.
- **Glassmorphism is present** (`backdrop-filter: var(--glass-blur-lg)`) — good, but border-radius is 0 (rectangular slab). Add `border-radius: 20px 0 0 20px` for the left edge.
- **Title input is almost invisible.** The transparent background + transparent bottom border is hard to discover. Add a subtle `background: var(--glass-tint-dark)` on focus and `border-radius: 8px`.
- **Delete button uses `!important`** twice — code smell indicating specificity war. Fix selector specificity instead.

**LogDrawer:**

- **Positioned as bottom sheet** (`position: absolute; bottom: 0; height: 50vh`). This is hidden when TaskMonitorPanel is showing (which is the main output viewer now). The LogDrawer appears to be legacy — consider removing it entirely in favor of TaskMonitorPanel.
- **Border-radius `12px 12px 0 0`** on the drawer is good but inconsistent with the 20px target.
- **Agent steer input** (`.agent-steer-input`) is a nice feature but has no CSS definition in sprint.css — it may be styled elsewhere or unstyled.

### NewTicketModal

**Current state:** Uses `.glass-modal.elevation-3` classes (feast-site treatment partially applied). Has Quick/Template tab modes. Template chips use 12px border-radius. Spec editor is a plain textarea.

**Issues:**

- **Quick mode feels empty.** Just title + repo + template dropdown + a hint. The large modal frame around 3 inputs feels wasteful. Consider making Quick mode a compact inline form instead.
- **Template chips** at 12px radius are close to feast-site but should be `border-radius: var(--bde-radius-full)` (pill shape) for the toggle-chip pattern.
- **Spec textarea** (`new-ticket-modal__spec-editor`) uses `border-radius: var(--bde-radius-sm)` (4px). Should be 12px to match the modal's aesthetic.
- **Footer alignment** is `justify-content: flex-end` which leaves dead space on the left. Consider centering or adding a "keyboard shortcut hint" on the left.
- **Mode tabs** are functional but underwhelming. The active indicator is a 2px bottom border. Consider a pill-shaped active background like feast-site toggle buttons.
- **The `glass-modal` class is already applied** — this modal is ahead of other sprint components in feast-site adoption.

### SprintToolbar

**Current state:** Horizontal bar with aurora gradient title, repo filter chips, alert badges (stuck/conflict), shortcut hint kbd, New Ticket button, refresh icon.

**Issues:**

- **Shortcut hint** (`sprint-center__shortcut-hint`) uses fallback `var(--color-text-tertiary, #666)` and `var(--color-surface-raised, var(--bde-glass-bg))` — legacy variable names. Migrate to `var(--bde-text-dim)` and `var(--bde-surface-high)`.
- **Repo chips** have `border-radius: 12px` — should be pill (`border-radius: 9999px`) for the feast-site chip pattern.
- **No active:scale(0.97)** on the repo chip buttons. Missing the micro-interaction pattern.
- **Conflict/stuck badges** are wrapped in unstyled `button.conflict-badge-btn`. Add hover states and `active:scale(0.97)`.
- **Header divider** uses `var(--bde-header-gradient)` — good, feast-site aligned.

### TaskWorkbench

**Current state:** Full-view form with AI Copilot side panel. Uses `react-resizable-panels` for form/copilot split. 100% inline styles.

**Issues:**

- **Entirely inline-styled.** WorkbenchForm, WorkbenchActions, WorkbenchCopilot, ReadinessChecks — no CSS classes at all. This makes feast-site migration require touching every component file.
- **Copilot toggle button** is inline-styled with `tokens.color.accentDim` background. Should be a `.btn-cta` class for feast-site glow.
- **Readiness checks UI** uses emoji status icons (checkmark, hourglass, x). Replace with lucide icons for consistency with the rest of the app.
- **WorkbenchActions buttons** are inline-styled with manual disabled state management. Extract to `.workbench-action` CSS classes.
- **The form page title** ("New Task" / "Edit: ...") is `tokens.size.xl` (16px) — too small for a page-level heading. Should be `tokens.size.xxl` (20px) with the aurora gradient.

---

## Product Manager Findings

### Task Lifecycle Workflow

The lifecycle is: **Backlog -> Queued -> Active -> Done/Failed**, with an "Awaiting Review" kanban column for tasks with open PRs. This is clear and well-modeled.

**Friction points:**

1. **Two paths to create a task: NewTicketModal (Quick/Template) and TaskWorkbench.** The "N" shortcut opens TaskWorkbench, but the "+ New Ticket" button ALSO opens TaskWorkbench now (line 94 of SprintToolbar). The NewTicketModal still exists in the codebase but may no longer be the primary entry point — this is confusing. Clarify which is the canonical creation path and consider deprecating NewTicketModal if TaskWorkbench supersedes it.
2. **No batch operations.** Users cannot multi-select cards to move, cancel, or re-prioritize in bulk. For a sprint of 20+ tasks, this is a significant workflow gap.
3. **LogDrawer vs TaskMonitorPanel dual-render.** SprintCenter renders BOTH LogDrawer (bottom sheet) and TaskMonitorPanel (side panel) when `logDrawerTask` is set. The TaskMonitorPanel is the primary view (it's in a resizable panel), and the LogDrawer slides up from the bottom on top of it. This creates visual confusion — the LogDrawer likely should be removed.
4. **Blocked tasks are hard to manage.** The "Unblock" button on blocked TaskCards calls `window.api?.sprint?.unblockTask` directly (bypassing the Zustand store). No visual indicator of WHAT is blocking beyond a text list. The dependency chips show truncated UUIDs (`dep.id.slice(0, 8)`) — not human-readable.
5. **No keyboard navigation within the kanban.** Arrow keys don't move between cards. Tab order follows DOM order (column by column) which is fine but not optimized.

### Information Density

- **TaskCard is well-balanced** for the kanban view. Title, badges, actions, agent status — the right information for scanning.
- **Backlog table is too sparse.** Only shows title, priority dot, repo badge, created date, and actions. Missing: spec presence indicator, dependency count, last-updated timestamp.
- **Done table is adequate** but would benefit from a duration column (started_at -> completed_at).
- **The "Awaiting Review" column cards** show PR Open/Merged badges but don't show CI status (pass/fail). This is available in PR Station but absent here.

### Missing UX Patterns

1. **No quick-filter by status.** Users can filter by repo but not by status. A "Show only blocked" or "Show only failed" filter would help triage.
2. **No task count summary.** The header shows individual badges for stuck/conflict but no overall sprint stats (e.g., "3 active, 5 queued, 12 done").
3. **No drag handle affordance.** Cards are `cursor: grab` everywhere. A visible drag handle (grip dots on the left) would make the DnD affordance explicit and allow clicking the card body without initiating drag.
4. **No task detail view.** Clicking a card title opens the SpecDrawer (right-side panel). There's no full-screen task detail with timeline, logs, PR info, and spec all in one view.
5. **No undo for status changes.** Moving a card from active->queued shows a confirmation dialog, but there's no undo toast for any other drag-and-drop operation.

---

## Sr. Frontend Dev Findings

### Component-Level Changes

**SprintCenter.tsx (349 lines)**

- The `kanbanContent` JSX variable is 163 lines of inline JSX. Extract the header into `SprintToolbar` (which already exists but is unused — the toolbar is duplicated in SprintCenter). SprintCenter should import and use `SprintToolbar` instead of duplicating the header markup (lines 126-185).
- Line 330: `<LogDrawer task={logDrawerTask} ... />` is always rendered alongside `<TaskMonitorPanel>`. Since TaskMonitorPanel has replaced LogDrawer's function (it's now the primary output viewer), remove LogDrawer from SprintCenter.

**TaskCard.tsx**

- Line 41: `const allTasks = useSprintTasks((s) => s.tasks)` — the entire task array is subscribed to just for blocker name resolution. This causes every card to re-render when ANY task changes. Fix: use a selector that only returns the dependency task titles: `useSprintTasks((s) => task.depends_on?.map(d => s.tasks.find(t => t.id === d.id)?.title).filter(Boolean) ?? [])`.
- The `useSortable` hook creates a new `sortableAttributes` object every render (line 49: `{ ...attributes, 'aria-roledescription': 'sortable task' }`). Memoize or move to a ref.

**EventCard.tsx**

- All 7 sub-cards (StartedCard, ToolCallCard, etc.) use inline styles with `tokens.*` references. Extract to CSS classes: `.event-card`, `.event-card--started`, `.event-card--tool-call`, etc. The `cardBase` shared style object should become a `.event-card` base class.
- ToolCallCard has a manually styled expand/collapse button (lines 102-118). Use the existing `Button` component with `variant="icon"`.

**TaskMonitorPanel.tsx**

- 100% inline styles. Extract to `.task-monitor`, `.task-monitor__header`, `.task-monitor__status-line`, `.task-monitor__body`, `.task-monitor__footer` classes.

**WorkbenchForm.tsx / WorkbenchCopilot.tsx / WorkbenchActions.tsx / ReadinessChecks.tsx**

- All 4 components are 100% inline-styled. Create a `task-workbench.css` file (or add a `/* Task Workbench */` section to sprint.css) with classes for all elements.

**NewTicketModal.tsx**

- The `TEMPLATES` constant (lines 36-69) duplicates template spec content that should live in shared config or be loaded from settings.
- `PRIORITY_OPTIONS` is defined in 3 places: NewTicketModal.tsx, TaskTable.tsx, and WorkbenchForm.tsx. Extract to `src/renderer/src/lib/constants.ts`.

### CSS Changes

**Dead/duplicated code in sprint.css (estimated ~400 lines removable):**

| Lines     | Section                                                                                    | Status                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 837-864   | `.spec-drawer__prompt-section`, `.spec-drawer__prompt-toggle`, `.spec-drawer__prompt-body` | Exact duplicates of lines 719-746. Remove the second copy.                                                                                                                     |
| 1826-2046 | `.design-mode` section (221 lines)                                                         | This was for the old NewTicketModal "Design Mode" which was replaced by TaskWorkbench. Grep for usage; if `design-mode` classes aren't referenced in any TSX, delete entirely. |
| 79-204    | `.pr-list`, `.pr-row`, `.pr-confirm` sections (126 lines)                                  | These are for the old PR list that was part of SprintView. Verify if still used; PR Station likely replaced this.                                                              |
| 990-992   | `@keyframes spin`                                                                          | Generic spin animation — likely duplicated in base.css. Check and remove if so.                                                                                                |

**Feast-site border-radius migration:**

| Selector                         | Current                      | Target                         |
| -------------------------------- | ---------------------------- | ------------------------------ |
| `.kanban-col`                    | `var(--bde-radius-md)` = 6px | `var(--bde-radius-xl)` = 20px  |
| `.task-card`                     | `var(--bde-radius-sm)` = 4px | `16px`                         |
| `.kanban-col__header`            | 0 (inherits overflow hidden) | Keep 0 (inside kanban-col)     |
| `.spec-drawer`                   | 0                            | `20px 0 0 20px` (left corners) |
| `.log-drawer`                    | `12px 12px 0 0`              | `20px 20px 0 0`                |
| `.new-ticket-modal__chip`        | `12px`                       | `9999px` (pill)                |
| `.sprint-board__repo-chip`       | `12px`                       | `9999px` (pill)                |
| `.sprint-tasks__input`           | `var(--bde-radius-sm)` = 4px | `12px`                         |
| `.sprint-tasks__select`          | `var(--bde-radius-sm)` = 4px | `12px`                         |
| `.new-ticket-modal__spec-editor` | `var(--bde-radius-sm)` = 4px | `12px`                         |
| `.spec-drawer__editor`           | `var(--bde-radius-sm)` = 4px | `12px`                         |
| `.bde-priority-popover`          | `var(--bde-radius-md)` = 6px | `12px`                         |
| `.conflict-drawer`               | 0                            | `20px 0 0 20px`                |
| `.health-drawer`                 | 0                            | `20px 0 0 20px`                |

**Legacy CSS variable references to migrate:**

| Current Variable                                                      | Replacement               |
| --------------------------------------------------------------------- | ------------------------- |
| `var(--color-surface)` in `.task-card__dep-chip`                      | `var(--bde-surface)`      |
| `var(--color-border)` in `.task-card__dep-chip`                       | `var(--bde-border)`       |
| `var(--color-surface-raised)` in `.task-card__dep-chip--hard`         | `var(--bde-surface-high)` |
| `var(--text-secondary)` in `.agent-chip--idle`                        | `var(--bde-text-muted)`   |
| `var(--color-running)` in `.agent-chip--running`                      | `var(--bde-accent)`       |
| `var(--color-queued)` in `.agent-chip--done`                          | `var(--bde-success)`      |
| `var(--color-error)` in `.agent-chip--error`                          | `var(--bde-danger)`       |
| `var(--color-text-tertiary, #666)` in `.sprint-center__shortcut-hint` | `var(--bde-text-dim)`     |
| `var(--color-surface-raised, ...)` in `.sprint-center__shortcut-hint` | `var(--bde-surface-high)` |
| `var(--color-border, ...)` in `.sprint-center__shortcut-hint`         | `var(--bde-border)`       |
| `var(--color-info)` in `.pr-row__btn--open:hover`                     | `var(--bde-info)`         |
| `var(--color-danger, #ef4444)` in `.sprint-center__error-message`     | `var(--bde-danger)`       |

**Hover and micro-interaction additions needed:**

```css
/* Add to .task-card */
.task-card:hover {
  border-color: var(--bde-border-hover);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.3),
    0 0 8px rgba(0, 211, 127, 0.05);
  transform: translateY(-1px);
}

.task-card:active {
  transform: scale(0.97);
  transition: transform 100ms ease;
}

/* Add to .sprint-board__repo-chip */
.sprint-board__repo-chip:active {
  transform: scale(0.97);
}

/* Add to .new-ticket-modal__chip */
.new-ticket-modal__chip:active {
  transform: scale(0.97);
}

/* Add to .bde-task-table__action-btn */
.bde-task-table__action-btn:active {
  transform: scale(0.95);
}

/* Add to .conflict-badge-btn */
.conflict-badge-btn:hover {
  opacity: 0.85;
}
.conflict-badge-btn:active {
  transform: scale(0.97);
}
```

### Performance Concerns

1. **TaskCard subscribes to entire tasks array.** `useSprintTasks((s) => s.tasks)` on line 41 of TaskCard.tsx means every task mutation re-renders every visible card. With 20+ tasks, this causes cascade re-renders on every poll, SSE update, or drag. Fix with a targeted selector.

2. **KanbanBoard recreates `draggableTasks` every render.** Line 82: `const draggableTasks = [...todoTasks, ...activeTasks]` creates a new array on every render. Wrap in `useMemo`.

3. **LayoutGroup on the entire kanban.** `<LayoutGroup>` wraps all 3 columns plus DragOverlay. framer-motion's LayoutGroup performs layout measurements on every child mount/unmount. With 30+ cards, this is expensive. The conditional `layoutId={reduced || tasks.length > 10 ? undefined : task.id}` in KanbanColumn is a good optimization but the threshold should be lower (>5 per column, not >10).

4. **SprintCenter is a mega-component.** At 349 lines, it manages kanban, 3 tables, 2 drawers, conflict drawer, health drawer, backlog search, and confirmations. Each re-render touches all of these. The `kanbanContent` variable (163 lines of JSX) should be a separate `SprintKanbanSection` component that receives props.

5. **EventCard inline styles prevent CSS caching.** Each of the 7 event card types creates new style objects on every render. React must diff these objects. CSS classes would be compared as string equality — faster.

6. **Polling interval stacking.** SprintCenter initializes `useSprintPolling()`, `usePrStatusPolling()`, and the `initTaskOutputListener()`. If the user navigates away and back, these hooks re-initialize. Verify they clean up properly (they do have cleanup returns, but worth auditing for leaked intervals).

---

## Priority Matrix

| Change                                                           | Impact | Effort  | Priority |
| ---------------------------------------------------------------- | ------ | ------- | -------- |
| Bump TaskCard border-radius to 16px + add hover states           | High   | Low     | **P1**   |
| Fix legacy CSS variable references (10+ occurrences)             | High   | Low     | **P1**   |
| Remove duplicate `.spec-drawer__prompt-*` rules (46 lines)       | Low    | Trivial | **P1**   |
| Fix TaskCard `useSprintTasks(s => s.tasks)` perf issue           | High   | Low     | **P1**   |
| Bump KanbanColumn border-radius to 20px + glass treatment        | High   | Low     | **P1**   |
| Add micro-interactions (active:scale, hover:lift) to cards/chips | Medium | Low     | **P2**   |
| Extract TaskMonitorPanel inline styles to CSS classes            | Medium | Medium  | **P2**   |
| Remove LogDrawer (replaced by TaskMonitorPanel)                  | Medium | Low     | **P2**   |
| Delete dead `.design-mode` CSS section (~221 lines)              | Low    | Trivial | **P2**   |
| Verify and delete dead `.pr-list`/`.pr-row`/`.pr-confirm` CSS    | Low    | Low     | **P2**   |
| Extract PRIORITY_OPTIONS to shared constants (DRY)               | Low    | Low     | **P2**   |
| Add glassmorphism to SpecDrawer left edge (border-radius)        | Medium | Low     | **P2**   |
| Repo chips to pill shape (border-radius: 9999px)                 | Medium | Low     | **P2**   |
| Migrate all input/select border-radius from 4px to 12px          | Medium | Low     | **P2**   |
| Extract WorkbenchForm/Copilot/Actions inline styles to CSS       | Medium | High    | **P3**   |
| Remove SprintCenter header duplication (use SprintToolbar)       | Medium | Medium  | **P3**   |
| Add ambient glow to active kanban column                         | Medium | Medium  | **P3**   |
| Add bulk task selection + batch actions                          | High   | High    | **P3**   |
| Replace emoji in ReadinessChecks with lucide icons               | Low    | Low     | **P3**   |
| Deprecate/remove NewTicketModal (TaskWorkbench supersedes)       | Medium | Medium  | **P3**   |
| Add sprint stats summary to toolbar                              | Medium | Medium  | **P3**   |
| Add keyboard navigation (arrow keys) within kanban               | Medium | High    | **P4**   |
| Add drag handle affordance to TaskCard                           | Low    | Medium  | **P4**   |
| Memoize `draggableTasks` in KanbanBoard                          | Low    | Low     | **P4**   |
| Extract SprintCenter into smaller sub-components                 | Medium | High    | **P4**   |

# Task Pipeline View — Redesign Spec

## Summary

Rename "Sprint" to "Task Pipeline" across all user-visible labels, unify the view's styling onto the v2 neon design system (`--neon-*` tokens), extract inline styles to CSS classes, and apply layout/polish improvements to both the task list sidebar and detail pane.

## Goals

1. **Rename**: All user-facing references change from "Sprint" to "Task Pipeline". Internal view type `'sprint'` stays to avoid IPC/store/file rename churn.
2. **CSS unification**: Migrate task list sidebar from old `--bde-*` tokens (sprint.css) to `--neon-*` tokens (sprint-neon.css). Remove redundant sprint.css rules.
3. **Inline → CSS**: Extract ~120 lines of inline styles from SprintCenter.tsx and CircuitPipeline.tsx into sprint-neon.css classes.
4. **Layout improvements**: Spacious padding throughout, better visual hierarchy.
5. **Detail pane polish**: Inline meta strip, promoted spec section, proper display status names.

## Non-Goals

- Renaming the internal view type (`'sprint'`) or IPC channel names
- Renaming CSS class prefixes (`.sprint-*` stays — not worth the churn)
- Renaming component filenames (`SprintCenter.tsx`, etc.)
- Adding resizable panels or drag-and-drop changes
- Changing data flow, stores, or business logic

## Design Decisions

### Rename Scope

These labels change:

- Tab: "Sprint" → "Task Pipeline" (`VIEW_LABELS` in `panelLayout.ts`)
- Header title: "Sprint Center" → "Task Pipeline" (`VIEW_TITLES` in `App.tsx`)
- Pipeline bar label: "Sprint Pipeline" → "Task Pipeline" (in `CircuitPipeline.tsx`)
- Sidebar label: "Sprint Center" → "Task Pipeline" (`VIEW_LABELS` in `NeonSidebar.tsx`)
- Overflow menu label: "Sprint Center" → "Task Pipeline" (`VIEW_LABELS` in `OverflowMenu.tsx`)
- Command palette: "Go to Sprint" → "Go to Task Pipeline" (in `CommandPalette.tsx`)
- Keyboard shortcut comment: update `⌘4=sprint` → `⌘4=task-pipeline`

These stay unchanged:

- View type: `'sprint'` (used in routing, IPC, stores, keyboard shortcuts)
- CSS classes: `.sprint-*` prefix (hundreds of selectors, not worth renaming)
- File names: `SprintCenter.tsx`, `SprintTaskList.tsx`, etc.
- Store names: `useSprintTasks`, `useSprintUI`, `useSprintEvents`
- IPC channels: `sprint:list`, `sprint:create`, etc.

### Sidebar Layout (Top → Bottom)

1. **Pipeline bar** — Moves from full-width zone above the sidebar+detail split into the sidebar column. "Task Pipeline" label on its own line above the stage pills. Stages wrap naturally. `14px 16px` padding. Pipeline stages are clickable (act as status filters, replacing the old filter chip row). This changes the flex layout in SprintCenter: the outer container becomes a single flex row (sidebar + detail), and the pipeline bar becomes the first child of the sidebar column.
2. **Tasks header** — "TASKS" label + count badge + add button. `14px 16px` padding.
3. **Repo filter** — Horizontal row of repo chips (BDE, life-os, feast, All). `10px 16px` padding.
4. **Search** — Full-width search input. `10px 16px` padding.
5. **Task list** — Scrollable. Status groups with chevron + colored accent dot + label + count. Task items with left accent border for selection, `12px 14px` padding, status + repo badges + timestamp on second row.

**Removed**: The separate status filter chip row (8 chips). Pipeline stages replace this functionality — clicking a stage filters to that status.

### Detail Pane Layout (Top → Bottom)

1. **Header band** — `20px 24px` padding. Title (17px, bold) + status badge (proper display name like "Active" not "active"). Below title: inline meta strip (repo, priority, created, started dates) with `20px` gaps. Below meta: action buttons row.
2. **Scrollable body** — `20px 24px` padding, `16px` gap between sections.
   - **Agent bar** (if active) — Inline row with pulsing dot, agent ID, status, "Open in Agents →" link. Not a collapsible section.
   - **Specification** — Visually promoted with purple-tinted header and purple border. Collapsible. Rendered markdown content.
   - **Dependencies** (if any) — Collapsible. Shows "X of Y complete" in header. Each dep as a row with check/circle icon + title + status badge.
   - **Pull Request** (if any) — Collapsible. PR number, status badge, mergeable state, "View PR →" link.
   - **Notes** (if any) — Collapsible. Monospace text in a subtle container.

**Removed**: Close (✕) button UI from detail pane header. The `onClose` prop on `SprintDetailPane` is kept for programmatic use (called after task deletion to deselect). The collapsible "Metadata" section is replaced by the always-visible inline meta strip.

### CSS Migration Strategy

1. **Move task list styles to sprint-neon.css**: Add new rules for `.sprint-task-list`, `.sprint-task-list-item`, and related classes using `--neon-*` tokens.
2. **Extract SprintCenter inline styles**: Create `.sprint-center__sidebar`, `.sprint-center__pipeline`, `.sprint-center__repo-row`, etc. classes in sprint-neon.css.
3. **Extract CircuitPipeline inline styles**: Create `.circuit-pipeline`, `.circuit-pipeline__label`, etc. classes.
4. **Remove old sprint.css rules**: After migration, delete the task-list-related rules from sprint.css (lines ~2050-2256). Keep any rules still used by other components (kanban board, task tables, spec drawer, etc.).
5. **All new CSS uses v2 neon tokens**: No hardcoded `rgba()` values, no `--bde-*` tokens. Key token mappings for inline style replacements:
   - `rgba(138, 43, 226, 0.04)` gradients → `var(--neon-purple-surface)` (or keep in CSS gradient with token reference)
   - `rgba(10, 0, 21, 0.4)` backgrounds → `var(--neon-surface-deep)` or `var(--neon-bg)`
   - `rgba(255, 255, 255, 0.1)` borders → `var(--neon-surface-subtle)` or use existing border tokens
   - `rgba(255, 255, 255, 0.5)` text → `var(--neon-text-muted)`
   - `rgba(255, 255, 255, 0.3)` text → `var(--neon-text-dim)`

### Status Display Names

The detail pane status badge and task list badges use display names:

| Raw Status                  | Display Name |
| --------------------------- | ------------ |
| `active` (no PR)            | Active       |
| `active` + `pr_status=open` | Review       |
| `done` + `pr_status=open`   | Review       |
| `queued`                    | Queued       |
| `blocked`                   | Blocked      |
| `backlog`                   | Backlog      |
| `done`                      | Done         |
| `failed`                    | Failed       |
| `cancelled`                 | Cancelled    |
| `error`                     | Error        |

### Pipeline Stage → Status Filter Integration

Pipeline stages become clickable filters. Clicking a stage sets the `statusFilter` in `useSprintUI` to the corresponding filter value. The currently active filter gets a subtle glow/highlight on the corresponding pipeline stage pill.

Mapping:

- Backlog → `'backlog'`
- Queued → `'todo'`
- Active → `'in-progress'` (includes only truly active tasks, not awaiting-review)
- Done → `'done'`
- Blocked → `'blocked'`
- Failed → `'failed'`

Clicking the already-active stage resets to `'all'`.

**Awaiting Review tasks**: These are shown in the task list under their own "Awaiting Review" group header (as today). They are visible when no pipeline stage filter is active (`'all'`). There is no dedicated pipeline stage for review — these tasks are a subset already surfaced by the group headers. The existing `'awaiting-review'` status filter value remains in the store for programmatic use (e.g., Dashboard drill-down) but has no corresponding pipeline stage pill.

## Files to Modify

### Must Change

- `src/renderer/src/stores/panelLayout.ts` — `VIEW_LABELS.sprint` → "Task Pipeline"
- `src/renderer/src/App.tsx` — `VIEW_TITLES.sprint` → "Task Pipeline", update shortcut comment
- `src/renderer/src/components/layout/NeonSidebar.tsx` — `VIEW_LABELS.sprint` → "Task Pipeline"
- `src/renderer/src/components/layout/OverflowMenu.tsx` — `VIEW_LABELS.sprint` → "Task Pipeline"
- `src/renderer/src/components/layout/CommandPalette.tsx` — "Go to Sprint" → "Go to Task Pipeline"
- `src/renderer/src/components/sprint/CircuitPipeline.tsx` — Label change, extract inline styles to CSS classes, add click handler for status filtering
- `src/renderer/src/components/sprint/SprintCenter.tsx` — Extract inline styles to CSS classes, remove close button from detail pane props, remove separate status filter section
- `src/renderer/src/components/sprint/SprintTaskList.tsx` — Remove status filter chips (pipeline stages replace them), add colored accent dots to group headers
- `src/renderer/src/components/sprint/SprintDetailPane.tsx` — Inline meta strip (remove Metadata section), promoted spec section, proper display status names, remove close button, agent bar as inline element
- `src/renderer/src/assets/sprint-neon.css` — Add new classes for sidebar, pipeline, task items, detail pane layout; update existing classes with spacious padding

### May Change

- `src/renderer/src/assets/sprint.css` — Remove migrated task-list rules (lines ~2050-2256)
- `src/renderer/src/stores/sprintUI.ts` — May need to expose status filter setter for pipeline stage clicks

### Won't Change

- IPC channels, store logic, data layer, shared types
- Other sprint components (KanbanBoard, SpecDrawer, LogDrawer, ConflictDrawer, etc.)
- Preload bridge, handler files

## Testing

- Existing unit tests continue to pass (component logic unchanged)
- Handler count tests unaffected (no new IPC handlers)
- Update test assertions that reference old labels:
  - `src/renderer/src/components/layout/__tests__/OverflowMenu.test.tsx` — "Sprint Center" → "Task Pipeline"
  - Any other tests asserting on "Sprint" or "Sprint Center" text
- Visual verification that all neon tokens render correctly in both dark and light themes
- Verify pipeline stage clicks filter the task list correctly
- Verify status display names appear correctly in both sidebar and detail pane

## Mockup Reference

Interactive mockup at `.superpowers/brainstorm/18444-1774511568/spacious-layout.html`

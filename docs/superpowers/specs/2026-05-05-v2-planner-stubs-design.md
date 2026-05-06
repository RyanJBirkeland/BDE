# V2 Planner Stubs Design

**Date:** 2026-05-05
**Scope:** Fill three "coming soon" stubs in `PlannerViewV2` — Dependencies tab, Activity tab, and inline epic edit in `PlEpicHero`.

---

## Context

`PlEpicCanvas` has four tabs: Tasks (implemented), Spec (implemented), Dependencies, Activity. The latter two render a "coming soon" placeholder. `PlEpicHero` has an "Edit epic" button that shows a toast directing users to the overflow menu. All required IPC and store methods already exist.

---

## Piece 1 — Dependencies Tab (`PlDepsPane`)

### What it does
Displays the epic's upstream dependencies and lets the user add, remove, or change the condition of each.

### Layout
Two sections stacked vertically inside the tab panel, same padding as other panes (`28px` horizontal):

1. **Dependency list** — one card per `EpicDependency` in `epic.depends_on`. Each card:
   - Upstream epic name (resolved from `taskGroups.groups`)
   - Condition pill: clickable, cycles `on_success → always → manual → on_success` via `taskGroups.updateDependencyCondition`
   - Remove button (×) — calls `taskGroups.removeDependency`
   - If the upstream epic is not found in `groups` (stale ID), show the raw ID in muted text

2. **Add dependency row** — at the bottom, a `<select>` listing all epics except the current one, sorted alphabetically. On selection, calls `taskGroups.addDependency(epicId, { id: upstreamId, condition: 'on_success' })` and resets the select to the placeholder. If the server returns a cycle error, shows a one-line inline error message ("Adding this dependency would create a cycle") that clears on next interaction.

3. **Empty state** — when `depends_on` is empty and before the user adds anything: "No dependencies — this epic runs independently."

### New file
`src/renderer/src/components/planner/v2/PlDepsPane.tsx`

### Props
```ts
interface PlDepsPaneProps {
  epic: TaskGroup
  allEpics: TaskGroup[]  // for name resolution + add selector
}
```

`allEpics` comes from `taskGroups.groups` in `PlEpicCanvas` (already available via `useTaskGroupsStore`).

### Wire-up in `PlEpicCanvas`
Replace the "coming soon" branch for `Dependencies` tab with `<PlDepsPane epic={epic} allEpics={allEpics} />`. Read `allEpics` from `useTaskGroupsStore((s) => s.groups)` inside `PlEpicCanvas`.

---

## Piece 2 — Activity Tab (`PlActivityFeed`)

### What it does
A chronological (newest-first) feed of notable events across all tasks in the epic, combining:
- **Task audit entries** from `window.api.sprint.getChanges(taskId)` — every field change recorded in `task_changes`
- **Agent events** from `sprintEvents` store (live) + `getAgentEventHistory(taskId)` (history), filtered to `agent:started`, `agent:completed`, `agent:error`, `agent:tool_call`

### Data loading
Fetched lazily on first tab activation. A `usePlActivityFeed(tasks)` hook:
1. Receives the epic's task array
2. On mount, fires `Promise.all` of `getChanges` + `getAgentEventHistory` for each task
3. Merges all results into a single `FeedEntry[]` sorted by `timestamp` descending
4. Subscribes to `sprintEvents` for live updates while the tab is visible (new events prepended)

### `FeedEntry` shape
```ts
type FeedEntry =
  | { kind: 'change'; taskId: string; taskTitle: string; field: string; oldValue: string | null; newValue: string | null; changedBy: string; timestamp: string }
  | { kind: 'agent'; taskId: string; taskTitle: string; eventType: 'agent:started' | 'agent:completed' | 'agent:error' | 'agent:tool_call'; summary: string; timestamp: string }
```

`summary` for agent entries:
- `agent:started` → `"Agent started"`
- `agent:completed` → `"Agent completed"`  
- `agent:error` → error message (truncated to 80 chars)
- `agent:tool_call` → `"$ <tool>: <summary>"` (truncated to 60 chars, same logic as `describeAgentStep`)

### Row layout
Each row: type icon + `[task title]` + description + relative timestamp. Icon by kind:
- `change` → pencil icon
- `agent:started` / `agent:completed` → sparkle/check
- `agent:error` → warning
- `agent:tool_call` → terminal

### States
- **Loading**: spinner while initial fetch is in-flight
- **Empty**: "No activity yet for tasks in this epic."
- **Error**: inline error with retry button

### New files
- `src/renderer/src/components/planner/v2/PlActivityFeed.tsx`
- `src/renderer/src/components/planner/v2/hooks/usePlActivityFeed.ts`

### Wire-up in `PlEpicCanvas`
Replace the "coming soon" branch for `Activity` tab with `<PlActivityFeed tasks={tasks} />`.

---

## Piece 3 — Inline Epic Edit in `PlEpicHero`

### What it does
Clicking the epic name or goal text activates an inline input. Save persists via `taskGroups.updateGroup`. Cancel restores the original value.

### Name field
- Renders as plain text (`<span>`) with a subtle edit cursor on hover
- Click → replaces with `<input type="text">` pre-filled with current name
- **Save**: Enter key or blur → calls `updateGroup(epic.id, { name: value.trim() })` if changed; no-op if blank (restore original)
- **Cancel**: Escape → restore original, blur input

### Goal field
- Same pattern, but `<textarea>` (auto-resizes to content)
- Save on blur (no Enter-to-save — goal is multi-line)
- Cancel on Escape

### Store call
`taskGroups.updateGroup` already does optimistic update + revert on error — no extra state management needed.

### Changes to `PlEpicHero`
- Remove `onEditEpic` prop (no longer needed; the "Edit epic" button is replaced by inline editing)
- The existing "Edit epic" button is removed from the hero actions row
- Name and goal elements become `EditableText` / `EditableTextarea` — two small co-located components in `PlEpicHero.tsx`

### Changes to `PlEpicCanvas` and `PlannerViewV2`
- `PlEpicCanvas.onEditEpic` prop removed (no callers)
- `PlannerViewV2.handleEditEpic` toast removed
- `PlannerViewV2` no longer passes `onEditEpic` to `PlEpicCanvas`

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/src/components/planner/v2/PlDepsPane.tsx` | New — Dependencies tab |
| `src/renderer/src/components/planner/v2/PlActivityFeed.tsx` | New — Activity feed component |
| `src/renderer/src/components/planner/v2/hooks/usePlActivityFeed.ts` | New — data fetching hook |
| `src/renderer/src/components/planner/v2/PlEpicHero.tsx` | Inline editing for name + goal; remove `onEditEpic` prop |
| `src/renderer/src/components/planner/v2/PlEpicCanvas.tsx` | Wire PlDepsPane + PlActivityFeed; read `allEpics`; remove `onEditEpic` prop |
| `src/renderer/src/components/planner/v2/PlannerViewV2.tsx` | Remove `handleEditEpic` toast; stop passing `onEditEpic` |
| `docs/modules/components/index.md` | Add rows for new planner components |

---

## Non-goals
- Spec tab (already implemented via PlSpecPane)
- Pagination in the Activity feed (epic tasks are small in number; load all on activation)
- Icon / accent-color editing (stays in overflow menu — out of scope for inline edit)
- Creating new epic dependencies from the Planner (only managing existing ones; creation flow is pre-existing)

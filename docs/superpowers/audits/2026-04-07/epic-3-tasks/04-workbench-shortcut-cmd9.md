# Move Task Workbench from Cmd+0 to Cmd+9

## Problem

View shortcuts in `src/renderer/src/lib/view-registry.ts` are numbered 1-8 sequentially, then skip 9, and put the primary task-creation surface (Task Workbench) at Cmd+0:

- ⌘1 Dashboard, ⌘2 Agents, ⌘3 IDE, ⌘4 Task Pipeline, ⌘5 Code Review, ⌘6 Source Control, ⌘7 Settings, ⌘8 Task Planner, **⌘0** Task Workbench, ⌘9 (unused)

⌘0 in most apps means "reset zoom". Putting Workbench there is off-pattern and breaks the 1→N mental model. Flagged by Alpha PM, Bravo PM, Gamma PM, and Gamma Senior Dev independently.

## Solution

Change Task Workbench's shortcut from `Cmd+0` to `Cmd+9` in the view registry. Leave Cmd+0 unassigned (reserved for a future zoom feature or left blank).

The only edit is in `VIEW_REGISTRY` inside `view-registry.ts`. Find the entry for `taskWorkbench` (or whatever the ID is) and change its `shortcut` field from `'0'` (or `'Cmd+0'`) to `'9'` (or `'Cmd+9'` — match the existing format exactly by reading other entries first).

Per CLAUDE.md:

> VIEW_REGISTRY is the single source of truth. VIEW_LABELS / VIEW_SHORTCUT_MAP are derived re-exports. Do NOT edit panelLayout.ts or App.tsx for view metadata.

So editing VIEW_REGISTRY is the complete fix. No other files need touching.

## Files to Change

- `src/renderer/src/lib/view-registry.ts` — change Task Workbench shortcut `0` → `9`

## How to Test

1. `npm run typecheck` — 0 errors
2. `npm run test:coverage` — all tests pass
3. `npm run lint` — 0 errors
4. `grep -n "workbench.*'0'\|workbench.*\"0\"" src/renderer/src/lib/view-registry.ts` — must return zero matches after the fix
5. `grep -n "workbench.*'9'\|workbench.*\"9\"" src/renderer/src/lib/view-registry.ts` — must return at least one match
6. Any existing tests asserting on the Cmd+0 → Workbench binding must be updated to assert Cmd+9.
7. Any `VIEW_LABELS` / `VIEW_SHORTCUT_MAP` tests should auto-update since those are derived.

## Out of Scope

- Assigning Cmd+0 to another view or action
- Changing any other view shortcut
- Updating README, BDE_FEATURES.md, or CLAUDE.md docs that reference the shortcut (separate doc-sync task)
- Adding a "zoom" feature

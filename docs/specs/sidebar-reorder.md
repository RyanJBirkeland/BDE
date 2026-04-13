## Goal

Make the main sidebar navigation icons drag-reorderable. Users should be able to drag icons up/down within the sidebar to customize their order. The order persists across sessions via the existing `sidebar.pinnedViews` setting.

## Context

The sidebar store (`src/renderer/src/stores/sidebar.ts`) already has `reorderViews(views)` with persistence. `SidebarItem` is already `draggable` for panel docking. This task adds intra-sidebar reorder — detecting when a drag target is another sidebar item (not a panel drop zone) and showing a drop indicator between items.

## Approach

1. **NeonSidebar.tsx** — Add `onDragOver`/`onDrop` handlers to the nav list that:
   - Detect sidebar-to-sidebar reorder (same MIME type `application/bde-panel`)
   - Calculate insertion index from cursor Y position relative to sidebar items
   - Show a visual drop indicator (horizontal line) between items at the insertion point
   - On drop, call `useSidebarStore.getState().reorderViews(newOrder)`
2. **SidebarItem.tsx** — Add `onDragOver` handler to each item to:
   - Determine if cursor is in top-half or bottom-half of the item
   - Set a CSS class (`sidebar-item--drop-above` or `sidebar-item--drop-below`) for the indicator
   - Prevent default to allow drop
3. **neon-shell.css** — Add drop indicator styles:
   - `sidebar-item--drop-above::before` / `sidebar-item--drop-below::after` — 2px cyan line
4. **Distinguish reorder vs panel dock**: If drop target is within `.neon-sidebar__nav`, it's a reorder. If drop target is a `PanelDropOverlay`, it's a panel dock. Both use the same drag data format — the drop handler location determines behavior.

## Files to Change

- `src/renderer/src/components/layout/NeonSidebar.tsx` — drag container logic
- `src/renderer/src/components/layout/SidebarItem.tsx` — per-item drop zone detection
- `src/renderer/src/assets/neon-shell.css` — drop indicator styles
- `src/renderer/src/components/layout/__tests__/NeonSidebar.test.tsx` — reorder tests
- `src/renderer/src/components/layout/__tests__/SidebarItem.test.tsx` — drop indicator tests

## How to Test

1. `npm run typecheck` — zero errors
2. `npm test` — all pass including new tests
3. Manual: drag a sidebar icon up/down — cyan indicator line appears, release reorders
4. Manual: reload app — order persists
5. Manual: drag sidebar icon into panel area — panel docking still works (no regression)
6. Keyboard a11y: existing context menu "Move Up" / "Move Down" is out of scope (follow-up task)

## Out of Scope

- Keyboard-based reordering (future: add "Move Up" / "Move Down" to context menu)
- Reordering unpinned items in the overflow menu
- Animation/spring physics on reorder

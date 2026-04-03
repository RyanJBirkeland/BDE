# Multi-Tab Tear-Off Windows — Design Spec

**Date:** 2026-03-30
**Status:** Draft (rev 2 — addresses spec review)
**Prerequisite:** Tear-off Phase 1 (merged), Cross-window drag (PR #565 — must be merged first)

## Overview

Upgrade tear-off windows from single-view to full panel support. When a second tab arrives (via cross-window drop from PR #565), the tear-off seamlessly transitions from the minimal `TearoffShell` to a full `PanelRenderer` with tabs, splits, and internal drag-and-drop. No sidebar — views managed through a dedicated `TearoffTabBar` and DnD only.

## Prerequisites from PR #565

This spec depends on these components from the cross-window drag PR:

- `src/renderer/src/hooks/useCrossWindowDrop.ts` — hook receiving `tearoff:dragIn/dragMove/dragCancel`
- `src/renderer/src/components/panels/CrossWindowDropOverlay.tsx` — overlay with 5-zone targeting
- `tearoff:crossWindowDrop` IPC channel (main → renderer) — executes tab add/split
- `tearoff:dragDone` IPC channel (main → source) — signals drop completion
- `useTearoffDrag` mounted in `UnifiedHeader.tsx` (NOT TearoffShell — TearoffShell has no header tabs in single-view mode; in panel mode, `UnifiedHeader` is not used either, so internal DnD in tear-offs uses the panel system's own drag handlers)

## Requirements

- **Seamless upgrade:** When a second view arrives, tear-off grows a tab bar automatically
- **Full panel system:** Tear-offs support splitting, tab reordering, and 5-zone DnD within the window
- **No sidebar:** Tear-offs remain visually lightweight — no icon strip navigation
- **Tab bar in panel mode:** A `TearoffTabBar` component shows tabs for the focused panel with close buttons
- **Return All:** Header button sends all views back to main window and closes
- **Independent state:** Each tear-off has its own Zustand store instance (separate renderer process)
- **Keyboard shortcuts:** Cmd+W closes focused tab in panel mode. No view-switching shortcuts (Cmd+1-7).

## Architecture

### Mode Flag (not dual state)

Use the `panelLayout` store as the single source of truth. Derive the mode:

```typescript
const root = usePanelLayoutStore((s) => s.root)
const isMultiTab = root.type === 'split' || (root.type === 'leaf' && root.tabs.length > 1)
```

- `isMultiTab === false` → **single-view mode** (existing TearoffShell behavior)
- `isMultiTab === true` → **panel mode** (render PanelRenderer + TearoffTabBar)

No separate `panelRoot` local state — the store IS the state. On mount in single-view mode, initialize the store with `createLeaf(view)`.

### Prevent Layout Persistence Corruption

The `panelLayout` store subscriber (line 525 of `panelLayout.ts`) persists layout to `panel.layout` setting on every mutation. In tear-off windows, this would overwrite the main window's saved layout.

**Fix:** Add a `persistable` flag to the store:

```typescript
interface PanelLayoutState {
  // ... existing fields
  persistable: boolean
}
```

Default `true`. `TearoffShell` sets it to `false` on mount. The subscriber checks `state.persistable` before saving.

### Component Structure

**Single-view mode:**

```
┌─────────────────────────────────┐
│ ● ● ●   [View Name]     [⤶] [✕]│  ← 32px header
├─────────────────────────────────┤
│                                 │
│         View Content            │
│                                 │
└─────────────────────────────────┘
```

**Panel mode:**

```
┌─────────────────────────────────┐
│ ● ● ●              [⤶ All] [✕] │  ← 32px header (drag region)
├─────────────────────────────────┤
│ [Tab A] [Tab B] [✕]            │  ← TearoffTabBar (focused panel's tabs)
├─────────────────────────────────┤
│                                 │
│      PanelRenderer              │
│      (splits, tabs, views)      │
│                                 │
└─────────────────────────────────┘
```

### `TearoffTabBar` Component (NEW)

Renders tabs for the focused panel in tear-off windows. Since there's no sidebar or `UnifiedHeader` in tear-offs, this component provides the tab management UI.

**Props:**

```typescript
interface TearoffTabBarProps {
  panelId: string
  tabs: PanelTab[]
  activeTab: number
  onSelectTab: (index: number) => void
  onCloseTab: (index: number) => void
}
```

**Visual:** Same style as `UnifiedHeader` tabs (neon-shell.css `.header-tab` classes). Horizontal strip, active tab highlighted, close button on hover, draggable for reordering.

**Reads from store:** `usePanelLayoutStore` for focused panel ID → gets tabs/activeTab → renders.

### Transition: Single → Panel Mode

When `tearoff:crossWindowDrop` arrives and `isMultiTab` is false:

```typescript
const store = usePanelLayoutStore.getState()
const currentRoot = store.root as PanelLeafNode // guaranteed leaf in single-view mode

if (payload.zone === 'center') {
  // Add as tab — construct leaf with two tabs directly
  store.addTab(currentRoot.panelId, payload.view as View)
} else {
  // Split — use existing splitPanel which creates a split node
  const direction = payload.zone === 'left' || payload.zone === 'right' ? 'horizontal' : 'vertical'
  store.splitPanel(currentRoot.panelId, direction, payload.view as View)
}
// isMultiTab now becomes true → TearoffShell re-renders in panel mode
```

No manual tree construction needed — use existing store actions. They handle tree mutations correctly.

### "Return All" Flow

**IPC:** New `tearoff:returnAll` channel (send, tearoff → main):

```typescript
// Payload:
{ windowId: string, views: string[] }
```

**TearoffShell handler:**

```typescript
function handleReturnAll() {
  const views = getOpenViews(usePanelLayoutStore.getState().root)
  window.api.tearoff.returnAll({ windowId, views })
}
```

**Main process handler:** Iterates `views`, sends `tearoff:tabReturned` to main window for each, then destroys the tear-off.

### Required Export from panelLayout.ts

Export `findFirstLeaf` (currently module-private at line 305):

```typescript
export function findFirstLeaf(node: PanelNode): PanelLeafNode | null {
```

Also export `getOpenViews` if not already exported (check — it IS exported at line 75).

### Shared `resolveView` Function

Both `TearoffShell.tsx` and `PanelLeaf.tsx` have duplicate `resolveView` switch statements with identical lazy imports. Extract to shared module:

**Create:** `src/renderer/src/lib/view-resolver.ts`

```typescript
import { lazy } from 'react'
import type { View } from '../stores/panelLayout'

export const VIEW_COMPONENTS: Record<View, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: lazy(() => import('../views/DashboardView')),
  agents: lazy(() => import('../views/AgentsView').then((m) => ({ default: m.AgentsView })))
  // ... etc
}
```

Both `TearoffShell` and `PanelLeaf` import from this shared module instead of maintaining copies.

### Keyboard Shortcuts in Tear-Off Panel Mode

- **Cmd+W:** Close focused tab (if multiple tabs remain) or close window (if last tab)
- **Cmd+\\:** Split focused panel (reuse existing shortcut logic)
- **Cmd+Shift+[/]:** Cycle tabs within focused panel
- **No Cmd+1-7:** No view-switching shortcuts (no sidebar to navigate)
- **Escape:** Cancel active drag (existing)

These are registered by `TearoffShell` when in panel mode, using the same event handlers as `App.tsx`.

## What Changes

| File                                                   | Change                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/layout/TearoffShell.tsx`  | Mode derivation from store, conditional render (single vs panel), crossWindowDrop handler, "Return All" button, Cmd+W shortcut, mount TearoffTabBar |
| `src/renderer/src/components/layout/TearoffTabBar.tsx` | NEW — tab strip for focused panel in tear-off windows                                                                                               |
| `src/renderer/src/lib/view-resolver.ts`                | NEW — shared lazy view imports                                                                                                                      |
| `src/renderer/src/stores/panelLayout.ts`               | Export `findFirstLeaf`, add `persistable` flag + subscriber guard                                                                                   |
| `src/renderer/src/components/panels/PanelLeaf.tsx`     | Import views from shared `view-resolver.ts`                                                                                                         |
| `src/preload/index.ts` + `.d.ts`                       | Add `returnAll` method                                                                                                                              |
| `src/shared/ipc-channels.ts`                           | Add `tearoff:returnAll` channel type                                                                                                                |
| `src/main/tearoff-manager.ts`                          | Handle `tearoff:returnAll` IPC                                                                                                                      |

## What Does NOT Change

- `PanelRenderer.tsx` — works as-is
- `PanelDropOverlay.tsx` — internal DnD unchanged
- `CrossWindowDropOverlay.tsx` — cross-window targeting unchanged
- Cross-window drag coordinator — already relays to tear-offs
- `useCrossWindowDrop` hook — already mounted in TearoffShell
- Main window `App.tsx` — no changes

## Edge Cases

**Drop center on single-view tear-off:** Both views become tabs in one panel. Tab bar appears.

**Drop directional on single-view:** Views split side-by-side. Panel mode activates.

**All tabs closed in panel mode:** Store's `closeTab` replaces last-tab root with dashboard (existing behavior). Tear-off stays in panel mode showing dashboard.

**"Return All" with many tabs:** Iterates all views, sends batch to main. Main adds as tabs to focused panel.

**Layout persistence in tear-off:** Subscriber skips persistence when `persistable === false`. Main window's saved layout is never corrupted.

**Cross-window drag FROM multi-tab tear-off:** `useTearoffDrag` fires from `PanelLeaf`'s drag handler (not UnifiedHeader — tear-offs don't have UnifiedHeader). Tab removed from tear-off's store. If last tab → dashboard replacement.

## Testing Strategy

**Unit tests:**

- TearoffShell: `isMultiTab` derivation (single leaf → false, two tabs → true, split → true)
- TearoffShell: panel mode renders PanelRenderer
- TearoffShell: single→panel transition on crossWindowDrop (center and directional)
- TearoffTabBar: renders tabs, close button, active state
- `persistable` flag: subscriber skips save when false

**Integration tests:**

- Cross-window drop into single-view tear-off → panel mode activated
- "Return All" → all views sent to main, window closes
- Cmd+W in panel mode → tab closed

**Manual tests:**

- Drop tab into tear-off center → tab bar appears, both views
- Drop tab into edge → views split side-by-side
- Close tab in multi-tab tear-off → remaining tabs stay
- "Return All" → all tabs return to main
- Internal DnD within multi-tab tear-off (split, reorder)

## Non-Goals

- Sidebar navigation in tear-offs
- Per-window layout persistence (deferred to Phase 2.3)
- Shared panel state between windows
- Tab reordering between windows via drag

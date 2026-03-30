# Multi-Tab Tear-Off Windows — Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Prerequisite:** Tear-off Phase 1 (merged), Cross-window drag (PR #565)

## Overview

Upgrade tear-off windows from single-view to full panel support. When a second tab arrives (via cross-window drop), the tear-off seamlessly transitions from the minimal `TearoffShell` to a full `PanelRenderer` with tabs, splits, and internal drag-and-drop. No sidebar — views managed through tabs and DnD only.

## Requirements

- **Seamless upgrade:** When a second view arrives, tear-off grows a tab bar automatically
- **Full panel system:** Tear-offs support splitting, tab reordering, and 5-zone drag-and-drop within the window
- **No sidebar:** Tear-offs remain visually lightweight — no icon strip navigation
- **Return All:** Header button sends all tabs back to main window and closes the tear-off
- **Independent state:** Each tear-off has its own `PanelNode` tree in its own Zustand store instance
- **Revert to single-view:** Optional — when all tabs but one are closed, can stay in panel mode (simpler)

## Architecture

### State Model

`TearoffShell` gains a `panelRoot` state:

```typescript
const [panelRoot, setPanelRoot] = useState<PanelNode | null>(null)
```

- `panelRoot === null` → **single-view mode** (existing TearoffShell behavior)
- `panelRoot !== null` → **panel mode** (render PanelRenderer with this tree)

### Transition: Single → Panel Mode

When `tearoff:crossWindowDrop` arrives at a single-view tear-off:

1. Create a leaf node from the existing view: `createLeaf(currentView)`
2. Create a leaf for the incoming view: `createLeaf(incomingView)`
3. Combine based on drop zone:
   - `center` → add as tab to existing leaf: `addTab(existingLeaf.panelId, incomingView)`
   - directional → split: create a `PanelSplitNode` with both leaves
4. Set `panelRoot` to the resulting tree
5. TearoffShell re-renders with `PanelRenderer` instead of the single view

### Component Structure

**Single-view mode (panelRoot === null):**
```
┌─────────────────────────────────┐
│ ● ● ●   [View Name]     [⤶] [✕]│  ← 32px header
├─────────────────────────────────┤
│                                 │
│         View Content            │
│                                 │
└─────────────────────────────────┘
```

**Panel mode (panelRoot !== null):**
```
┌─────────────────────────────────┐
│ ● ● ●                [⤶All] [✕]│  ← 32px header (no view name — tabs handle labels)
├─────────────────────────────────┤
│ [Tab A] [Tab B]                 │  ← Panel tab bar (from PanelRenderer)
├─────────────────────────────────┤
│                                 │
│      Panel Content              │
│      (splits, tabs, views)      │
│                                 │
└─────────────────────────────────┘
```

### Panel State Management

Each tear-off window runs its own renderer process with its own Zustand stores. The `usePanelLayoutStore` in a tear-off is a completely independent instance from the main window's store.

**Initialization:** When transitioning to panel mode, `TearoffShell` calls:
```typescript
usePanelLayoutStore.setState({ root: panelRoot, focusedPanelId: firstLeaf.panelId })
```

**After initialization:** All panel operations (split, close tab, move tab, etc.) work through the existing `panelLayout` store actions — no modifications needed. `PanelRenderer`, `PanelLeaf`, `PanelDropOverlay`, `PanelTabBar` all work as-is because they read from the same store.

### Header Behavior

**Single-view header:** Unchanged from Phase 1 — view name, return button, close button.

**Panel-mode header:**
- Remove view name (panel tabs show the labels)
- "Return All" button (↩ icon) — sends all views back to main window:
  1. Collect all view keys from the panel tree via `getOpenViews(root)`
  2. For each view, send `tearoff:tabReturned` to main window with `{ view }`
  3. Close the tear-off window
- macOS traffic lights preserved (80px left padding)
- `-webkit-app-region: drag` on header

### Cross-Window Drop Handling in Tear-Offs

Currently `TearoffShell` has a stub `onCrossWindowDrop` listener. Replace with real logic:

```typescript
useEffect(() => {
  if (!window.api?.tearoff?.onCrossWindowDrop) return
  return window.api.tearoff.onCrossWindowDrop((payload) => {
    if (panelRoot === null) {
      // Transition from single-view to panel mode
      const existingLeaf = createLeaf(view)  // current single view
      let newRoot: PanelNode

      if (payload.zone === 'center') {
        // Add as tab to the existing leaf
        newRoot = addTab(existingLeaf, existingLeaf.panelId, payload.view as View)!
      } else {
        // Split
        const newLeaf = createLeaf(payload.view as View)
        const direction = (payload.zone === 'left' || payload.zone === 'right') ? 'horizontal' : 'vertical'
        const isFirst = payload.zone === 'left' || payload.zone === 'top'
        newRoot = {
          type: 'split',
          direction,
          children: isFirst ? [newLeaf, existingLeaf] : [existingLeaf, newLeaf],
          sizes: [50, 50]
        }
      }

      setPanelRoot(newRoot)
      usePanelLayoutStore.setState({
        root: newRoot,
        focusedPanelId: findFirstLeaf(newRoot)?.panelId ?? ''
      })
    } else {
      // Already in panel mode — use store actions directly
      const store = usePanelLayoutStore.getState()
      if (payload.zone === 'center') {
        store.addTab(payload.targetPanelId, payload.view as View)
      } else {
        const direction = (payload.zone === 'left' || payload.zone === 'right') ? 'horizontal' : 'vertical'
        store.splitPanel(payload.targetPanelId, direction, payload.view as View)
      }
    }
  })
}, [panelRoot, view])
```

### Internal DnD in Panel Mode

Works automatically — `PanelRenderer` uses `PanelDropOverlay` for internal drag-and-drop, which reads from `usePanelLayoutStore`. Since each tear-off has its own store instance, there's no cross-window state conflict.

The `useTearoffDrag` hook is also active, so dragging a tab to the window edge still triggers tear-off/cross-window behavior. Internal drops are handled by `PanelDropOverlay` first (higher specificity), so there's no conflict.

### "Return All" Flow

New IPC channel needed: `tearoff:returnAll` (send, tearoff → main)

1. Tear-off collects all views: `getOpenViews(panelRoot)`
2. Sends `tearoff:returnAll` with `{ windowId, views: View[] }` to main process
3. Main process sends `tearoff:tabReturned` to main window once per view
4. Main process destroys tear-off window

Alternative (simpler): Reuse existing `tearoff:returnToMain` for each view, then close. The main process already handles this — just call it N times. But this sends N IPC messages. A single `tearoff:returnAll` is cleaner.

### Layout Persistence

The tear-off's panel layout is NOT persisted separately. On close/return, the layout is lost and views return to the main window as individual tabs. This matches Phase 1 behavior (tear-offs not restored on restart).

Future (Phase 2.3 state restoration) can add per-window layout persistence.

### What Changes

| File | Change |
|------|--------|
| `src/renderer/src/components/layout/TearoffShell.tsx` | Add `panelRoot` state, conditional rendering (single vs panel mode), crossWindowDrop handler upgrade, "Return All" button, import PanelRenderer |
| `src/renderer/src/components/panels/PanelRenderer.tsx` | No changes — works as-is |
| `src/renderer/src/stores/panelLayout.ts` | No changes — independent per window |
| `src/preload/index.ts` + `.d.ts` | Add `returnAll` method (optional — can reuse returnToMain) |
| `src/main/tearoff-manager.ts` | Handle `tearoff:returnAll` if adding dedicated channel |
| `src/shared/ipc-channels.ts` | Add `tearoff:returnAll` channel type (optional) |

### What Does NOT Change

- `PanelRenderer`, `PanelLeaf`, `PanelDropOverlay`, `PanelTabBar` — all work as-is
- `panelLayout.ts` store — mutations unchanged
- Cross-window drag coordinator — already relays to tear-offs
- `useTearoffDrag` — already mounted in TearoffShell
- `useCrossWindowDrop` — already mounted, just needs the handler upgraded
- Main window `App.tsx` — no changes

## Edge Cases

**Drop on single-view tear-off with zone 'center':**
Both views become tabs in one panel. User sees a tab bar appear.

**Drop on single-view tear-off with directional zone:**
Views split side-by-side. User sees the window divide into two panes.

**All tabs closed in panel mode:**
When `closeTab` removes the last tab from the root leaf, `panelLayout` store replaces with dashboard (existing behavior). The tear-off stays in panel mode showing dashboard. Could revert to single-view mode, but staying in panel mode is simpler and consistent.

**"Return All" with many tabs:**
Iterates all views, sends each back. Main window adds them as tabs to the focused panel. Could flood the focused panel — acceptable for now.

**Cross-window drag FROM multi-tab tear-off:**
`useTearoffDrag` fires on drag exit. The tab is removed from the tear-off's panel store. If it was the last tab, the window shows dashboard. If 2+ tabs remain, the tear-off stays open with remaining tabs.

## Testing Strategy

**Unit tests:**
- TearoffShell: single→panel transition on crossWindowDrop
- TearoffShell: panel mode renders PanelRenderer
- TearoffShell: "Return All" collects all views
- TearoffShell: header changes between single/panel mode

**Integration tests:**
- Cross-window drop into single-view tear-off → panel mode activated
- Internal DnD within multi-tab tear-off → split/tab works

**Manual tests:**
- Drop tab into tear-off → tab bar appears, both views accessible
- Drop tab into tear-off edge → views split side-by-side
- Split/tab/close within multi-tab tear-off
- "Return All" → all tabs return to main, tear-off closes
- Drag tab out of multi-tab tear-off → remaining tabs stay

## Non-Goals

- Sidebar navigation in tear-offs
- Per-window layout persistence (deferred to Phase 2.3)
- Shared panel state between windows
- Tab reordering between windows via drag (only move/add)

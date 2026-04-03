# Cross-Window Drag — Design Spec

**Date:** 2026-03-30
**Status:** Draft (rev 2 — addresses spec review)
**Prerequisite:** Tear-off windows Phase 1 (merged)

## Overview

Enable dragging a tab from a tear-off window back into the main window (or another tear-off), with the same 5-zone drop targeting (top/bottom/left/right/center) as internal drag-and-drop. When the last tab leaves a tear-off, the window closes automatically.

## Requirements

- **Trigger:** Drag tab from any BDE window, cursor enters another BDE window
- **Drop targeting:** Full 5-zone system — split panel or add as tab, same as internal DnD
- **Last-tab behavior:** Tear-off closes automatically when its only tab is dragged out
- **Cancel:** Escape key (from any window) or releasing on empty desktop cancels the drag
- **Fallback:** If cursor leaves a window but doesn't enter another BDE window, Phase 1 behavior applies (create a new tear-off at cursor)
- **Direction:** Works in all directions — tearoff→main, tearoff→tearoff, main→tearoff

## Critical Design Decision: HTML5 DnD vs Synthetic Drag

The tab drag starts as an HTML5 DnD operation (existing `draggable` + `onDragStart`). When the cursor leaves the source window and enters another BDE window, we need to transition from HTML5 DnD to a synthetic IPC-based drag. Two systems overlap:

**Transition mechanism:**

1. HTML5 `dragstart` fires in source window → normal tab drag begins
2. Cursor leaves source window → 200ms timer fires in `useTearoffDrag`
3. `tearoff:startCrossWindowDrag` IPC checks if cursor is over another BDE window
4. If yes → cross-window mode activates. The HTML5 drag session continues in the background but is ignored. `tearoffCreated.current = true` suppresses all further Phase 1 actions.
5. When the user **releases the mouse button**, HTML5 `dragend` fires in the source window. In the `dragend` handler, if cross-window mode is active, we do NOT call `endDrag()` — instead, we signal the main process that the mouse was released.
6. Meanwhile, the target window has a full-window transparent overlay (`pointer-events: all`, `z-index: 9999`). This overlay captures the `pointerup` event when the user releases the mouse — because the cursor IS physically over the target window, the raw DOM event fires even though no HTML5 DnD session exists in that window.
7. On `pointerup` in the target, the overlay sends `tearoff:dropComplete` with the panel/zone under the cursor.

**Drag ghost suppression:** The HTML5 drag ghost (semi-transparent tab image) will follow the cursor across windows. This is acceptable for Phase 2.1 — the ghost fades slightly when outside the source window, and the 5-zone overlay in the target provides clear visual feedback. Suppressing the ghost mid-drag is not possible in Chromium without cancelling the entire drag session.

## Architecture

### Data Flow

```
Source Window                      Main Process                     Target Window
─────────────                    ─────────────                     ─────────────
1. User drags tab (HTML5 DnD)
2. Cursor leaves window
3. 200ms timer fires
                          ──→  4. tearoff:startCrossWindowDrag { windowId, viewKey }
                                5. getCursorScreenPoint()
                                   Cursor over another window? → yes
                                   Start 32ms cursor polling
                          ←──  6. return { targetFound: true }
                          ──→  7. tearoff:dragIn { viewKey, localX, localY }
                                                                   8. useCrossWindowDrop activates
                                                                      transparent overlay (pointer-events: all)
                          ──→  9. tearoff:dragMove { localX, localY }
                                   (32ms, only when coords change)  10. Overlay shows 5-zone highlights
                                                                   11. User releases mouse → pointerup on overlay
                          ←── 12. tearoff:dropComplete { viewKey, targetPanelId, zone }
                                13. Stop polling
                                14. Send tearoff:dragDone to source
15. dragend fires (HTML5)
    tearoffCreated=true → noop
16. Close self (last tab)
                                                                   17. addTab or splitPanel
```

### IPC Channels (7 new)

| Channel                        | Pattern | Direction     | Payload                            | Return                     | Purpose                                                   |
| ------------------------------ | ------- | ------------- | ---------------------------------- | -------------------------- | --------------------------------------------------------- |
| `tearoff:startCrossWindowDrag` | handle  | source → main | `{ windowId, viewKey }`            | `{ targetFound: boolean }` | Check if cursor is over another window, start coordinator |
| `tearoff:dragIn`               | send    | main → target | `{ viewKey, localX, localY }`      | —                          | Incoming tab — show overlay                               |
| `tearoff:dragMove`             | send    | main → target | `{ localX, localY }`               | —                          | Cursor update (pre-converted to local coords)             |
| `tearoff:dragCancel`           | send    | main → all    | `{}`                               | —                          | Drag cancelled — hide overlays                            |
| `tearoff:dropComplete`         | send    | target → main | `{ viewKey, targetPanelId, zone }` | —                          | Drop executed                                             |
| `tearoff:dragDone`             | send    | main → source | `{}`                               | —                          | Drop succeeded — source can close                         |
| `tearoff:crossWindowDrop`      | send    | main → target | `{ view, targetPanelId, zone }`    | —                          | Execute the tab add/split in target                       |

### Component Map

```
Main Process
├── tearoff-manager.ts       — add cross-window drag coordinator
│   ├── handleStartCrossWindowDrag() — check cursor, start polling
│   ├── handleDropComplete()         — relay to source + target
│   ├── cancelDrag()                 — cleanup
│   └── source window 'closed' listener — auto-cancel if source dies

Renderer (all windows)
├── hooks/useTearoffDrag.ts          — MODIFY: cross-window vs new-window branching
├── hooks/useCrossWindowDrop.ts      — NEW: receive cross-window drags, manage overlay
├── components/panels/CrossWindowDropOverlay.tsx — NEW: full-window overlay with 5-zone targeting
```

### Main Process: Drag Coordinator

Added to `tearoff-manager.ts`:

```typescript
interface ActiveDrag {
  sourceWindowId: string
  sourceWin: BrowserWindow
  viewKey: string
  pollInterval: ReturnType<typeof setInterval>
  targetWindowId: number | null
  lastSentX: number
  lastSentY: number
}

let activeDrag: ActiveDrag | null = null
```

**`handleStartCrossWindowDrag(windowId, viewKey)`:**

1. Get cursor position via `screen.getCursorScreenPoint()`
2. Find which BrowserWindow (if any) contains that point using `win.getContentBounds()`
3. If no target found → return `{ targetFound: false }` (Phase 1 creates new tearoff)
4. Store as `activeDrag`, start 32ms polling interval
5. Add `closed` listener on source window — auto-cancel if source dies mid-drag
6. Send `tearoff:dragIn` to target with **pre-computed local coords**
7. Return `{ targetFound: true }`

**Cursor polling (32ms):**

- `screen.getCursorScreenPoint()` → check against all window content bounds
- Compute local coords: `localX = cursorX - targetContentBounds.x`, `localY = cursorY - targetContentBounds.y`
- Only send `tearoff:dragMove` if coords changed (guard: `lastSentX !== localX || lastSentY !== localY`)
- If cursor moves to a different window → send `tearoff:dragCancel` to old target, `tearoff:dragIn` to new target
- If cursor leaves all windows → send `tearoff:dragCancel` to current target, keep polling (might re-enter)

**Coordinate conversion in main process (not renderer):**
Screen coords are converted to window-local coords using `BrowserWindow.getContentBounds()` in the main process. This avoids renderer-side issues with `window.screenX`/`screenY` (which are CSS coords, don't account for title bar insets or Retina scaling).

**`handleDropComplete(viewKey, targetPanelId, zone)`:**

1. Stop polling
2. Send `tearoff:dragDone` to source window
3. Send `tearoff:crossWindowDrop` to target window with `{ view: viewKey, targetPanelId, zone }`
4. Clear `activeDrag`

**`cancelDrag()`:**

1. Stop polling
2. Send `tearoff:dragCancel` to all windows
3. Clear `activeDrag`

**Timeout:** 10 seconds without a drop → auto-cancel.
**Source window crash:** `closed` event on source BrowserWindow → cancel immediately.

### Renderer: Modified `useTearoffDrag`

When the 200ms timer fires:

```typescript
if (!dragData.current || tearoffCreated.current) return

// Try cross-window drag first
const result = await window.api.tearoff.startCrossWindowDrag({
  windowId: currentWindowId,
  viewKey: dragData.current.viewKey
})

if (result.targetFound) {
  tearoffCreated.current = true  // suppress dragend cleanup + Phase 1
  crossWindowActive.current = true
} else {
  // No target window — create new tear-off (Phase 1)
  tearoffCreated.current = true
  window.api.tearoff.create({ ... })
}
```

In the `dragend` handler:

```typescript
if (crossWindowActive.current) {
  // Don't call endDrag — let the cross-window coordinator handle lifecycle
  crossWindowActive.current = false
  return
}
endDrag()
```

### Renderer: `useCrossWindowDrop` Hook

Mounted in both `App.tsx` and `TearoffShell.tsx`:

```typescript
interface CrossWindowDropState {
  active: boolean
  viewKey: string | null
  localX: number
  localY: number
}
```

1. Listen for `tearoff:dragIn` → set `active = true`, store viewKey + coords
2. Listen for `tearoff:dragMove` → update localX/localY (coords already in local space, computed by main process)
3. Render `CrossWindowDropOverlay` when `active = true`
4. `CrossWindowDropOverlay` has `pointer-events: all` and listens for `pointerup`:
   - On `pointerup`: determine target panel + zone from current coords
   - Send `tearoff:dropComplete` IPC
   - Set `active = false`
5. Listen for `tearoff:dragCancel` → set `active = false`, hide overlay
6. Listen for `tearoff:crossWindowDrop` → execute `addTab` or `splitPanel` on panel store

**Escape key:** All windows listen for Escape during active cross-window drag. Any window receiving Escape sends `tearoff:dragCancel` to main process, which relays cancel to all windows.

### `CrossWindowDropOverlay` Component

- `position: fixed; inset: 0; z-index: 9999; pointer-events: all`
- Background: transparent (or very subtle overlay for visual feedback)
- Walks `PanelNode` tree, checks which leaf's DOM bounds contain `(localX, localY)`
- Shows 5-zone highlight on the matched panel (same quadrant math as `PanelDropOverlay`)
- On `pointerup` → fire drop with matched panelId + zone

### Edge Cases

**Cursor returns to source window:**

- Main process detects cursor over source → send `tearoff:dragCancel` to target
- Cross-window mode deactivates, but HTML5 DnD is still active in source → internal drop zones resume working

**Multi-monitor with different scale factors:**

- `screen.getCursorScreenPoint()` returns physical pixels
- `BrowserWindow.getContentBounds()` returns physical pixels
- Conversion is consistent — no DPI adjustment needed

**Rapid window switching (A → B → C):**

1. Send `tearoff:dragCancel` to A
2. Send `tearoff:dragIn` to B
3. B shows overlay, A hides overlay
4. If cursor moves to C: cancel B, activate C

**Source window destroyed mid-drag:**

- `closed` listener fires → `cancelDrag()` → all overlays hidden, polling stopped

### What Changes in Phase 1 Code

| File                                                            | Change                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/main/tearoff-manager.ts`                                   | Add drag coordinator (start, poll, drop, cancel, source-closed listener) |
| `src/shared/ipc-channels.ts`                                    | Add 7 new channel types to `TearoffChannels`                             |
| `src/preload/index.ts` + `.d.ts`                                | Expose new drag IPC methods + listeners                                  |
| `src/renderer/src/hooks/useTearoffDrag.ts`                      | Cross-window branching, `crossWindowActive` ref, dragend suppression     |
| `src/renderer/src/hooks/useCrossWindowDrop.ts`                  | NEW — receive drags, manage overlay, handle pointerup                    |
| `src/renderer/src/components/panels/CrossWindowDropOverlay.tsx` | NEW — full-window overlay with 5-zone hit testing + pointerup capture    |
| `src/renderer/src/App.tsx`                                      | Mount `useCrossWindowDrop`, listen for `tearoff:crossWindowDrop`         |
| `src/renderer/src/components/layout/TearoffShell.tsx`           | Mount `useCrossWindowDrop`, handle `tearoff:dragDone` → close            |

### What Does NOT Change

- `PanelDropOverlay.tsx` — internal DnD unchanged
- `panelLayout.ts` — store mutations (addTab/splitPanel) reused as-is
- Phase 1 tearoff creation/close flows

## Testing Strategy

**Unit tests:**

- Drag coordinator: polling → target detection → coordinate conversion → IPC relay
- `useCrossWindowDrop`: state transitions (inactive → active → drop/cancel)
- `CrossWindowDropOverlay`: zone detection from local coordinates, pointerup → dropComplete
- `useTearoffDrag` modification: cross-window vs new-window branching, dragend suppression

**Integration tests:**

- Full IPC round-trip: startCrossWindowDrag → dragIn → dragMove → dropComplete → crossWindowDrop → dragDone
- Cancel flow: dragOut → Escape → dragCancel to all windows
- Timeout: 10s without drop → auto-cancel
- Source window closed mid-drag → auto-cancel

**Manual tests:**

- Drag tab from tear-off into main window — 5-zone targeting works
- Drop into center → tab added; drop into edge → panel splits
- Escape during cross-window drag → cancelled, tab stays in source
- Drag between two tear-off windows
- Last tab dragged out → source tear-off closes
- Drag from main window to tear-off window
- Multi-monitor: drag across monitors with different scale factors
- Rapid: drag cursor across 3 windows quickly — correct highlight following

## Non-Goals

- Tab reordering across windows (only move/add)
- Shared Zustand state between windows
- Suppressing the HTML5 drag ghost during cross-window drag (acceptable visual artifact)
- E2E Playwright tests for cross-window (multi-window Playwright is complex — defer to manual testing)

# Tear-Off Windows — Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Approach:** Query Parameter Routing (Option A)

## Overview

Add the ability to drag a tab past the window boundary to detach it into a standalone window. Each tear-off window shows a single view. On close, the user can choose to return the tab to the main window or discard it.

This is Phase 1 (single-view tear-offs). The architecture supports upgrading tear-off windows to full panel systems in a later phase without a rewrite.

## Requirements

- **Trigger:** Drag tab past the window edge (mouse leaves BrowserWindow bounds)
- **Window position:** New window appears at the mouse drop point
- **Close behavior:** User choice — "Return to main" or "Close", with "Remember my choice" option
- **Scope:** Single view per tear-off window (no splits/tabs within)
- **Persistence:** Window bounds saved; tear-offs not restored on app restart

## Architecture

### Component Map

```
Main Process
├── tearoff-manager.ts        — window lifecycle, IPC handlers, bounds persistence
├── index.ts                  — register tearoff IPC handlers on startup

Renderer (shared by all windows)
├── App.tsx                   — query param check: full shell vs single-view mode
├── TearoffShell.tsx          — minimal shell for tear-off windows (no sidebar, simplified header)
├── hooks/useTearoffDrag.ts   — drag detection hook (boundary exit + screen coords)
├── components/layout/
│   ├── HeaderTab.tsx          — track screenX/screenY during drag
│   └── PanelTabBar.tsx        — track screenX/screenY during drag (sidebar tabs)
```

### Window Lifecycle

#### Creation

1. User drags a tab in the main window
2. `useTearoffDrag` hook detects drag crossing the window boundary
3. Renderer sends `tearoff:create` IPC: `{ view: View, screenX: number, screenY: number, sourcePanelId: string, sourceTabIndex: number }`
4. Main process creates `BrowserWindow`:
   - Position: `(screenX - 400, screenY - 40)` — offset to place window under cursor
   - Size: `800 x 600`
   - Same `webPreferences` as main window (same preload, contextIsolation, etc.)
   - `titleBarStyle: 'hiddenInset'` (macOS)
5. Window loads: `renderer/index.html?view=agents&windowId=w2`
6. Main process stores in `tearoffWindows: Map<string, { win: BrowserWindow, view: View, parentWindowId: number }>`
7. Main process sends `tearoff:tabRemoved` to the main window: `{ sourcePanelId, sourceTabIndex }`
8. Main window's panel store removes the tab

#### Close

1. User closes window (traffic light, Cmd+W, or Cmd+Q)
2. `before-close` fires on `BrowserWindow`
3. If `tearoff.closeAction` setting is not set:
   - Main process sends `tearoff:confirmClose` to the tear-off window
   - Tear-off renderer shows a dialog: "Return this tab to the main window?" with [Return] [Close] and [Remember my choice] checkbox
   - User choice sent back via `tearoff:closeConfirmed` IPC: `{ action: 'return' | 'close', remember: boolean }`
   - If `remember`, persist to `tearoff.closeAction` setting
4. If action is `'return'`:
   - Main process sends `tearoff:tabReturned` to main window: `{ view: View }`
   - Main window adds tab to focused panel
5. Window is destroyed and removed from `tearoffWindows` map

#### App Quit

- `before-quit` → iterate all tear-off windows, close without confirmation
- Tear-off views are NOT persisted for restart (always start fresh in main window)

### Renderer: Query Parameter Routing

`App.tsx` checks `window.location.search` on mount:

```typescript
const params = new URLSearchParams(window.location.search)
const tearoffView = params.get('view') as View | null
const windowId = params.get('windowId')

if (tearoffView && windowId) {
  return <TearoffShell view={tearoffView} windowId={windowId} />
}

// ... existing full panel shell
```

### TearoffShell Component

Minimal wrapper for tear-off windows:

```
┌─────────────────────────────────┐
│ ● ● ●   [View Name]     [⤶] [✕]│  ← 32px header, drag region, return + close buttons
├─────────────────────────────────┤
│                                 │
│         View Content            │  ← Full view component (DashboardView, AgentsView, etc.)
│                                 │
└─────────────────────────────────┘
```

- No sidebar
- No tab bar (single view)
- Minimal header with: view label, "Return to main" button (arrow icon), close button
- macOS traffic light area preserved (80px left padding)
- `-webkit-app-region: drag` on header for window dragging
- Same neon theming (imports same CSS, inherits `html.theme-light` class)

### Drag Detection: `useTearoffDrag` Hook

```typescript
interface TearoffDragState {
  isDragging: boolean
  lastScreenX: number
  lastScreenY: number
  dragData: { sourcePanelId: string; sourceTabIndex: number; viewKey: View } | null
}
```

**Detection algorithm:**

1. On `dragstart` of a tab, store the drag payload in hook state
2. On every `dragover` anywhere in the document, update `lastScreenX`/`lastScreenY` from the event
3. On `dragleave` of `document.documentElement`:
   - Start a 200ms timer (`tearoffTimer`)
   - If `dragenter` fires on `document.documentElement` within 200ms → cancel (cursor re-entered window, was just crossing between elements)
4. If timer fires (cursor truly left the window):
   - Check `dragData` is set (it's a tab drag, not an external file)
   - Send `tearoff:create` IPC with `lastScreenX`, `lastScreenY`, and drag payload
   - Call `e.preventDefault()` on the next `dragend` to suppress the default "snap back" animation
5. On `dragend` with `dropEffect === 'none'` before timer fires → cancel (user dropped onto desktop)

**Edge cases:**
- Multi-monitor: `screenX`/`screenY` are absolute screen coordinates — works across monitors
- Drag cancelled (Escape key): `dragend` fires, timer is cancelled
- Tab is last tab in panel: panel collapses after tear-off (existing `closeTab` behavior)

### Main Process: `tearoff-manager.ts`

```typescript
interface TearoffWindow {
  win: BrowserWindow
  view: View
  windowId: string
}

const tearoffWindows = new Map<string, TearoffWindow>()
let nextWindowId = 1

export function registerTearoffHandlers(): void {
  ipcMain.handle('tearoff:create', async (event, payload) => { ... })
  ipcMain.handle('tearoff:closeConfirmed', async (event, payload) => { ... })
  ipcMain.on('tearoff:returnToMain', (event, payload) => { ... })
}

export function closeTearoffWindows(): void {
  // Called on app quit — force close all without confirmation
}
```

**IPC channels (new):**

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `tearoff:create` | renderer → main | `{ view, screenX, screenY, sourcePanelId, sourceTabIndex }` | Create tear-off window |
| `tearoff:tabRemoved` | main → main-renderer | `{ sourcePanelId, sourceTabIndex }` | Remove tab from source panel |
| `tearoff:confirmClose` | main → tearoff-renderer | `{}` | Ask tear-off for close preference |
| `tearoff:closeConfirmed` | tearoff-renderer → main | `{ action, remember }` | User's close choice |
| `tearoff:tabReturned` | main → main-renderer | `{ view }` | Re-add tab to main window |
| `tearoff:returnToMain` | tearoff-renderer → main | `{ windowId }` | User clicked "Return" button |

### Bounds Persistence

- On `move` and `resize` events (debounced 500ms), save bounds to `tearoff.lastBounds` setting: `{ width, height }`
- Size is reused for the next tear-off creation (position always comes from cursor)
- Not per-view — one shared size for all tear-offs

### What Existing Code Needs to Change

| File | Change |
|------|--------|
| `src/main/index.ts` | Register tearoff handlers, call `closeTearoffWindows()` on quit |
| `src/renderer/src/App.tsx` | Query param check, conditional render `TearoffShell` |
| `src/renderer/src/components/layout/HeaderTab.tsx` | Track `screenX`/`screenY` on `dragover` |
| `src/shared/ipc-channels.ts` | Add 6 new channel types |
| `src/preload/index.ts` | Expose tearoff IPC methods |
| `src/preload/index.d.ts` | Type declarations for new preload methods |

### What Does NOT Change

- All existing view components — they render identically in tear-off windows
- Panel system internals — `panelLayout.ts` mutations are unchanged
- IPC broadcasts — `broadcast.ts` already sends to all `BrowserWindow.getAllWindows()`
- Zustand stores — independent per window, no shared state needed
- Theme system — tear-off inherits same `html` class from theme store init

## Future: Phase 2 (Full Panel System in Tear-offs)

To upgrade from single-view to full panel system:

1. Remove `?view=` check in `App.tsx` — tear-off loads full shell
2. Pass `?layout=<serialized>` instead — initial layout for the window
3. Add cross-window `moveTab` — IPC round-trip through main process to coordinate
4. Persist per-window layouts to `tearoff.layouts` setting

The Phase 1 architecture (query param routing, separate windows, `tearoff-manager.ts`) is fully reusable — Phase 2 only changes what the renderer loads, not the window management layer.

## Testing Strategy

**Unit tests:**
- `useTearoffDrag` hook: boundary detection logic, timer cancellation, screen coordinate tracking
- `tearoff-manager.ts`: window creation, close flow with return/close actions, bounds persistence
- `TearoffShell.tsx`: renders correct view, return button sends IPC, header layout

**Integration tests:**
- IPC round-trip: `tearoff:create` → window spawned → `tearoff:tabRemoved` received
- Close flow: `tearoff:closeConfirmed` with `action='return'` → `tearoff:tabReturned` received
- Bounds persistence: move window → setting updated

**Manual tests:**
- Drag tab off window → new window appears at cursor
- Close tear-off → dialog appears (first time), respects "remember" checkbox
- Return to main → tab re-added to focused panel
- Multi-monitor: tear-off to second monitor, correct positioning
- Theme toggle in main window → tear-off matches (both windows read same localStorage theme)

## Non-Goals

- Cross-window drag (dragging from tear-off back into main) — Phase 2
- Multiple tabs in a tear-off window — Phase 2
- Tear-off state restoration on app restart
- Shared Zustand state between windows

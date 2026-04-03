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
- **Persistence:** Window size saved; tear-offs not restored on app restart. On restart, all views return to the main window layout regardless of tear-off state at quit time.

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
│   └── PanelTabBar.tsx        — track screenX/screenY during drag
```

### Window Lifecycle

#### Creation

1. User drags a tab in the main window
2. `useTearoffDrag` hook detects drag crossing the window boundary (see Drag Detection section)
3. Renderer sends `tearoff:create` IPC: `{ view: View, screenX: number, screenY: number, sourcePanelId: string, sourceTabIndex: number }`
4. Main process creates `BrowserWindow`:
   - Position: `(screenX - 400, screenY - 40)` — offset to place window under cursor
   - Size: `800 x 600` (or last saved size from `tearoff.lastSize` setting)
   - `webPreferences`: **reuse shared constant** extracted from `createWindow()` — must include `contextIsolation: true`, `sandbox: false`, same preload path
   - `setWindowOpenHandler` must also be applied (deny new windows, route to `shell.openExternal`)
   - `titleBarStyle: 'hiddenInset'` (macOS)
5. Window loads: `renderer/index.html?view=agents&windowId=w2`
6. Main process stores in `tearoffWindows: Map<string, { win: BrowserWindow, view: View, parentWindowId: number }>`
7. Main process sends `tearoff:tabRemoved` to the main window: `{ sourcePanelId, sourceTabIndex }`
8. Main window's panel store removes the tab. **If this was the last tab in the root leaf**, replace it with a default view (dashboard) instead of leaving an empty panel.

#### Close (Two-Phase Async)

The `before-close` handler uses `event.preventDefault()` to pause the close, sends an async IPC to the renderer for user choice, then calls `win.destroy()` when the response arrives. A 5-second timeout force-closes the window if the renderer never responds.

1. User closes window (traffic light or Cmd+W)
2. `before-close` fires → `event.preventDefault()` to stop immediate close
3. If `tearoff.closeAction` setting is already set, skip to step 5
4. Main process sends `tearoff:confirmClose` to the tear-off renderer
   - Tear-off shows dialog: "Return this tab to the main window?" with [Return] [Close] and [Remember my choice] checkbox
   - User choice sent back via `tearoff:closeConfirmed` IPC: `{ action: 'return' | 'close', remember: boolean }`
   - If `remember`, persist to `tearoff.closeAction` setting
   - **Timeout:** if no response within 5 seconds, default to `'close'` and force `win.destroy()`
5. If action is `'return'`:
   - Main process sends `tearoff:tabReturned` to main window: `{ view: View }`
   - Main window adds tab to focused panel
6. `win.destroy()` — window is destroyed and removed from `tearoffWindows` map

#### App Quit

- Set an `isQuitting` flag on `before-quit`
- In `before-close`, if `isQuitting` is true, skip confirmation and allow immediate close
- Tear-off views are NOT persisted for restart

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

- No sidebar, no tab bar (single view)
- Minimal header with: view label, "Return to main" button (arrow icon), close button
- macOS traffic light area preserved (80px left padding)
- `-webkit-app-region: drag` on header for window dragging
- Same neon theming (imports same CSS, inherits `html.theme-light` class)
- **Keyboard shortcuts:** `TearoffShell` does NOT register `VIEW_SHORTCUT_MAP` (Cmd+1-7 view switching). Cmd+W is remapped to trigger the close/return flow. Cmd+Q triggers app-wide quit (handled by Electron).

### Store Initialization in Tear-Off Windows

Zustand stores are independent per window. `TearoffShell` only initializes stores required by the specific view being rendered:

| View            | Required Stores                | Skipped Stores                              |
| --------------- | ------------------------------ | ------------------------------------------- |
| Dashboard       | `sprintTasks`, `costData`      | `ide`, `terminal`, `gitTree`, `panelLayout` |
| Agents          | `agentHistory`, `agentEvents`  | `ide`, `terminal`, `gitTree`                |
| IDE             | `ide`, `terminal`              | `agentHistory`, `costData`                  |
| Sprint/Pipeline | `sprintTasks`                  | `ide`, `terminal`, `costData`               |
| PR Station      | `prList` (via IPC)             | `ide`, `terminal`, `sprintTasks`            |
| Source Control  | `gitTree`                      | `ide`, `agentHistory`, `costData`           |
| Settings        | (minimal)                      | Most stores                                 |
| Task Workbench  | `taskWorkbench`, `sprintTasks` | `ide`, `terminal`                           |

Stores that poll (e.g., `sprintTasks`, `costData`) will run their own intervals in the tear-off window. This is acceptable for Phase 1 since tear-offs are expected to be few (1-3 windows).

IPC broadcasts from `broadcast.ts` (using `BrowserWindow.getAllWindows()`) naturally reach all windows — stores that subscribe to IPC events (e.g., `agentEvents` listening for `agent:event`) work without changes.

### Theme Sync Across Windows

Theme is stored in `localStorage` and applied on store init. Cross-window sync via the browser `storage` event — when one window calls `localStorage.setItem('bde-theme', ...)`, other windows receive a `storage` event and can react. The `useThemeStore` init already reads from `localStorage`, so a listener on the `storage` event calling `applyTheme()` is sufficient.

### Drag Detection: `useTearoffDrag` Hook

```typescript
interface TearoffDragState {
  isDragging: boolean
  lastScreenX: number
  lastScreenY: number
  tearoffCreated: boolean // suppresses dragend handling after tear-off
  dragData: { sourcePanelId: string; sourceTabIndex: number; viewKey: View } | null
}
```

**Screen coordinates:** `screenX`/`screenY` are read from `dragover` events (the authoritative source). `dragend` coordinates are unreliable in Chromium (often zero). All position logic uses the last `dragover` coordinates only.

**Detection algorithm:**

1. On `dragstart` of a tab, store the drag payload in hook state, set `tearoffCreated = false`
2. On every `dragover` anywhere in the document, update `lastScreenX`/`lastScreenY`
3. On `dragleave` of `document.documentElement`:
   - Start a 200ms timer (`tearoffTimer`)
   - If `dragenter` fires on `document.documentElement` within 200ms → cancel timer (cursor re-entered window, was just crossing between child elements). This debounce is a known fragility with Chromium's drag event model — 200ms is empirically reliable but not guaranteed.
   - If `dragenter` fires within 200ms → cancel (cursor re-entered)
4. If timer fires (cursor truly left the window):
   - Check `dragData` is set (it's a tab drag, not an external file)
   - Set `tearoffCreated = true`
   - Send `tearoff:create` IPC with `lastScreenX`, `lastScreenY`, and drag payload
5. On `dragend`:
   - If `tearoffCreated` is true → no-op (tear-off already handled)
   - If `tearoffCreated` is false and `dropEffect === 'none'` before timer fires → cancel timer (user dropped onto desktop, not a tear-off)
6. On `dragend` (always): reset all hook state

**Edge cases:**

- Multi-monitor: `screenX`/`screenY` are absolute screen coordinates — works across monitors
- Drag cancelled (Escape key): `dragend` fires, timer cancelled, state reset
- **Last tab in root panel:** If the dragged tab is the only tab in a single-leaf root, the tab is still torn off, but the main window replaces the empty root with a default dashboard view (see Creation step 8)

### Main Process: `tearoff-manager.ts`

```typescript
// Shared webPreferences extracted from createWindow()
export const SHARED_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true
}

interface TearoffWindow {
  win: BrowserWindow
  view: View
  windowId: string
}

const tearoffWindows = new Map<string, TearoffWindow>()
let nextWindowId = 1
let isQuitting = false

export function registerTearoffHandlers(): void {
  ipcMain.handle('tearoff:create', async (_event, payload) => { ... })
  ipcMain.handle('tearoff:closeConfirmed', async (_event, payload) => { ... })
  ipcMain.on('tearoff:returnToMain', (_event, payload) => { ... })
}

export function setQuitting(): void { isQuitting = true }

export function closeTearoffWindows(): void {
  // Called on app quit — force destroy all without confirmation
  for (const { win } of tearoffWindows.values()) {
    win.destroy()
  }
  tearoffWindows.clear()
}
```

**IPC channels (new):**

| Channel                  | Pattern  | Direction               | Payload                                                     | Return         | Purpose                           |
| ------------------------ | -------- | ----------------------- | ----------------------------------------------------------- | -------------- | --------------------------------- |
| `tearoff:create`         | `handle` | renderer → main         | `{ view, screenX, screenY, sourcePanelId, sourceTabIndex }` | `{ windowId }` | Create tear-off window            |
| `tearoff:tabRemoved`     | `send`   | main → main-renderer    | `{ sourcePanelId, sourceTabIndex }`                         | —              | Remove tab from source panel      |
| `tearoff:confirmClose`   | `send`   | main → tearoff-renderer | `{}`                                                        | —              | Ask tear-off for close preference |
| `tearoff:closeConfirmed` | `handle` | tearoff-renderer → main | `{ action: 'return' \| 'close', remember: boolean }`        | `void`         | User's close choice               |
| `tearoff:tabReturned`    | `send`   | main → main-renderer    | `{ view: View }`                                            | —              | Re-add tab to main window         |
| `tearoff:returnToMain`   | `send`   | tearoff-renderer → main | `{ windowId }`                                              | —              | User clicked "Return" button      |

### Bounds Persistence

- On `resize` events only (debounced 500ms), save size to `tearoff.lastSize` setting: `{ width: number, height: number }`
- Size reused for next tear-off creation (position always from cursor)
- Not per-view — one shared size for all tear-offs
- Position is NOT persisted (always determined by cursor drop point)

### What Existing Code Needs to Change

| File                                               | Change                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/index.ts`                                | Register tearoff handlers, call `setQuitting()` on `before-quit`, call `closeTearoffWindows()` on quit. Extract `webPreferences` into shared constant from `SHARED_WEB_PREFERENCES`. |
| `src/renderer/src/App.tsx`                         | Query param check, conditional render `TearoffShell`. Suppress `VIEW_SHORTCUT_MAP` in tear-off mode.                                                                                 |
| `src/renderer/src/components/layout/HeaderTab.tsx` | Track `screenX`/`screenY` on `dragover` for tear-off detection                                                                                                                       |
| `src/shared/ipc-channels.ts`                       | Add 6 new channel type definitions with full type signatures                                                                                                                         |
| `src/preload/index.ts`                             | Expose tearoff IPC methods via `contextBridge`                                                                                                                                       |
| `src/preload/index.d.ts`                           | Type declarations for new preload methods                                                                                                                                            |
| `src/renderer/src/stores/theme.ts`                 | Add `storage` event listener for cross-window theme sync                                                                                                                             |
| `src/main/handlers/__tests__/*`                    | Update handler count tests to include new tearoff handler registrations                                                                                                              |

### What Does NOT Change

- All existing view components — they render identically in tear-off windows
- Panel system internals — `panelLayout.ts` mutations are unchanged (except last-tab-replacement logic)
- IPC broadcasts — `broadcast.ts` already sends to all `BrowserWindow.getAllWindows()`
- Existing drag-and-drop within a window — `useTearoffDrag` only activates when cursor leaves the window boundary

## Future: Phase 2 (Full Panel System in Tear-offs)

To upgrade from single-view to full panel system:

1. Remove `?view=` check in `App.tsx` — tear-off loads full shell
2. Pass `?layout=<serialized>` instead — initial layout for the window
3. Add cross-window `moveTab` — IPC round-trip through main process to coordinate
4. Persist per-window layouts to `tearoff.layouts` setting
5. Consolidate polling — shared store subscriptions via `MessagePort` to avoid duplicate API load

The Phase 1 architecture (query param routing, separate windows, `tearoff-manager.ts`) is fully reusable — Phase 2 only changes what the renderer loads, not the window management layer.

## Testing Strategy

**Unit tests:**

- `useTearoffDrag` hook: structure hook as a state machine so the timer/event logic can be tested without real DOM drag events. Test: state transitions, timer cancellation, `tearoffCreated` flag suppression.
- `tearoff-manager.ts`: window creation, two-phase close flow with return/close actions, 5s timeout force-close, bounds persistence, `isQuitting` bypass
- `TearoffShell.tsx`: renders correct view for `?view=` param, return button sends IPC, header layout, suppresses view shortcuts

**Integration tests:**

- IPC round-trip: `tearoff:create` → window spawned → `tearoff:tabRemoved` received
- Close flow: `tearoff:closeConfirmed` with `action='return'` → `tearoff:tabReturned` received
- Last-tab tear-off: source panel replaced with dashboard
- Handler count: update existing handler count tests for new tearoff registrations

**Manual tests:**

- Drag tab off window → new window appears at cursor position
- Close tear-off → dialog appears (first time), respects "Remember" checkbox
- Return to main → tab re-added to focused panel
- Drag last tab off → main window shows dashboard, tear-off shows the view
- Multi-monitor: tear-off to second monitor, correct positioning
- Theme toggle in main window → tear-off updates via storage event
- Cmd+W in tear-off → triggers close/return flow (not app quit)
- Cmd+Q in tear-off → quits entire app (all windows close without confirmation)

## Non-Goals

- Cross-window drag (dragging from tear-off back into main) — Phase 2
- Multiple tabs in a tear-off window — Phase 2
- Tear-off state restoration on app restart
- Shared Zustand state between windows
- Drag from sidebar items (only panel/header tabs support tear-off)

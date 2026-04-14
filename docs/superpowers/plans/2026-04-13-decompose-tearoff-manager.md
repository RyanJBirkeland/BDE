# tearoff-manager Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose tearoff-manager.ts (633L) into tearoff-window-manager, tearoff-state-persistence, cross-window-drag-coordinator, tearoff-handlers, and thin re-export shim.

**Architecture:** tearoff-manager.ts currently owns four independent concerns: window lifecycle management (BrowserWindow creation, setup, close flow), bounds persistence with debounce, cross-window drag coordination with cursor polling, and IPC handler registration. We mechanically split these into focused modules, with tearoff-handlers as the orchestrator and the original file becoming a backward-compat re-export. No behavior changes—internal state isolation only.

**Tech Stack:** TypeScript, Electron main process, Vitest

---

## Task 1: Create `tearoff-window-manager.ts`

**Files:**
- Create: `src/main/tearoff-window-manager.ts`
- Modify: `src/main/tearoff-manager.ts`

- [ ] Read tearoff-manager.ts and identify window lifecycle code (lines 33–234)
- [ ] Extract the following to `src/main/tearoff-window-manager.ts`:
  - Interface: `TearoffEntry` (lines 33–38)
  - Interface: `PersistedTearoff` (lines 40–44)
  - Module state: `const tearoffWindows = new Map<string, TearoffEntry>()`
  - Module state: `let isQuitting = false`
  - Function: `setQuitting()` (lines 57–59)
  - Function: `_resetForTest()` (lines 62–72) — keep all tearoffWindows cleanup, remove drag/timer cleanup (those go to their own modules)
  - Function: `closeTearoffWindows()` (lines 75–85)
  - Function: `getMainWindow()` (lines 88–92)
  - Function: `loadTearoffUrl()` (lines 98–106)
  - Function: `persistTearoffState()` (lines 108–117) — BUT modify: accept a callback parameter `onPersist: (state: PersistedTearoff[]) => void` instead of calling `setSettingJson()` directly
  - Function: `persistBoundsDebounced()` (lines 119–129) — BUT modify: accept callback parameter and timer cleanup callback
  - Function: `isOnScreen()` (lines 131–141)
  - Function: `getDefaultBounds()` (lines 143–151)
  - Function: `setupTearoffWindow()` (lines 154–181) — BUT modify: accept `onPersistBounds: (windowId: string) => void` callback instead of calling `persistBoundsDebounced()` directly
  - Function: `handleCloseRequest()` (lines 183–207)
  - Function: `askRendererForAction()` (lines 209–225)
  - Function: `clearResizeTimer()` (lines 227–233) — BUT modify: accept timer cleanup callback
  - Function: `restoreTearoffWindows()` (lines 240–284)
  - Exports: `exportTearoffState()` helper that returns the array needed for persistence
- [ ] Props/interface for the module:
  - Input: `onPersistBounds: (windowId: string, state: PersistedTearoff[]) => void` callback for debounced bounds save
  - State owned: `tearoffWindows: Map`, `isQuitting: boolean`
  - Key logic: Window creation, setup, close dialog flow, restoration from persisted state
- [ ] Add function signatures:
  ```typescript
  export function setQuitting(): void
  export function closeTearoffWindows(onPersist: (state: PersistedTearoff[]) => void): void
  export function getMainWindow(): BrowserWindow | null
  export function setupTearoffWindow(win: BrowserWindow, windowId: string, onPersistBounds: (windowId: string) => void): void
  export function handleCloseRequest(windowId: string, win: BrowserWindow): Promise<void>
  export function restoreTearoffWindows(onPersist: (state: PersistedTearoff[]) => void): void
  export function getEntries(): TearoffEntry[]
  export function getEntry(windowId: string): TearoffEntry | undefined
  export function deleteEntry(windowId: string): void
  ```
- [ ] Run `npm run typecheck` — fix errors (tearoff-manager.ts will have import errors until Task 4 wires them)
- [ ] Commit: `git add -A && git commit -m "refactor: extract tearoff-window-manager from tearoff-manager"`

---

## Task 2: Create `tearoff-state-persistence.ts`

**Files:**
- Create: `src/main/tearoff-state-persistence.ts`
- Modify: `src/main/tearoff-manager.ts`

- [ ] Read tearoff-manager.ts lines 49–129 (debounce timers and persistence logic)
- [ ] Extract the following to `src/main/tearoff-state-persistence.ts`:
  - Module state: `const resizeTimers = new Map<string, ReturnType<typeof setTimeout>>()`
  - Function: `persistBoundsDebounced(windowId: string, _win: BrowserWindow, callback: (state: any) => void): void` — receives a callback to invoke after debounce fires
  - Function: `clearResizeTimer(windowId: string): void`
  - Function: `_resetForTest()` for timer cleanup only
  - Helper: `saveTearoffState(state: PersistedTearoff[]): void` — calls `setSettingJson('tearoff.windows', state)`
  - Exports: `scheduleBoundsUpdate(windowId: string, getState: () => PersistedTearoff[], callback: (state: PersistedTearoff[]) => void): void`
- [ ] Props/interface:
  - Receives: Callback to invoke when bounds should be persisted
  - State owned: `resizeTimers: Map`
  - Key logic: Debounce logic with 500ms delay, timer cleanup
- [ ] The module does NOT import Electron—purely state + timer management
- [ ] Run `npm run typecheck` — fix errors
- [ ] Commit: `git add -A && git commit -m "refactor: extract tearoff-state-persistence from tearoff-manager"`

---

## Task 3: Create `cross-window-drag-coordinator.ts`

**Files:**
- Create: `src/main/cross-window-drag-coordinator.ts`
- Modify: `src/main/tearoff-manager.ts`

- [ ] Read tearoff-manager.ts lines 287–419 (drag coordinator)
- [ ] Extract the following to `src/main/cross-window-drag-coordinator.ts`:
  - Interface: `ActiveDrag` (lines 290–299)
  - Module state: `let activeDrag: ActiveDrag | null = null`
  - Function: `findWindowAtPoint()` (lines 303–317)
  - Function: `startCursorPolling()` (lines 319–361)
  - Function: `handleStartCrossWindowDrag()` (lines 363–419)
  - Function: `handleDropComplete()` (lines 421–443)
  - Function: `cancelActiveDrag()` (lines 445–459)
  - Function: `_resetForTest()` for drag-only cleanup
- [ ] Props/interface:
  - State owned: `activeDrag: ActiveDrag | null`
  - Key logic: Cursor polling at `CURSOR_POLL_INTERVAL_MS`, window hit-testing, drag state machine
  - Imports from Electron: `BrowserWindow`, `screen`
- [ ] Function signatures:
  ```typescript
  export function handleStartCrossWindowDrag(windowId: string, viewKey: string): { targetFound: boolean }
  export function handleDropComplete(payload: { view: string; targetPanelId: string; zone: string }): void
  export function cancelActiveDrag(): void
  export function getActiveDrag(): ActiveDrag | null
  export function _resetForTest(): void
  ```
- [ ] Run `npm run typecheck` — fix errors
- [ ] Commit: `git add -A && git commit -m "refactor: extract cross-window-drag-coordinator from tearoff-manager"`

---

## Task 4: Create `tearoff-handlers.ts`

**Files:**
- Create: `src/main/tearoff-handlers.ts`
- Modify: `src/main/tearoff-manager.ts`

- [ ] Read tearoff-manager.ts lines 465–633 (IPC handler registration)
- [ ] Create `src/main/tearoff-handlers.ts` with:
  - Imports from three extracted modules: tearoff-window-manager, tearoff-state-persistence, cross-window-drag-coordinator
  - Function: `registerTearoffHandlers()` (lines 465–633) — orchestrates all IPC setup
  - IPC channels: `'tearoff:create'`, `'tearoff:closeConfirmed'`, `'tearoff:startCrossWindowDrag'`, `'tearoff:dropComplete'`, `'tearoff:dragCancelFromRenderer'`, `'tearoff:viewsChanged'`, `'tearoff:returnAll'`, `'tearoff:returnToMain'`
  - All IPC channel strings MUST come from `src/shared/ipc-channels/` — do NOT add new inline strings
  - Constraint: The handlers module itself owns NO state; it orchestrates calls to the three modules above
- [ ] Props/interface:
  - Receives: callbacks from tearoff-window-manager and tearoff-state-persistence
  - Returns: void (registers handlers as side effect)
  - Key logic: Wires up IPC listeners → module function calls
- [ ] Detailed wire-up for each handler:
  - `tearoff:create` → calls `setupTearoffWindow()` + `loadTearoffUrl()` + `persistBoundsDebounced()`
  - `tearoff:closeConfirmed` → calls `handleCloseRequest()` via dynamic response channel
  - `tearoff:startCrossWindowDrag` → delegates to `handleStartCrossWindowDrag()`
  - `tearoff:dropComplete` → delegates to `handleDropComplete()`
  - `tearoff:dragCancelFromRenderer` → delegates to `cancelActiveDrag()`
  - `tearoff:viewsChanged` → updates entry + calls `persistBoundsDebounced()`
  - `tearoff:returnAll` / `tearoff:returnToMain` → calls module functions
- [ ] Run `npm run typecheck` — fix errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract tearoff-handlers from tearoff-manager"`

---

## Task 5: Refactor tearoff-manager.ts to re-export shim

**Files:**
- Modify: `src/main/tearoff-manager.ts`

- [ ] After Task 4 completes, tearoff-manager.ts becomes a thin re-export file
- [ ] Content:
  ```typescript
  /**
   * tearoff-manager.ts — Backward-compat re-export shim.
   * All logic moved to:
   * - tearoff-window-manager.ts (window lifecycle)
   * - tearoff-state-persistence.ts (bounds debounce)
   * - cross-window-drag-coordinator.ts (cursor polling, drag IPC)
   * - tearoff-handlers.ts (handler registration orchestrator)
   */
  
  import { setQuitting, closeTearoffWindows, getMainWindow, restoreTearoffWindows, SHARED_WEB_PREFERENCES } from './tearoff-window-manager'
  import { registerTearoffHandlers } from './tearoff-handlers'
  
  export {
    setQuitting,
    closeTearoffWindows,
    getMainWindow,
    restoreTearoffWindows,
    registerTearoffHandlers,
    SHARED_WEB_PREFERENCES
  }
  ```
- [ ] Verify all public API is re-exported:
  - `setQuitting()`
  - `closeTearoffWindows()`
  - `getMainWindow()`
  - `restoreTearoffWindows()`
  - `registerTearoffHandlers()`
  - `SHARED_WEB_PREFERENCES`
  - `_resetForTest()` (if test imports exist)
- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm test` — all tests pass, especially tearoff tests
- [ ] Run `npm run lint` — no issues
- [ ] Verify no other files import from the extracted modules directly (should all go through shim)
- [ ] Commit: `git add -A && git commit -m "refactor: reduce tearoff-manager to re-export shim"`

---

## Implementation Notes

### Module Wiring

The four extracted modules are independent, but `tearoff-handlers.ts` orchestrates them:

```
tearoff-handlers.ts (orchestrator)
  ├─ tearoff-window-manager.ts (window lifecycle)
  ├─ tearoff-state-persistence.ts (bounds persistence)
  └─ cross-window-drag-coordinator.ts (drag coordination)

tearoff-manager.ts (re-exports)
  └─ All four modules
```

### Callback Pattern for Bounds Persistence

Instead of `tearoff-window-manager` importing persistence directly, we pass a callback:

```typescript
// BAD: circular / tight coupling
export function setupTearoffWindow(win: BrowserWindow, windowId: string) {
  win.on('resize', () => persistBoundsDebounced(windowId, win))
}

// GOOD: received as callback
export function setupTearoffWindow(
  win: BrowserWindow,
  windowId: string,
  onPersistBounds: (windowId: string) => void
) {
  win.on('resize', () => onPersistBounds(windowId))
}
```

This keeps tearoff-window-manager focused on windows, not persistence.

### IPC Channel Strings

All IPC channel names must come from `src/shared/ipc-channels/`. Review that file and import constants instead of hardcoding:

```typescript
// BAD:
ipcMain.on('tearoff:create', ...)

// GOOD:
import { TEAROFF_CREATE } from '../shared/ipc-channels'
ipcMain.on(TEAROFF_CREATE, ...)
```

If `src/shared/ipc-channels/` doesn't have these constants, create them there FIRST before Task 4.

### Timer Cleanup in _resetForTest

Each module has a `_resetForTest()` that cleans up its own state:

```typescript
// tearoff-window-manager.ts
export function _resetForTest() {
  tearoffWindows.clear()
  isQuitting = false
}

// tearoff-state-persistence.ts
export function _resetForTest() {
  for (const timer of resizeTimers.values()) clearTimeout(timer)
  resizeTimers.clear()
}

// cross-window-drag-coordinator.ts
export function _resetForTest() {
  if (activeDrag) {
    if (activeDrag.pollInterval !== null) clearInterval(activeDrag.pollInterval)
    clearTimeout(activeDrag.timeout)
  }
  activeDrag = null
}
```

The shim's `_resetForTest()` (if needed) calls all three:

```typescript
export function _resetForTest() {
  setQuittingForTest(false) // from window-manager
  resetPersistence() // from persistence
  resetDrag() // from drag-coordinator
}
```

### Dynamic IPC Channels

The `askRendererForAction()` function (line 209) creates a dynamic channel: `tearoff:closeResponse:${windowId}`. This pattern is kept in tearoff-window-manager and used by tearoff-handlers.

---

## Success Criteria

- All four modules created with proper separation of concerns
- `tearoff-manager.ts` reduced to ≤30 lines (thin shim)
- `npm run typecheck` passes with zero errors
- `npm test` passes with zero regressions
- No circular dependencies between extracted modules
- All IPC channel strings imported from `src/shared/ipc-channels/`
- Bounds persistence works via callbacks, not direct module imports
- Each module has its own `_resetForTest()` for test isolation
- Original public API unchanged (all functions still accessible via shim)

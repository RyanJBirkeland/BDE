# Tear-Off State Restoration — Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Prerequisite:** Tear-off Phase 1 (merged), Cross-window drag (PR #565 merged), Multi-tab tear-offs (PR #566)

## Overview

Automatically restore tear-off windows on app restart. Each tear-off's views and window bounds are persisted to a SQLite setting. On startup, tear-offs silently reappear at their last positions. Only tear-offs that were open at quit time are restored — manually closed tear-offs stay closed.

## Requirements

- **Automatic restoration:** Tear-off windows reappear silently on app restart
- **Views only:** Each tear-off restores its view list as tabs (no split layout preserved)
- **Bounds preserved:** Window size and position restored from last known bounds
- **Graceful degradation:** If a persisted view no longer exists or bounds are off-screen, handle gracefully
- **No prompt:** No "Restore windows?" dialog — just restore silently

## Architecture

### Persistence

**Setting key:** `tearoff.windows` (JSON array in SQLite settings table)

**Schema:**
```typescript
interface PersistedTearoff {
  windowId: string
  views: string[]       // View keys (e.g., ['agents', 'settings'])
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}
```

**When to persist:** On every change that affects tear-off state:
- Tear-off created → add to array
- Tear-off closed (close action, not return) → remove from array
- Tear-off returned to main → remove from array
- Tab added/removed in tear-off → update views array
- Window moved/resized → update bounds (debounced 500ms, already exists for size)

**When to restore:** In `app.whenReady()`, after main window is created, before agent manager starts.

### Save Flow

The main process `tearoff-manager.ts` already tracks `tearoffWindows: Map<string, TearoffEntry>`. Extend `TearoffEntry` with `views: string[]` and add a `persistTearoffState()` function that serializes the current map to the setting.

The tricky part: the main process doesn't know which views a tear-off has (that state lives in the renderer's `panelLayout` store). Two approaches:

**Approach A (chosen): Renderer notifies main on view changes.**
Add a `tearoff:viewsChanged` IPC channel. The tear-off renderer sends its current view list whenever the panel store changes (debounced). Main process updates its `TearoffEntry.views` and persists.

This is simpler than the alternative (main process querying renderer), and the tear-off already sends IPC for other state changes.

### Restore Flow

1. `app.whenReady()` → after `createWindow()` (main window)
2. Read `tearoff.windows` setting
3. For each entry, validate:
   - `views` array is non-empty
   - `bounds` are within current screen geometry (use `screen.getAllDisplays()`)
4. Create `BrowserWindow` for each valid entry (same as `tearoff:create` but with known bounds)
5. Load URL with `?view=<first-view>&windowId=<id>&restore=<JSON views>`
6. The tear-off renderer reads the `restore` param, initializes its store with all views as tabs

### Bounds Validation

On restore, check if the saved bounds overlap with any display:
```typescript
function isOnScreen(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(display => {
    const db = display.bounds
    return bounds.x < db.x + db.width && bounds.x + bounds.width > db.x &&
           bounds.y < db.y + db.height && bounds.y + bounds.height > db.y
  })
}
```

If not on screen (e.g., external monitor disconnected), fall back to centering on the primary display.

### What Changes

| File | Change |
|------|--------|
| `src/main/tearoff-manager.ts` | Extend TearoffEntry with views, add persistTearoffState(), restoreTearoffWindows(), handle tearoff:viewsChanged, update persist on create/close/return |
| `src/main/index.ts` | Call restoreTearoffWindows() after createWindow() in app.whenReady() |
| `src/renderer/src/components/layout/TearoffShell.tsx` | Read `restore` query param, initialize store with multiple views, send tearoff:viewsChanged on store changes |
| `src/preload/index.ts` + `.d.ts` | Add `viewsChanged` method |
| `src/shared/ipc-channels.ts` | No change (send channel, not in typed map) |

### What Does NOT Change

- Main window — no restoration logic needed (already persists its own layout)
- Cross-window drag — works the same after restoration
- PanelRenderer/PanelLeaf — unaffected
- Close/return flows — just need to call persistTearoffState() after the action

## Edge Cases

**App quit with tear-offs open:** `before-quit` → `setQuitting()` → tear-offs close without confirmation → persist state before destroying windows (persist BEFORE closeTearoffWindows).

**No tear-offs at quit:** `tearoff.windows` is set to `[]` — restore is a no-op.

**View removed from codebase:** If a persisted view key doesn't match the `View` union, skip it. If all views in a tear-off are invalid, skip that window.

**Display layout changed:** Bounds validation catches off-screen windows and recenters them.

**Multiple restarts:** Each quit overwrites the previous state — no accumulation.

**Tear-off closed manually before quit:** Already removed from `tearoffWindows` map, so it won't be in the persisted state.

## Testing Strategy

**Unit tests:**
- `persistTearoffState()`: serializes current map to setting correctly
- `restoreTearoffWindows()`: creates windows from persisted state, skips invalid entries
- Bounds validation: on-screen → keep, off-screen → recenter
- `tearoff:viewsChanged` handler updates entry

**Integration tests:**
- Full cycle: create tear-off → quit → restore → verify window created with correct views

**Manual tests:**
- Open 2 tear-offs with different views → quit → restart → both reappear
- Open tear-off on second monitor → disconnect monitor → restart → window on primary display
- Close a tear-off → quit → restart → only remaining tear-off restored
- Multi-tab tear-off → quit → restart → all tabs restored

## Non-Goals

- Restoring split layouts within tear-offs (views restore as tabs in a single panel)
- Restoring scroll positions or editor state within views
- Prompting user before restoration

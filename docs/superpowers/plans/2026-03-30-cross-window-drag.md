# Cross-Window Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable dragging tabs between BDE windows (tear-off ↔ main, tear-off ↔ tear-off) with 5-zone drop targeting.

**Architecture:** IPC relay through main process. Source window detects drag exit, main process polls cursor position at 32ms and relays coordinates to the target window. Target renders a synthetic overlay with `pointer-events: all` that captures `pointerup` for drop commitment. Reuses existing `getDropZone()` for 5-zone hit testing.

**Tech Stack:** Electron screen API, IPC (handle/send), React hooks, pointer events

**Spec:** `docs/superpowers/specs/2026-03-30-cross-window-drag-design.md`

---

## File Map

| File                                                            | Action                 | Responsibility                                                |
| --------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| `src/shared/ipc-channels.ts`                                    | Modify (lines 299-308) | Add 7 cross-window drag channels to TearoffChannels           |
| `src/preload/index.ts`                                          | Modify (lines 265-288) | Add drag IPC methods to tearoff namespace                     |
| `src/preload/index.d.ts`                                        | Modify (lines 233-241) | Type declarations for new methods                             |
| `src/main/tearoff-manager.ts`                                   | Modify (lines 166-313) | Add drag coordinator (polling, relay, cancel)                 |
| `src/renderer/src/hooks/useTearoffDrag.ts`                      | Modify (lines 59-73)   | Cross-window branching in timer-fires logic                   |
| `src/renderer/src/hooks/useCrossWindowDrop.ts`                  | Create                 | Hook to receive cross-window drags                            |
| `src/renderer/src/components/panels/CrossWindowDropOverlay.tsx` | Create                 | Full-window overlay with 5-zone targeting + pointerup capture |
| `src/renderer/src/App.tsx`                                      | Modify (lines 140-157) | Mount useCrossWindowDrop, listen for crossWindowDrop          |
| `src/renderer/src/components/layout/TearoffShell.tsx`           | Modify (lines 92-133)  | Mount useCrossWindowDrop, handle dragDone → close             |

**Test files:**

| File                                                                           | Tests                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `src/main/__tests__/tearoff-drag-coordinator.test.ts`                          | Polling, target detection, relay, cancel, timeout |
| `src/renderer/src/hooks/__tests__/useCrossWindowDrop.test.ts`                  | State transitions, pointerup → dropComplete       |
| `src/renderer/src/components/panels/__tests__/CrossWindowDropOverlay.test.tsx` | Zone detection, visual highlights                 |

---

### Task 1: IPC Channel Definitions for Cross-Window Drag

**Files:**

- Modify: `src/shared/ipc-channels.ts:299-308`

- [ ] **Step 1: Add cross-window drag channels to TearoffChannels**

In `src/shared/ipc-channels.ts`, expand the `TearoffChannels` interface (line 299) to include the 7 new channels:

```typescript
export interface TearoffChannels {
  // Phase 1 (existing)
  'tearoff:create': {
    args: [
      {
        view: string
        screenX: number
        screenY: number
        sourcePanelId: string
        sourceTabIndex: number
      }
    ]
    result: { windowId: string }
  }
  'tearoff:closeConfirmed': {
    args: [{ action: 'return' | 'close'; remember: boolean }]
    result: void
  }
  // Phase 2: Cross-window drag
  'tearoff:startCrossWindowDrag': {
    args: [{ windowId: string; viewKey: string }]
    result: { targetFound: boolean }
  }
}
```

Note: Only `handle`-pattern channels go in `IpcChannelMap`. The `send`-pattern channels (`tearoff:dragIn`, `tearoff:dragMove`, `tearoff:dragCancel`, `tearoff:dropComplete`, `tearoff:crossWindowDrop`, `tearoff:dragDone`) are fire-and-forget and don't need type entries — they're typed at the preload layer.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat(tearoff): add cross-window drag IPC channel types"
```

---

### Task 2: Preload Bridge — Cross-Window Drag Methods

**Files:**

- Modify: `src/preload/index.ts:265-288`
- Modify: `src/preload/index.d.ts:233-241`

- [ ] **Step 1: Add methods to preload tearoff namespace**

In `src/preload/index.ts`, add to the `tearoff` object (after existing methods, ~line 287):

```typescript
// Cross-window drag
startCrossWindowDrag: (payload: { windowId: string; viewKey: string }) =>
  typedInvoke('tearoff:startCrossWindowDrag', payload),
onDragIn: (cb: (payload: { viewKey: string; localX: number; localY: number }) => void) => {
  const handler = (_e: IpcRendererEvent, payload: { viewKey: string; localX: number; localY: number }) => cb(payload)
  ipcRenderer.on('tearoff:dragIn', handler)
  return () => { ipcRenderer.removeListener('tearoff:dragIn', handler) }
},
onDragMove: (cb: (payload: { localX: number; localY: number }) => void) => {
  const handler = (_e: IpcRendererEvent, payload: { localX: number; localY: number }) => cb(payload)
  ipcRenderer.on('tearoff:dragMove', handler)
  return () => { ipcRenderer.removeListener('tearoff:dragMove', handler) }
},
onDragCancel: (cb: () => void) => {
  const handler = () => cb()
  ipcRenderer.on('tearoff:dragCancel', handler)
  return () => { ipcRenderer.removeListener('tearoff:dragCancel', handler) }
},
sendDropComplete: (payload: { viewKey: string; targetPanelId: string; zone: string }) =>
  ipcRenderer.send('tearoff:dropComplete', payload),
onCrossWindowDrop: (cb: (payload: { view: string; targetPanelId: string; zone: string }) => void) => {
  const handler = (_e: IpcRendererEvent, payload: { view: string; targetPanelId: string; zone: string }) => cb(payload)
  ipcRenderer.on('tearoff:crossWindowDrop', handler)
  return () => { ipcRenderer.removeListener('tearoff:crossWindowDrop', handler) }
},
onDragDone: (cb: () => void) => {
  const handler = () => cb()
  ipcRenderer.on('tearoff:dragDone', handler)
  return () => { ipcRenderer.removeListener('tearoff:dragDone', handler) }
},
sendDragCancel: () => ipcRenderer.send('tearoff:dragCancelFromRenderer'),
```

- [ ] **Step 2: Add matching type declarations to index.d.ts**

In `src/preload/index.d.ts`, add to the `tearoff` type (after existing declarations, ~line 240):

```typescript
// Cross-window drag
startCrossWindowDrag: (payload: { windowId: string; viewKey: string }) => Promise<{ targetFound: boolean }>
onDragIn: (cb: (payload: { viewKey: string; localX: number; localY: number }) => void) => () => void
onDragMove: (cb: (payload: { localX: number; localY: number }) => void) => () => void
onDragCancel: (cb: () => void) => () => void
sendDropComplete: (payload: { viewKey: string; targetPanelId: string; zone: string }) => void
onCrossWindowDrop: (cb: (payload: { view: string; targetPanelId: string; zone: string }) => void) => () => void
onDragDone: (cb: () => void) => () => void
sendDragCancel: () => void
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(tearoff): preload bridge for cross-window drag IPC"
```

---

### Task 3: Main Process — Drag Coordinator

**Files:**

- Modify: `src/main/tearoff-manager.ts:166-313`
- Create: `src/main/__tests__/tearoff-drag-coordinator.test.ts`

- [ ] **Step 1: Write coordinator tests**

Create `src/main/__tests__/tearoff-drag-coordinator.test.ts` with tests for:

- `handleStartCrossWindowDrag` returns `{ targetFound: true }` when cursor is over another window
- `handleStartCrossWindowDrag` returns `{ targetFound: false }` when cursor is over desktop
- Polling sends `tearoff:dragMove` with local coords to target window
- Polling sends `tearoff:dragCancel` when cursor leaves target
- `handleDropComplete` sends `tearoff:dragDone` to source and `tearoff:crossWindowDrop` to target
- `cancelDrag` stops polling and sends `tearoff:dragCancel` to all windows
- 10-second timeout auto-cancels
- Source window destroyed mid-drag → auto-cancel

Mock: `electron` (screen, BrowserWindow, ipcMain), `../settings`, `../logger`

- [ ] **Step 2: Implement coordinator in tearoff-manager.ts**

Add to `src/main/tearoff-manager.ts`, after existing code but before `registerTearoffHandlers`:

```typescript
// ---------------------------------------------------------------------------
// Cross-window drag coordinator
// ---------------------------------------------------------------------------

import { screen } from 'electron'

interface ActiveDrag {
  sourceWindowId: string
  sourceWin: BrowserWindow
  viewKey: string
  pollInterval: ReturnType<typeof setInterval>
  targetWinId: number | null
  lastSentX: number
  lastSentY: number
  timeout: ReturnType<typeof setTimeout>
}

let activeDrag: ActiveDrag | null = null

function findWindowAtPoint(x: number, y: number, excludeWinId?: number): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.id === excludeWinId || win.isDestroyed()) continue
    const bounds = win.getContentBounds()
    if (
      x >= bounds.x &&
      x < bounds.x + bounds.width &&
      y >= bounds.y &&
      y < bounds.y + bounds.height
    ) {
      return win
    }
  }
  return null
}

function startCursorPolling(): void {
  if (!activeDrag) return

  activeDrag.pollInterval = setInterval(() => {
    if (!activeDrag) return

    const cursor = screen.getCursorScreenPoint()
    const sourceWinId = activeDrag.sourceWin.isDestroyed() ? undefined : activeDrag.sourceWin.id
    const targetWin = findWindowAtPoint(cursor.x, cursor.y, sourceWinId)

    if (targetWin && !targetWin.isDestroyed()) {
      const contentBounds = targetWin.getContentBounds()
      const localX = cursor.x - contentBounds.x
      const localY = cursor.y - contentBounds.y

      if (targetWin.id !== activeDrag.targetWinId) {
        // Cursor entered a new target window
        if (activeDrag.targetWinId !== null) {
          // Cancel previous target
          const prevWin = BrowserWindow.fromId(activeDrag.targetWinId)
          if (prevWin && !prevWin.isDestroyed()) {
            prevWin.webContents.send('tearoff:dragCancel')
          }
        }
        activeDrag.targetWinId = targetWin.id
        targetWin.webContents.send('tearoff:dragIn', {
          viewKey: activeDrag.viewKey,
          localX,
          localY
        })
        activeDrag.lastSentX = localX
        activeDrag.lastSentY = localY
      } else if (localX !== activeDrag.lastSentX || localY !== activeDrag.lastSentY) {
        // Same target, cursor moved
        targetWin.webContents.send('tearoff:dragMove', { localX, localY })
        activeDrag.lastSentX = localX
        activeDrag.lastSentY = localY
      }
    } else if (activeDrag.targetWinId !== null) {
      // Cursor left all windows
      const prevWin = BrowserWindow.fromId(activeDrag.targetWinId)
      if (prevWin && !prevWin.isDestroyed()) {
        prevWin.webContents.send('tearoff:dragCancel')
      }
      activeDrag.targetWinId = null
    }
  }, 32)
}

function cancelActiveDrag(): void {
  if (!activeDrag) return

  clearInterval(activeDrag.pollInterval)
  clearTimeout(activeDrag.timeout)

  // Cancel all windows
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('tearoff:dragCancel')
    }
  }

  activeDrag = null
}

export function handleStartCrossWindowDrag(
  sourceWindowId: string,
  viewKey: string
): { targetFound: boolean } {
  // Clean up any existing drag
  if (activeDrag) cancelActiveDrag()

  const sourceEntry = tearoffWindows.get(sourceWindowId)
  const sourceWin = sourceEntry?.win ?? getMainWindow()
  if (!sourceWin || sourceWin.isDestroyed()) return { targetFound: false }

  const cursor = screen.getCursorScreenPoint()
  const targetWin = findWindowAtPoint(cursor.x, cursor.y, sourceWin.id)

  if (!targetWin) return { targetFound: false }

  activeDrag = {
    sourceWindowId,
    sourceWin,
    viewKey,
    pollInterval: 0 as unknown as ReturnType<typeof setInterval>,
    targetWinId: null,
    lastSentX: 0,
    lastSentY: 0,
    timeout: setTimeout(() => cancelActiveDrag(), 10000)
  }

  // Listen for source window closing mid-drag
  sourceWin.once('closed', () => {
    if (activeDrag?.sourceWindowId === sourceWindowId) {
      cancelActiveDrag()
    }
  })

  startCursorPolling()
  return { targetFound: true }
}

function handleDropComplete(payload: {
  viewKey: string
  targetPanelId: string
  zone: string
}): void {
  if (!activeDrag) return

  const { sourceWin, viewKey } = activeDrag

  // Notify source window the drag is done
  if (!sourceWin.isDestroyed()) {
    sourceWin.webContents.send('tearoff:dragDone')
  }

  // Find target window and send the drop command
  if (activeDrag.targetWinId !== null) {
    const targetWin = BrowserWindow.fromId(activeDrag.targetWinId)
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('tearoff:crossWindowDrop', {
        view: viewKey,
        targetPanelId: payload.targetPanelId,
        zone: payload.zone
      })
    }
  }

  clearInterval(activeDrag.pollInterval)
  clearTimeout(activeDrag.timeout)
  activeDrag = null
}
```

- [ ] **Step 3: Register new IPC handlers**

Inside `registerTearoffHandlers()` (after existing handlers), add:

```typescript
// Cross-window drag
ipcMain.handle(
  'tearoff:startCrossWindowDrag',
  (_event, payload: { windowId: string; viewKey: string }) => {
    return handleStartCrossWindowDrag(payload.windowId, payload.viewKey)
  }
)

ipcMain.on(
  'tearoff:dropComplete',
  (_event, payload: { viewKey: string; targetPanelId: string; zone: string }) => {
    handleDropComplete(payload)
  }
)

ipcMain.on('tearoff:dragCancelFromRenderer', () => {
  cancelActiveDrag()
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/__tests__/tearoff-drag-coordinator.test.ts --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/tearoff-manager.ts src/main/__tests__/tearoff-drag-coordinator.test.ts
git commit -m "feat(tearoff): cross-window drag coordinator in main process"
```

---

### Task 4: CrossWindowDropOverlay Component

**Files:**

- Create: `src/renderer/src/components/panels/CrossWindowDropOverlay.tsx`
- Create: `src/renderer/src/components/panels/__tests__/CrossWindowDropOverlay.test.tsx`

- [ ] **Step 1: Write tests**

Test the overlay:

- Renders nothing when `active` is false
- Renders full-screen overlay when `active` is true
- Shows correct zone highlight based on localX/localY
- Calls `onDrop(panelId, zone)` on pointerup

- [ ] **Step 2: Implement CrossWindowDropOverlay**

Reuses `getDropZone()` from `PanelDropOverlay.tsx` (line 30). The overlay:

- `position: fixed; inset: 0; z-index: 9999; pointer-events: all` — captures pointerup
- Walks panel DOM to find which `[data-panel-id]` element contains `(localX, localY)`
- Calls `getDropZone(localX, localY, panelRect)` for 5-zone detection
- Shows highlight (same visual as `PanelDropOverlay`)
- On `pointerup` → calls `onDrop(panelId, zone)`

```typescript
interface CrossWindowDropOverlayProps {
  active: boolean
  localX: number
  localY: number
  viewKey: string
  onDrop: (targetPanelId: string, zone: DropZone) => void
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/src/components/panels/__tests__/CrossWindowDropOverlay.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/panels/CrossWindowDropOverlay.tsx src/renderer/src/components/panels/__tests__/CrossWindowDropOverlay.test.tsx
git commit -m "feat(tearoff): CrossWindowDropOverlay with 5-zone targeting"
```

---

### Task 5: useCrossWindowDrop Hook

**Files:**

- Create: `src/renderer/src/hooks/useCrossWindowDrop.ts`
- Create: `src/renderer/src/hooks/__tests__/useCrossWindowDrop.test.ts`

- [ ] **Step 1: Write tests**

Test state transitions:

- Initially inactive
- `tearoff:dragIn` → active with viewKey and coords
- `tearoff:dragMove` → updates coords
- `tearoff:dragCancel` → inactive
- Drop calls `sendDropComplete` IPC and deactivates

- [ ] **Step 2: Implement the hook**

```typescript
interface CrossWindowDropState {
  active: boolean
  viewKey: string | null
  localX: number
  localY: number
}

export function useCrossWindowDrop() {
  const [state, setState] = useState<CrossWindowDropState>({
    active: false,
    viewKey: null,
    localX: 0,
    localY: 0
  })

  useEffect(() => {
    if (!window.api?.tearoff) return
    const unsubs = [
      window.api.tearoff.onDragIn((p) =>
        setState({ active: true, viewKey: p.viewKey, localX: p.localX, localY: p.localY })
      ),
      window.api.tearoff.onDragMove((p) =>
        setState((s) => (s.active ? { ...s, localX: p.localX, localY: p.localY } : s))
      ),
      window.api.tearoff.onDragCancel(() =>
        setState({ active: false, viewKey: null, localX: 0, localY: 0 })
      )
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  const handleDrop = useCallback(
    (targetPanelId: string, zone: string) => {
      if (!state.viewKey) return
      window.api.tearoff.sendDropComplete({ viewKey: state.viewKey, targetPanelId, zone })
      setState({ active: false, viewKey: null, localX: 0, localY: 0 })
    },
    [state.viewKey]
  )

  return { ...state, handleDrop }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useCrossWindowDrop.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useCrossWindowDrop.ts src/renderer/src/hooks/__tests__/useCrossWindowDrop.test.ts
git commit -m "feat(tearoff): useCrossWindowDrop hook for receiving drags"
```

---

### Task 6: Modify useTearoffDrag for Cross-Window Branching

**Files:**

- Modify: `src/renderer/src/hooks/useTearoffDrag.ts:59-73`

- [ ] **Step 1: Add crossWindowActive ref**

Add after existing refs (~line 28):

```typescript
const crossWindowActive = useRef(false)
```

- [ ] **Step 2: Modify timer-fires logic**

Replace the timer body (lines 59-73) to try cross-window first:

```typescript
tearoffTimer.current = setTimeout(async () => {
  tearoffTimer.current = null
  if (dragData.current === null || tearoffCreated.current) return

  // Try cross-window drag first
  if (window.api?.tearoff?.startCrossWindowDrag) {
    const result = await window.api.tearoff.startCrossWindowDrag({
      windowId: currentWindowId ?? '',
      viewKey: dragData.current.viewKey
    })
    if (result.targetFound) {
      tearoffCreated.current = true
      crossWindowActive.current = true
      return
    }
  }

  // No target window — create new tear-off (Phase 1 behavior)
  tearoffCreated.current = true
  const { viewKey, sourcePanelId, sourceTabIndex } = dragData.current
  window.api.tearoff.create({
    view: viewKey,
    screenX: lastScreen.current.x,
    screenY: lastScreen.current.y,
    sourcePanelId,
    sourceTabIndex
  })
}, 200)
```

- [ ] **Step 3: Modify dragend handler**

In the `dragend` listener (~line 79), suppress cleanup during cross-window:

```typescript
const onDragEnd = () => {
  if (crossWindowActive.current) {
    crossWindowActive.current = false
    dragData.current = null
    return // don't call endDrag — coordinator handles lifecycle
  }
  endDrag()
}
```

- [ ] **Step 4: Accept windowId prop**

The hook needs to know the current window ID to pass to `startCrossWindowDrag`. Add a parameter:

```typescript
export function useTearoffDrag(windowId?: string) {
  const currentWindowId = useRef(windowId)
  currentWindowId.current = windowId
  // ... rest unchanged, use currentWindowId.current in timer
}
```

Update callers (UnifiedHeader) to pass the window ID from query params.

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run src/renderer/src/hooks/__tests__/useTearoffDrag.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useTearoffDrag.ts
git commit -m "feat(tearoff): cross-window branching in useTearoffDrag"
```

---

### Task 7: Wire Into App.tsx and TearoffShell

**Files:**

- Modify: `src/renderer/src/App.tsx:140-157`
- Modify: `src/renderer/src/components/layout/TearoffShell.tsx:92-133`

- [ ] **Step 1: Mount useCrossWindowDrop in App.tsx**

Import and call the hook in the `App` component. Render `CrossWindowDropOverlay`:

```typescript
import { useCrossWindowDrop } from './hooks/useCrossWindowDrop'
import { CrossWindowDropOverlay } from './components/panels/CrossWindowDropOverlay'

// Inside App component:
const crossDrop = useCrossWindowDrop()

// In the JSX, before closing tag:
<CrossWindowDropOverlay
  active={crossDrop.active}
  localX={crossDrop.localX}
  localY={crossDrop.localY}
  viewKey={crossDrop.viewKey ?? ''}
  onDrop={crossDrop.handleDrop}
/>
```

Add listener for `tearoff:crossWindowDrop` to execute the tab add/split:

```typescript
useEffect(() => {
  if (!window.api?.tearoff?.onCrossWindowDrop) return
  return window.api.tearoff.onCrossWindowDrop((payload) => {
    const store = usePanelLayoutStore.getState()
    if (payload.zone === 'center') {
      store.addTab(payload.targetPanelId, payload.view as View)
    } else {
      const direction =
        payload.zone === 'left' || payload.zone === 'right' ? 'horizontal' : 'vertical'
      store.splitPanel(payload.targetPanelId, direction, payload.view as View)
    }
  })
}, [])
```

- [ ] **Step 2: Mount useCrossWindowDrop in TearoffShell**

Same pattern — import hook, render overlay, listen for crossWindowDrop.

Also add `tearoff:dragDone` listener to close the tear-off:

```typescript
useEffect(() => {
  if (!window.api?.tearoff?.onDragDone) return
  return window.api.tearoff.onDragDone(() => {
    window.close()
  })
}, [])
```

- [ ] **Step 3: Add Escape key handler for active drag**

In both App.tsx and TearoffShell, when the cross-window drop is active, listen for Escape:

```typescript
useEffect(() => {
  if (!crossDrop.active) return
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.api?.tearoff?.sendDragCancel()
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [crossDrop.active])
```

- [ ] **Step 4: Run typecheck and full tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/layout/TearoffShell.tsx
git commit -m "feat(tearoff): wire cross-window drop into App + TearoffShell"
```

---

### Task 8: Update Handler Count Tests + Integration

**Files:**

- Modify: `src/main/__tests__/integration/ipc-handlers-integration.test.ts`

- [ ] **Step 1: Update handler counts**

Find tests asserting handler counts and increment for new cross-window handlers:

- `tearoff:startCrossWindowDrag` (1 handle)
- `tearoff:dropComplete` (1 on)
- `tearoff:dragCancelFromRenderer` (1 on)

Check if these are registered via `safeHandle` or raw `ipcMain.handle/on` — only `safeHandle` calls are typically counted.

- [ ] **Step 2: Run all tests**

Run: `npm run typecheck && npm test && npm run test:main`
Expected: ALL PASS

- [ ] **Step 3: Run coverage**

Run: `npm run test:coverage 2>&1 | grep ERROR`
Expected: No threshold failures

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(tearoff): cross-window drag complete — update handler counts"
```

---

### Task 9: Manual Testing & Polish

- [ ] **Step 1: Build and run**

```bash
npx electron-rebuild -f -w better-sqlite3
npm run dev
```

- [ ] **Step 2: Test basic cross-window drag**

1. Right-click sidebar → "Open in New Window" to create a tear-off
2. In the tear-off, drag the header area toward the main window
3. When cursor enters main window, verify 5-zone overlay appears
4. Drop into center of a panel → tab added
5. Drop into edge → panel splits

- [ ] **Step 3: Test cancel flows**

1. Start cross-window drag, press Escape → drag cancelled, tab stays in source
2. Start drag, move cursor to desktop → overlay disappears in target
3. Start drag, close source window → drag cancelled

- [ ] **Step 4: Test auto-close**

1. Tear-off has one tab → drag it to main window → drop
2. Verify: tear-off window closes automatically after drop

- [ ] **Step 5: Test tear-off to tear-off**

1. Create two tear-off windows
2. Drag tab from one to the other → should work with 5-zone targeting

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(tearoff): cross-window drag — drag tabs between any BDE windows"
```

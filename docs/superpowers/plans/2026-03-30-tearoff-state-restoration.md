# Tear-Off State Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically restore tear-off windows on app restart — views as tabs, bounds preserved, silent startup.

**Architecture:** Main process persists `tearoff.windows` setting (JSON array of `{ windowId, views, bounds }`) on every state change. On startup, reads the setting and recreates windows. Renderer reads a `restore` query param to initialize with multiple views. Renderer sends `tearoff:viewsChanged` on panel store mutations.

**Tech Stack:** Electron BrowserWindow, SQLite settings, IPC, Zustand subscribe

**Spec:** `docs/superpowers/specs/2026-03-30-tearoff-state-restoration-design.md`

---

## File Map

| File                                                  | Action | Responsibility                                                                                                                                   |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/tearoff-manager.ts`                         | Modify | Add views to TearoffEntry, persistTearoffState(), restoreTearoffWindows(), viewsChanged handler, bounds persistence on move, persist before quit |
| `src/main/index.ts`                                   | Modify | Call restoreTearoffWindows() after createWindow()                                                                                                |
| `src/preload/index.ts`                                | Modify | Add `viewsChanged` method to tearoff namespace                                                                                                   |
| `src/preload/index.d.ts`                              | Modify | Add `viewsChanged` type                                                                                                                          |
| `src/renderer/src/components/layout/TearoffShell.tsx` | Modify | Read `restore` param, init store with multiple views, subscribe to store → send viewsChanged                                                     |

**Test files:**

| File                                                                 | Tests                                             |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| `src/main/__tests__/tearoff-state-restoration.test.ts`               | persist, restore, bounds validation, view changes |
| `src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx` | Update: restore param handling                    |

---

### Task 1: Preload + IPC

**Files:**

- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add viewsChanged to preload**

In `src/preload/index.ts` tearoff namespace, add:

```typescript
viewsChanged: (payload: { windowId: string; views: string[] }) =>
  ipcRenderer.send('tearoff:viewsChanged', payload),
```

- [ ] **Step 2: Add type declaration**

In `src/preload/index.d.ts` tearoff type:

```typescript
viewsChanged: (payload: { windowId: string; views: string[] }) => void
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(tearoff): add viewsChanged IPC to preload"
```

---

### Task 2: Main Process — Persist & Restore

**Files:**

- Modify: `src/main/tearoff-manager.ts`
- Create: `src/main/__tests__/tearoff-state-restoration.test.ts`

- [ ] **Step 1: Extend TearoffEntry**

Add `views: string[]` to the `TearoffEntry` interface in tearoff-manager.ts:

```typescript
interface TearoffEntry {
  win: BrowserWindow
  view: string // initial view (from create)
  views: string[] // current views (updated by renderer)
  windowId: string
}
```

When creating a tear-off (in the `tearoff:create` handler), initialize `views: [payload.view]`.

- [ ] **Step 2: Add persistTearoffState()**

```typescript
function persistTearoffState(): void {
  const state = Array.from(tearoffWindows.values())
    .filter((e) => !e.win.isDestroyed())
    .map((e) => ({
      windowId: e.windowId,
      views: e.views.length > 0 ? e.views : [e.view],
      bounds: e.win.getBounds()
    }))
  setSettingJson('tearoff.windows', state)
}
```

Call `persistTearoffState()` after:

- Creating a tear-off (end of `tearoff:create` handler)
- Closing/destroying a tear-off (in `handleCloseRequest` after delete)
- Returning to main (in `tearoff:returnToMain` and `tearoff:returnAll` handlers after delete)
- Receiving `tearoff:viewsChanged`

- [ ] **Step 3: Add viewsChanged IPC handler**

In `registerTearoffHandlers()`:

```typescript
ipcMain.on('tearoff:viewsChanged', (_event, payload: { windowId: string; views: string[] }) => {
  const entry = tearoffWindows.get(payload.windowId)
  if (entry) {
    entry.views = payload.views
    persistTearoffState()
  }
})
```

- [ ] **Step 4: Extend bounds persistence to include position**

The existing `persistBoundsDebounced` only saves size. Change it to also call `persistTearoffState()` which captures full bounds:

```typescript
function persistBoundsDebounced(windowId: string, win: BrowserWindow): void {
  const existing = resizeTimers.get(windowId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    resizeTimers.delete(windowId)
    persistTearoffState() // persist all state including bounds
  }, 500)
  resizeTimers.set(windowId, timer)
}
```

Also register the `move` event (not just `resize`) in the create handler:

```typescript
win.on('move', () => persistBoundsDebounced(windowId, win))
```

- [ ] **Step 5: Persist before quit**

In `closeTearoffWindows()` (called on quit), persist state BEFORE destroying windows:

```typescript
export function closeTearoffWindows(): void {
  persistTearoffState() // save state before destroying
  for (const entry of tearoffWindows.values()) {
    try {
      entry.win.destroy()
    } catch {
      /* already destroyed */
    }
  }
  tearoffWindows.clear()
}
```

- [ ] **Step 6: Add restoreTearoffWindows()**

```typescript
export function restoreTearoffWindows(): void {
  const saved = getSettingJson<PersistedTearoff[]>('tearoff.windows')
  if (!saved || !Array.isArray(saved) || saved.length === 0) return

  for (const entry of saved) {
    if (!entry.views || entry.views.length === 0) continue

    // Validate bounds are on-screen
    const bounds = isOnScreen(entry.bounds) ? entry.bounds : getDefaultBounds()

    const windowId = randomUUID()
    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      backgroundColor: '#0A0A0A',
      titleBarStyle: 'hiddenInset',
      autoHideMenuBar: true,
      webPreferences: SHARED_WEB_PREFERENCES
    })

    // Same setup as tearoff:create — setWindowOpenHandler, resize/move listeners, close handler
    setupTearoffWindow(win, windowId, entry.views[0], entry.views)

    tearoffWindows.set(windowId, { win, view: entry.views[0], views: entry.views, windowId })

    // Load with restore param containing all views
    const query = `?view=${encodeURIComponent(entry.views[0])}&windowId=${encodeURIComponent(windowId)}&restore=${encodeURIComponent(JSON.stringify(entry.views))}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
    }

    win.once('ready-to-show', () => win.show())
    logger.info(`[tearoff] restored window ${windowId} with views: ${entry.views.join(', ')}`)
  }

  // Clear persisted state — will be re-persisted on next change
  // (prevents double-restore if app crashes before next persist)
}

interface PersistedTearoff {
  windowId: string
  views: string[]
  bounds: { x: number; y: number; width: number; height: number }
}

function isOnScreen(bounds: { x: number; y: number; width: number; height: number }): boolean {
  const displays = screen.getAllDisplays()
  return displays.some((d) => {
    const db = d.bounds
    return (
      bounds.x < db.x + db.width &&
      bounds.x + bounds.width > db.x &&
      bounds.y < db.y + db.height &&
      bounds.y + bounds.height > db.y
    )
  })
}

function getDefaultBounds(): { x: number; y: number; width: number; height: number } {
  const primary = screen.getPrimaryDisplay()
  return {
    x: Math.round(primary.bounds.x + primary.bounds.width / 2 - 400),
    y: Math.round(primary.bounds.y + primary.bounds.height / 2 - 300),
    width: 800,
    height: 600
  }
}
```

- [ ] **Step 7: Extract shared setup into `setupTearoffWindow()`**

Refactor the common window setup (setWindowOpenHandler, resize/move listeners, close handler) from the `tearoff:create` handler into a shared function so `restoreTearoffWindows` can reuse it. This avoids duplicating ~40 lines.

- [ ] **Step 8: Write tests**

Create `src/main/__tests__/tearoff-state-restoration.test.ts`:

Test:

- `persistTearoffState` serializes entries correctly
- `restoreTearoffWindows` creates windows from valid entries
- `restoreTearoffWindows` skips entries with empty views
- `isOnScreen` returns true for on-screen bounds, false for off-screen
- `tearoff:viewsChanged` updates entry views and persists
- Quit flow: `closeTearoffWindows` persists before destroying

- [ ] **Step 9: Run tests**

Run: `npx vitest run src/main/__tests__/tearoff-state-restoration.test.ts --config src/main/vitest.main.config.ts`

- [ ] **Step 10: Commit**

```bash
git add src/main/tearoff-manager.ts src/main/__tests__/tearoff-state-restoration.test.ts
git commit -m "feat(tearoff): persist and restore tear-off windows on restart"
```

---

### Task 3: Wire Restore into App Startup

**Files:**

- Modify: `src/main/index.ts`

- [ ] **Step 1: Import and call restoreTearoffWindows**

In `src/main/index.ts`, after `createWindow()` is called in `app.whenReady()` and after handler registrations:

```typescript
import { restoreTearoffWindows } from './tearoff-manager'

// After createWindow() and handler registrations:
restoreTearoffWindows()
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(tearoff): call restoreTearoffWindows on app startup"
```

---

### Task 4: Renderer — Restore Multiple Views

**Files:**

- Modify: `src/renderer/src/components/layout/TearoffShell.tsx`

- [ ] **Step 1: Read restore param**

At the top of `TearoffShell`, read the `restore` query param:

```typescript
const params = new URLSearchParams(window.location.search)
const restoreViews = params.get('restore')
const initialViews: View[] = restoreViews
  ? (JSON.parse(decodeURIComponent(restoreViews)) as View[])
  : [view]
```

- [ ] **Step 2: Update store initialization**

Change the mount useEffect to initialize with all restored views:

```typescript
useEffect(() => {
  usePanelLayoutStore.getState().setPersistable(false)
  if (initialViews.length === 1) {
    const leaf = createLeaf(initialViews[0])
    usePanelLayoutStore.setState({
      root: leaf,
      focusedPanelId: leaf.panelId,
      activeView: initialViews[0]
    })
  } else {
    // Create a leaf with all views as tabs
    let leaf = createLeaf(initialViews[0])
    for (let i = 1; i < initialViews.length; i++) {
      const updated = addTab(leaf, leaf.panelId, initialViews[i])
      if (updated) leaf = updated as PanelLeafNode
    }
    usePanelLayoutStore.setState({
      root: leaf,
      focusedPanelId: leaf.panelId,
      activeView: initialViews[0]
    })
  }
}, [])
```

Import `addTab` and `PanelLeafNode` from panelLayout.

- [ ] **Step 3: Subscribe to store → send viewsChanged**

Add a useEffect that subscribes to the panel store and notifies main process:

```typescript
useEffect(() => {
  let debounce: ReturnType<typeof setTimeout> | null = null
  const unsub = usePanelLayoutStore.subscribe((state) => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      const views = getOpenViews(state.root) as string[]
      window.api?.tearoff?.viewsChanged({ windowId, views })
    }, 500)
  })
  return () => {
    unsub()
    if (debounce) clearTimeout(debounce)
  }
}, [windowId])
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/layout/TearoffShell.tsx
git commit -m "feat(tearoff): restore multiple views from query param + notify viewsChanged"
```

---

### Task 5: Handler Counts + Final Verification

**Files:**

- Modify: `src/main/__tests__/integration/ipc-registration.test.ts`

- [ ] **Step 1: Update allowedExtras**

Add `tearoff:viewsChanged` to the `allowedExtras` set.

- [ ] **Step 2: Run full suite**

```bash
npm run typecheck && npm test && npm run test:main
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(tearoff): state restoration complete — update handler counts"
```

---

### Task 6: Manual Testing

- [ ] **Step 1: Build and run**

```bash
npx electron-rebuild -f -w better-sqlite3 && npm run dev
```

- [ ] **Step 2: Test restore flow**

1. Open 2 tear-offs (Agents + Settings)
2. Quit app (Cmd+Q)
3. Restart (`npm run dev`)
4. Verify: both tear-off windows reappear at same positions

- [ ] **Step 3: Test multi-tab restore**

1. Open tear-off, drop a second tab into it
2. Quit and restart
3. Verify: tear-off restores with both tabs

- [ ] **Step 4: Test closed tear-off NOT restored**

1. Open 2 tear-offs, close one manually
2. Quit and restart
3. Verify: only the unclosed tear-off is restored

- [ ] **Step 5: Test off-screen bounds**

1. Move tear-off to edge of screen, quit
2. If testing with external monitor: disconnect, restart
3. Verify: window appears on primary display if original position is off-screen

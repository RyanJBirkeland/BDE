# Tear-Off Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable dragging a panel tab past the window boundary to detach it into a standalone tear-off window, with close-or-return behavior.

**Architecture:** Query-parameter routing — tear-off windows load the same renderer with `?view=X&windowId=Y`. `TearoffShell` renders a minimal single-view wrapper. Main process manages window lifecycle via `tearoff-manager.ts`. Drag detection via `useTearoffDrag` hook with 200ms boundary-exit debounce.

**Tech Stack:** Electron BrowserWindow, React, Zustand, HTML5 Drag and Drop, IPC (handle/send)

**Spec:** `docs/superpowers/specs/2026-03-30-tear-off-windows-design.md`

---

## File Map

| File                                                   | Action                               | Responsibility                                                       |
| ------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| `src/main/tearoff-manager.ts`                          | Create                               | Window lifecycle, IPC handlers, bounds persistence                   |
| `src/main/index.ts`                                    | Modify (lines 44-63, 92-94, 193-205) | Extract shared webPreferences, register tearoff handlers, quit hooks |
| `src/shared/ipc-channels.ts`                           | Modify (lines 290-296, 528-546)      | Add `TearoffChannels` interface                                      |
| `src/preload/index.ts`                                 | Modify (lines 21-285)                | Expose tearoff IPC methods                                           |
| `src/preload/index.d.ts`                               | Modify (lines 21-252)                | Type declarations for tearoff API                                    |
| `src/renderer/src/App.tsx`                             | Modify (lines 152-240, 251-287)      | Query param routing, suppress shortcuts in tearoff                   |
| `src/renderer/src/components/layout/TearoffShell.tsx`  | Create                               | Minimal single-view shell for tear-off windows                       |
| `src/renderer/src/hooks/useTearoffDrag.ts`             | Create                               | Drag boundary detection + screen coordinate tracking                 |
| `src/renderer/src/components/layout/UnifiedHeader.tsx` | Modify                               | Wire useTearoffDrag into tab drag events                             |
| `src/renderer/src/stores/panelLayout.ts`               | Modify (lines 382-386)               | Last-tab replacement with dashboard                                  |
| `src/renderer/src/stores/theme.ts`                     | Modify (lines 27-42)                 | Cross-window theme sync via storage event                            |
| `src/renderer/src/assets/tearoff-shell.css`            | Create                               | Styles for TearoffShell header                                       |

**Test files:**

| File                                                                 | Tests                                               |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| `src/main/__tests__/tearoff-manager.test.ts`                         | Window creation, close flow, timeout, bounds, quit  |
| `src/renderer/src/hooks/__tests__/useTearoffDrag.test.ts`            | State machine transitions, timer logic              |
| `src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx` | View rendering, return button, shortcut suppression |
| `src/main/__tests__/integration/ipc-handlers-integration.test.ts`    | Update handler count                                |

---

### Task 1: IPC Channel Definitions

**Files:**

- Modify: `src/shared/ipc-channels.ts:290-296,528-546`

- [ ] **Step 1: Add TearoffChannels interface**

In `src/shared/ipc-channels.ts`, after the existing `WindowChannels` interface (~line 296), add:

```typescript
export interface TearoffChannels {
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
}
```

- [ ] **Step 2: Add TearoffChannels to IpcChannelMap intersection**

In the `IpcChannelMap` type (~line 528), add `TearoffChannels` to the intersection:

```typescript
export type IpcChannelMap = SettingsChannels & GitChannels & ... & TearoffChannels
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (channels added but not yet consumed)

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat(tearoff): add IPC channel type definitions"
```

---

### Task 2: Preload Bridge

**Files:**

- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add tearoff methods to preload api object**

In `src/preload/index.ts`, inside the `api` object, add:

```typescript
tearoff: {
  create: (payload: { view: string; screenX: number; screenY: number; sourcePanelId: string; sourceTabIndex: number }) =>
    typedInvoke('tearoff:create', payload),
  closeConfirmed: (payload: { action: 'return' | 'close'; remember: boolean }) =>
    typedInvoke('tearoff:closeConfirmed', payload),
  returnToMain: (windowId: string) =>
    ipcRenderer.send('tearoff:returnToMain', windowId),
  onTabRemoved: (cb: (payload: { sourcePanelId: string; sourceTabIndex: number }) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { sourcePanelId: string; sourceTabIndex: number }) => cb(payload)
    ipcRenderer.on('tearoff:tabRemoved', handler)
    return () => ipcRenderer.removeListener('tearoff:tabRemoved', handler)
  },
  onTabReturned: (cb: (payload: { view: string }) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { view: string }) => cb(payload)
    ipcRenderer.on('tearoff:tabReturned', handler)
    return () => ipcRenderer.removeListener('tearoff:tabReturned', handler)
  },
  onConfirmClose: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('tearoff:confirmClose', handler)
    return () => ipcRenderer.removeListener('tearoff:confirmClose', handler)
  }
},
```

- [ ] **Step 2: Add type declarations to index.d.ts**

In `src/preload/index.d.ts`, inside the `api` interface, add matching declarations:

```typescript
tearoff: {
  create: (payload: { view: string; screenX: number; screenY: number; sourcePanelId: string; sourceTabIndex: number }) => Promise<{ windowId: string }>
  closeConfirmed: (payload: { action: 'return' | 'close'; remember: boolean }) => Promise<void>
  returnToMain: (windowId: string) => void
  onTabRemoved: (cb: (payload: { sourcePanelId: string; sourceTabIndex: number }) => void) => () => void
  onTabReturned: (cb: (payload: { view: string }) => void) => () => void
  onConfirmClose: (cb: () => void) => () => void
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(tearoff): expose tearoff IPC methods in preload bridge"
```

---

### Task 3: Tearoff Manager (Main Process)

**Files:**

- Create: `src/main/tearoff-manager.ts`
- Create: `src/main/__tests__/tearoff-manager.test.ts`

- [ ] **Step 1: Write tests for tearoff-manager**

Create `src/main/__tests__/tearoff-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() },
    getBounds: vi.fn(() => ({ width: 800, height: 600 }))
  })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../settings', () => ({
  getSetting: vi.fn(),
  getSettingJson: vi.fn(() => null),
  setSetting: vi.fn()
}))

vi.mock('../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({}))
}))

describe('tearoff-manager', () => {
  it('placeholder — tests written after implementation')
})
```

- [ ] **Step 2: Run test to verify setup**

Run: `npx vitest run src/main/__tests__/tearoff-manager.test.ts`
Expected: PASS (placeholder test)

- [ ] **Step 3: Implement tearoff-manager.ts**

Create `src/main/tearoff-manager.ts`:

```typescript
import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getSettingJson, setSetting } from './settings'
import { createLogger } from './logger'

const log = createLogger('tearoff')

export const SHARED_WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true
}

interface TearoffEntry {
  win: BrowserWindow
  view: string
  windowId: string
}

const tearoffWindows = new Map<string, TearoffEntry>()
let nextWindowId = 1
let isQuitting = false
let saveSizeTimeout: ReturnType<typeof setTimeout> | null = null

export function setQuitting(): void {
  isQuitting = true
}

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (w) => !Array.from(tearoffWindows.values()).some((t) => t.win === w)
  )
}

function createTearoffWindow(payload: {
  view: string
  screenX: number
  screenY: number
  sourcePanelId: string
  sourceTabIndex: number
}): { windowId: string } {
  const windowId = `tw${nextWindowId++}`

  // Reuse last saved size or default
  const savedSize = getSettingJson('tearoff.lastSize') as { width: number; height: number } | null
  const width = savedSize?.width ?? 800
  const height = savedSize?.height ?? 600

  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(payload.screenX - width / 2),
    y: Math.round(payload.screenY - 40),
    show: false,
    backgroundColor: '#0A0A0A',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: SHARED_WEB_PREFERENCES
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  tearoffWindows.set(windowId, { win, view: payload.view, windowId })

  // Load renderer with query params
  const query = `?view=${encodeURIComponent(payload.view)}&windowId=${encodeURIComponent(windowId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${query}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      search: query
    })
  }

  win.once('ready-to-show', () => win.show())

  // Save size on resize (debounced)
  win.on('resize', () => {
    if (saveSizeTimeout) clearTimeout(saveSizeTimeout)
    saveSizeTimeout = setTimeout(() => {
      if (win.isDestroyed()) return
      const bounds = win.getBounds()
      setSetting('tearoff.lastSize', JSON.stringify({ width: bounds.width, height: bounds.height }))
    }, 500)
  })

  // Handle close with two-phase async
  win.on('close', (event) => {
    if (isQuitting) return // allow immediate close on app quit

    event.preventDefault()

    const savedAction = getSettingJson('tearoff.closeAction') as string | null
    if (savedAction === 'return' || savedAction === 'close') {
      handleCloseAction(windowId, savedAction as 'return' | 'close')
      return
    }

    // Ask renderer for user choice
    win.webContents.send('tearoff:confirmClose')

    // 5s timeout — force close if renderer doesn't respond
    const timeout = setTimeout(() => {
      handleCloseAction(windowId, 'close')
    }, 5000)

    // Wait for response (one-time)
    ipcMain.once(
      `tearoff:closeResponse:${windowId}`,
      (_event, response: { action: 'return' | 'close'; remember: boolean }) => {
        clearTimeout(timeout)
        if (response.remember) {
          setSetting('tearoff.closeAction', response.action)
        }
        handleCloseAction(windowId, response.action)
      }
    )
  })

  // Notify main window to remove the tab
  const mainWin = getMainWindow()
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('tearoff:tabRemoved', {
      sourcePanelId: payload.sourcePanelId,
      sourceTabIndex: payload.sourceTabIndex
    })
  }

  log.info(`[tearoff] Created window ${windowId} for view=${payload.view}`)
  return { windowId }
}

function handleCloseAction(windowId: string, action: 'return' | 'close'): void {
  const entry = tearoffWindows.get(windowId)
  if (!entry) return

  if (action === 'return') {
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('tearoff:tabReturned', { view: entry.view })
    }
  }

  tearoffWindows.delete(windowId)
  if (!entry.win.isDestroyed()) {
    entry.win.destroy()
  }
  log.info(`[tearoff] Closed window ${windowId} action=${action}`)
}

export function registerTearoffHandlers(): void {
  ipcMain.handle('tearoff:create', (_event, payload) => {
    return createTearoffWindow(payload)
  })

  ipcMain.on('tearoff:returnToMain', (_event, windowId: string) => {
    handleCloseAction(windowId, 'return')
  })
}

export function closeTearoffWindows(): void {
  for (const entry of tearoffWindows.values()) {
    if (!entry.win.isDestroyed()) entry.win.destroy()
  }
  tearoffWindows.clear()
}
```

- [ ] **Step 4: Write real tests**

Replace placeholder test in `src/main/__tests__/tearoff-manager.test.ts` with tests covering:

- `createTearoffWindow` returns windowId
- Window loads correct URL with query params
- `handleCloseAction('return')` sends `tearoff:tabReturned` to main window
- `handleCloseAction('close')` destroys window without sending tabReturned
- `closeTearoffWindows` destroys all and clears map
- `setQuitting` allows immediate close without confirmation

- [ ] **Step 5: Run tests**

Run: `npm run test:main`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/tearoff-manager.ts src/main/__tests__/tearoff-manager.test.ts
git commit -m "feat(tearoff): main process window manager with close flow"
```

---

### Task 4: Wire Tearoff Manager into Main Process

**Files:**

- Modify: `src/main/index.ts:44-63,92-94,193-205`

- [ ] **Step 1: Extract shared webPreferences**

In `src/main/index.ts`, import `SHARED_WEB_PREFERENCES` from `tearoff-manager` and use it in `createWindow()`:

```typescript
import {
  registerTearoffHandlers,
  closeTearoffWindows,
  setQuitting,
  SHARED_WEB_PREFERENCES
} from './tearoff-manager'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    // ... existing size/show/style props ...
    webPreferences: SHARED_WEB_PREFERENCES
  })
  // ... rest unchanged
}
```

- [ ] **Step 2: Register tearoff handlers**

In the `app.whenReady()` block (~line 193), add after existing handler registrations:

```typescript
registerTearoffHandlers()
```

- [ ] **Step 3: Wire quit hooks**

Update the `before-quit` handler:

```typescript
app.on('before-quit', () => {
  setQuitting()
  closeTearoffWindows()
  closeDb()
})
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(tearoff): wire tearoff manager into app lifecycle"
```

---

### Task 5: TearoffShell Component

**Files:**

- Create: `src/renderer/src/components/layout/TearoffShell.tsx`
- Create: `src/renderer/src/assets/tearoff-shell.css`
- Create: `src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx`

- [ ] **Step 1: Write tests**

Create `src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...rest }: any) => <div {...rest}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => false
}))

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: { duration: 0 },
  useReducedMotion: () => false
}))

// Mock views
vi.mock('../../../views/DashboardView', () => ({ default: () => <div data-testid="dashboard-view" /> }))
vi.mock('../../../views/AgentsView', () => ({ AgentsView: () => <div data-testid="agents-view" /> }))

import { TearoffShell } from '../TearoffShell'

describe('TearoffShell', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the view matching the view prop', () => {
    render(<TearoffShell view="dashboard" windowId="tw1" />)
    expect(screen.getByTestId('dashboard-view')).toBeInTheDocument()
  })

  it('shows view name in header', () => {
    render(<TearoffShell view="dashboard" windowId="tw1" />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('renders return button', () => {
    render(<TearoffShell view="dashboard" windowId="tw1" />)
    expect(screen.getByLabelText('Return to main window')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx`
Expected: FAIL (TearoffShell doesn't exist)

- [ ] **Step 3: Create tearoff-shell.css**

Create `src/renderer/src/assets/tearoff-shell.css`:

```css
.tearoff-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--neon-bg);
}

.tearoff-shell__header {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px 0 80px; /* macOS traffic lights */
  background: var(--neon-surface-deep);
  border-bottom: 1px solid var(--neon-purple-border);
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.tearoff-shell__title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--neon-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tearoff-shell__actions {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.tearoff-shell__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--neon-text-dim);
  cursor: pointer;
  transition:
    color 100ms ease,
    background 100ms ease;
}

.tearoff-shell__btn:hover {
  color: var(--neon-text);
  background: var(--neon-surface-subtle);
}

.tearoff-shell__content {
  flex: 1;
  overflow: hidden;
}
```

- [ ] **Step 4: Implement TearoffShell**

Create `src/renderer/src/components/layout/TearoffShell.tsx`:

```typescript
import { lazy, Suspense, useEffect, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import { VIEW_LABELS } from '../../lib/view-registry'
import type { View } from '../../stores/panelLayout'
import '../../assets/tearoff-shell.css'

const VIEW_COMPONENTS: Record<View, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: lazy(() => import('../../views/DashboardView')),
  agents: lazy(() => import('../../views/AgentsView').then((m) => ({ default: m.AgentsView }))),
  ide: lazy(() => import('../../views/IDEView')),
  sprint: lazy(() => import('../../views/SprintView')),
  'pr-station': lazy(() => import('../../views/PRStationView')),
  git: lazy(() => import('../../views/GitTreeView')),
  settings: lazy(() => import('../../views/SettingsView')),
  'task-workbench': lazy(() => import('../../views/TaskWorkbenchView'))
}

interface TearoffShellProps {
  view: View
  windowId: string
}

export function TearoffShell({ view, windowId }: TearoffShellProps) {
  const ViewComponent = VIEW_COMPONENTS[view]
  const label = VIEW_LABELS[view] ?? view
  const [showConfirm, setShowConfirm] = useState(false)

  // Listen for close confirmation request from main process
  useEffect(() => {
    if (!window.api?.tearoff) return
    return window.api.tearoff.onConfirmClose(() => {
      setShowConfirm(true)
    })
  }, [])

  const handleReturn = () => {
    window.api?.tearoff?.returnToMain(windowId)
  }

  const handleConfirmClose = (action: 'return' | 'close', remember: boolean) => {
    setShowConfirm(false)
    // Send response on per-window channel
    window.api?.tearoff?.closeConfirmed({ action, remember })
  }

  return (
    <div className="tearoff-shell">
      <div className="tearoff-shell__header">
        <span className="tearoff-shell__title">{label}</span>
        <div className="tearoff-shell__actions">
          <button
            className="tearoff-shell__btn"
            onClick={handleReturn}
            aria-label="Return to main window"
            title="Return to main window"
          >
            <Undo2 size={14} />
          </button>
        </div>
      </div>
      <div className="tearoff-shell__content">
        <Suspense fallback={<div style={{ padding: 16, color: 'var(--neon-text-dim)' }}>Loading...</div>}>
          <ViewComponent />
        </Suspense>
      </div>

      {showConfirm && (
        <TearoffCloseDialog
          onReturn={(remember) => handleConfirmClose('return', remember)}
          onClose={(remember) => handleConfirmClose('close', remember)}
        />
      )}
    </div>
  )
}

function TearoffCloseDialog({ onReturn, onClose }: {
  onReturn: (remember: boolean) => void
  onClose: (remember: boolean) => void
}) {
  const [remember, setRemember] = useState(false)

  return (
    <div className="tearoff-shell__dialog-overlay">
      <div className="tearoff-shell__dialog" role="alertdialog" aria-modal="true" aria-label="Close tear-off window">
        <p>Return this tab to the main window?</p>
        <label className="tearoff-shell__dialog-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my choice
        </label>
        <div className="tearoff-shell__dialog-actions">
          <button onClick={() => onClose(remember)} className="bde-btn bde-btn--ghost bde-btn--sm">Close</button>
          <button onClick={() => onReturn(remember)} className="bde-btn bde-btn--primary bde-btn--sm">Return</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/layout/TearoffShell.tsx src/renderer/src/assets/tearoff-shell.css src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx
git commit -m "feat(tearoff): TearoffShell component with close dialog"
```

---

### Task 6: Query Parameter Routing in App.tsx

**Files:**

- Modify: `src/renderer/src/App.tsx:152-240,251-287`

- [ ] **Step 1: Add tearoff detection at top of App component**

At the top of the App component (before any hooks/effects), add:

```typescript
import { TearoffShell } from './components/layout/TearoffShell'
import type { View } from './stores/panelLayout'

// ... inside App component:
const params = new URLSearchParams(window.location.search)
const tearoffView = params.get('view') as View | null
const tearoffWindowId = params.get('windowId')

if (tearoffView && tearoffWindowId) {
  return <TearoffShell view={tearoffView} windowId={tearoffWindowId} />
}
```

This MUST be before any hooks — it's an early return. If hooks are called before this check, they'll be called conditionally which violates Rules of Hooks. Move it to the very first line of the component body.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run full tests**

Run: `npm test`
Expected: PASS (existing tests don't use query params)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(tearoff): query param routing in App.tsx"
```

---

### Task 7: useTearoffDrag Hook

**Files:**

- Create: `src/renderer/src/hooks/useTearoffDrag.ts`
- Create: `src/renderer/src/hooks/__tests__/useTearoffDrag.test.ts`

- [ ] **Step 1: Write tests for the state machine**

Create `src/renderer/src/hooks/__tests__/useTearoffDrag.test.ts`:

Test the core logic functions (not React hooks — extract pure functions):

- `shouldCreateTearoff(state)` → true when timer expired and dragData is set
- Timer start/cancel flow
- `tearoffCreated` flag suppresses dragend handling
- Screen coordinate tracking

- [ ] **Step 2: Implement the hook**

Create `src/renderer/src/hooks/useTearoffDrag.ts`:

```typescript
import { useRef, useEffect, useCallback } from 'react'
import type { View } from '../stores/panelLayout'

interface DragPayload {
  sourcePanelId: string
  sourceTabIndex: number
  viewKey: View
}

const TEAROFF_DEBOUNCE_MS = 200

export function useTearoffDrag() {
  const dragData = useRef<DragPayload | null>(null)
  const lastScreen = useRef({ x: 0, y: 0 })
  const tearoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tearoffCreated = useRef(false)

  const startDrag = useCallback((payload: DragPayload) => {
    dragData.current = payload
    tearoffCreated.current = false
  }, [])

  const endDrag = useCallback(() => {
    if (tearoffTimer.current) {
      clearTimeout(tearoffTimer.current)
      tearoffTimer.current = null
    }
    dragData.current = null
    tearoffCreated.current = false
  }, [])

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (dragData.current && e.screenX !== 0 && e.screenY !== 0) {
        lastScreen.current = { x: e.screenX, y: e.screenY }
      }
    }

    const onDragLeave = (e: DragEvent) => {
      if (e.target !== document.documentElement) return
      if (!dragData.current) return

      tearoffTimer.current = setTimeout(() => {
        if (!dragData.current || tearoffCreated.current) return
        tearoffCreated.current = true

        window.api?.tearoff?.create({
          view: dragData.current.viewKey,
          screenX: lastScreen.current.x,
          screenY: lastScreen.current.y,
          sourcePanelId: dragData.current.sourcePanelId,
          sourceTabIndex: dragData.current.sourceTabIndex
        })
      }, TEAROFF_DEBOUNCE_MS)
    }

    const onDragEnter = (e: DragEvent) => {
      if (e.target !== document.documentElement) return
      if (tearoffTimer.current) {
        clearTimeout(tearoffTimer.current)
        tearoffTimer.current = null
      }
    }

    const onDragEnd = () => {
      endDrag()
    }

    document.addEventListener('dragover', onDragOver)
    document.documentElement.addEventListener('dragleave', onDragLeave)
    document.documentElement.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragend', onDragEnd)

    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.documentElement.removeEventListener('dragleave', onDragLeave)
      document.documentElement.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragend', onDragEnd)
      if (tearoffTimer.current) clearTimeout(tearoffTimer.current)
    }
  }, [endDrag])

  return { startDrag, endDrag, tearoffCreated }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useTearoffDrag.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useTearoffDrag.ts src/renderer/src/hooks/__tests__/useTearoffDrag.test.ts
git commit -m "feat(tearoff): useTearoffDrag hook with boundary detection"
```

---

### Task 8: Wire Drag Hook into Header Tabs

**Files:**

- Modify: `src/renderer/src/components/layout/UnifiedHeader.tsx`

- [ ] **Step 1: Import and use useTearoffDrag**

In `UnifiedHeader.tsx`, import the hook and wire it into existing tab drag events:

```typescript
import { useTearoffDrag } from '../../hooks/useTearoffDrag'

// Inside component:
const { startDrag } = useTearoffDrag()

// In the tab's onDragStart handler, after setting dataTransfer:
startDrag({
  sourcePanelId: focusedPanelId,
  sourceTabIndex: tabIndex,
  viewKey: tab.viewKey
})
```

- [ ] **Step 2: Wire tearoff:tabRemoved listener into panelLayout**

In `App.tsx` or `UnifiedHeader.tsx`, add an effect to listen for tab removal:

```typescript
useEffect(() => {
  if (!window.api?.tearoff) return
  return window.api.tearoff.onTabRemoved((payload) => {
    usePanelLayoutStore.getState().closeTab(payload.sourcePanelId, payload.sourceTabIndex)
  })
}, [])
```

And for tab return:

```typescript
useEffect(() => {
  if (!window.api?.tearoff) return
  return window.api.tearoff.onTabReturned((payload) => {
    const store = usePanelLayoutStore.getState()
    const targetId = store.focusedPanelId ?? ''
    store.addTab(targetId, payload.view as View)
  })
}, [])
```

- [ ] **Step 3: Handle last-tab replacement**

In `src/renderer/src/stores/panelLayout.ts`, update the `closeTab` store action (~line 382):

```typescript
closeTab: (targetId, tabIndex): void => {
  set((s) => {
    const newRoot = closeTab(s.root, targetId, tabIndex)
    if (newRoot === null) {
      // Last tab removed — replace with dashboard instead of keeping stale panel
      const fresh = createLeaf('dashboard')
      return { root: fresh, focusedPanelId: fresh.panelId, activeView: 'dashboard' }
    }
    return { root: newRoot }
  })
},
```

- [ ] **Step 4: Run typecheck and full tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/layout/UnifiedHeader.tsx src/renderer/src/App.tsx src/renderer/src/stores/panelLayout.ts
git commit -m "feat(tearoff): wire drag hook into header tabs + IPC listeners"
```

---

### Task 9: Theme Sync Across Windows

**Files:**

- Modify: `src/renderer/src/stores/theme.ts:27-42`

- [ ] **Step 1: Add storage event listener**

In `src/renderer/src/stores/theme.ts`, after the store creation, add:

```typescript
// Cross-window theme sync via localStorage storage event
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'bde-theme' && e.newValue) {
      const next = e.newValue as Theme
      applyTheme(next)
      useThemeStore.setState({ theme: next })
    }
  })
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/theme.ts
git commit -m "feat(tearoff): cross-window theme sync via storage event"
```

---

### Task 10: Update Handler Count Tests + Integration

**Files:**

- Modify: `src/main/__tests__/integration/ipc-handlers-integration.test.ts`
- Modify: `src/main/handlers/__tests__/` (any handler count assertions)

- [ ] **Step 1: Update handler count in integration test**

Find the test that asserts the total number of `safeHandle` or `ipcMain.handle` calls and increment it by the number of new tearoff handlers (2 `handle` calls + 1 `on` call).

- [ ] **Step 2: Run full test suite**

Run: `npm run typecheck && npm test && npm run test:main`
Expected: ALL PASS

- [ ] **Step 3: Run coverage check**

Run: `npm run test:coverage`
Expected: All thresholds pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(tearoff): update handler counts and integration tests"
```

---

### Task 11: Manual Testing & Polish

- [ ] **Step 1: Build and run**

```bash
npx electron-rebuild -f -w better-sqlite3
npm run dev
```

- [ ] **Step 2: Test tear-off flow**

1. Open BDE, navigate to Agents view
2. Drag the Agents tab toward the bottom of the window until cursor leaves the window boundary
3. Verify: new window appears near cursor with Agents view
4. Verify: main window shows Dashboard (last-tab replacement)
5. Click "Return to main" button in tear-off header
6. Verify: Agents tab re-added to main window

- [ ] **Step 3: Test close dialog**

1. Tear off a tab
2. Click the red close button (macOS traffic light)
3. Verify: dialog appears asking "Return this tab?"
4. Click "Return" → tab returns to main
5. Repeat, check "Remember my choice", click "Close"
6. Tear off another tab, close it → no dialog, closes immediately

- [ ] **Step 4: Test multi-monitor**

1. Drag tab to second monitor
2. Verify: window appears on correct monitor at cursor position

- [ ] **Step 5: Test theme sync**

1. Tear off a tab
2. Toggle theme in main window (Settings → Appearance → Light)
3. Verify: tear-off window switches to light theme

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(tearoff): tear-off windows complete — drag tab to detach"
```

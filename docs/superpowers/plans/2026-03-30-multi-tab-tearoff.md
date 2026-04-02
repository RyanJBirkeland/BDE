# Multi-Tab Tear-Off Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade tear-off windows from single-view to full panel support — seamless transition when a second tab arrives via cross-window drop, with TearoffTabBar for tab management and "Return All" for bulk return.

**Architecture:** `TearoffShell` derives mode from `usePanelLayoutStore` — single leaf with one tab = single-view, otherwise = panel mode rendering `PanelRenderer`. A `persistable` flag prevents tear-off store mutations from corrupting the main window's saved layout. Shared `view-resolver.ts` eliminates duplicate lazy imports.

**Tech Stack:** React, Zustand, PanelRenderer, IPC (handle/send)

**Spec:** `docs/superpowers/specs/2026-03-30-multi-tab-tearoff-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/src/lib/view-resolver.ts` | Create | Shared lazy view imports (deduplicate from PanelLeaf + TearoffShell) |
| `src/renderer/src/components/layout/TearoffTabBar.tsx` | Create | Tab strip for focused panel in tear-off windows |
| `src/renderer/src/stores/panelLayout.ts` | Modify (lines 305, 346, 527) | Export `findFirstLeaf`, add `persistable` flag, guard subscriber |
| `src/renderer/src/components/layout/TearoffShell.tsx` | Modify (lines 89-170) | Mode derivation, panel mode rendering, crossWindowDrop upgrade, Return All, keyboard shortcuts |
| `src/renderer/src/components/panels/PanelLeaf.tsx` | Modify (lines 12-18, 38-57) | Import from shared view-resolver.ts |
| `src/shared/ipc-channels.ts` | Modify (lines 299-312) | Add `tearoff:returnAll` channel |
| `src/preload/index.ts` | Modify (lines 265-319) | Add `returnAll` method |
| `src/preload/index.d.ts` | Modify (lines 234-250) | Add `returnAll` type |
| `src/main/tearoff-manager.ts` | Modify (lines 340+) | Handle `tearoff:returnAll` IPC |

**Test files:**

| File | Tests |
|------|-------|
| `src/renderer/src/components/layout/__tests__/TearoffTabBar.test.tsx` | Tab rendering, close, active state |
| `src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx` | Update: panel mode, transition, Return All |
| `src/renderer/src/stores/__tests__/panelLayout.test.ts` | Update: persistable flag |

---

### Task 1: Shared View Resolver

**Files:**
- Create: `src/renderer/src/lib/view-resolver.ts`
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx:12-18,38-57`
- Modify: `src/renderer/src/components/layout/TearoffShell.tsx:1-47`

- [ ] **Step 1: Create view-resolver.ts**

Extract the lazy imports and resolveView function shared by PanelLeaf and TearoffShell:

```typescript
import { lazy, type ComponentType } from 'react'
import type { View } from '../stores/panelLayout'

export const VIEW_COMPONENTS: Record<View, React.LazyExoticComponent<ComponentType>> = {
  dashboard: lazy(() => import('../views/DashboardView')),
  agents: lazy(() => import('../views/AgentsView').then((m) => ({ default: m.AgentsView }))),
  ide: lazy(() => import('../views/IDEView')),
  sprint: lazy(() => import('../views/SprintView')),
  settings: lazy(() => import('../views/SettingsView')),
  'pr-station': lazy(() => import('../views/PRStationView')),
  'task-workbench': lazy(() => import('../views/TaskWorkbenchView')),
  git: lazy(() => import('../views/GitTreeView'))
}

export function resolveView(viewKey: View): React.ReactNode {
  const Component = VIEW_COMPONENTS[viewKey]
  return Component ? <Component /> : null
}
```

- [ ] **Step 2: Update PanelLeaf to import from shared module**

Replace the lazy imports (lines 12-18) and resolveView function (lines 38-57) with:

```typescript
import { resolveView } from '../../lib/view-resolver'
```

Remove the duplicate lazy import lines and the local resolveView function.

- [ ] **Step 3: Update TearoffShell to import from shared module**

Replace the lazy imports and resolveView function (lines 1-47) with:

```typescript
import { resolveView } from '../../lib/view-resolver'
```

Remove the duplicate view component imports and local resolveView.

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS (refactor only, no behavior change)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/view-resolver.ts src/renderer/src/components/panels/PanelLeaf.tsx src/renderer/src/components/layout/TearoffShell.tsx
git commit -m "refactor: extract shared view-resolver.ts from PanelLeaf + TearoffShell"
```

---

### Task 2: Persistable Flag in panelLayout Store

**Files:**
- Modify: `src/renderer/src/stores/panelLayout.ts:305,346-367,527-535`
- Modify: `src/renderer/src/stores/__tests__/panelLayout.test.ts`

- [ ] **Step 1: Export findFirstLeaf**

At line 305 of `panelLayout.ts`, add `export`:

```typescript
export function findFirstLeaf(node: PanelNode): PanelLeafNode | null {
```

- [ ] **Step 2: Add persistable to state interface**

In the `PanelLayoutState` interface (~line 346), add:

```typescript
persistable: boolean
setPersistable: (value: boolean) => void
```

- [ ] **Step 3: Add to store default and action**

In the `create<PanelLayoutState>` call, add:

```typescript
persistable: true,
setPersistable: (value) => set({ persistable: value }),
```

- [ ] **Step 4: Guard the persist subscriber**

At the bottom of the file (~line 527), modify the subscriber:

```typescript
usePanelLayoutStore.subscribe((state) => {
  if (!state.persistable) return  // tear-off windows skip persistence
  if (typeof window === 'undefined' || !window.api?.settings) return
  if (_saveTimeout) clearTimeout(_saveTimeout)
  _saveTimeout = setTimeout(() => {
    window.api.settings.setJson('panel.layout', state.root).catch(() => {})
  }, 500)
})
```

- [ ] **Step 5: Add test for persistable flag**

In `panelLayout.test.ts`, add:

```typescript
it('subscriber skips persistence when persistable is false', () => {
  // set persistable false, mutate root, verify settings.setJson NOT called
})
```

- [ ] **Step 6: Run tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/panelLayout.ts src/renderer/src/stores/__tests__/panelLayout.test.ts
git commit -m "feat(tearoff): add persistable flag to panelLayout store"
```

---

### Task 3: TearoffTabBar Component

**Files:**
- Create: `src/renderer/src/components/layout/TearoffTabBar.tsx`
- Create: `src/renderer/src/components/layout/__tests__/TearoffTabBar.test.tsx`

- [ ] **Step 1: Write tests**

Test:
- Renders tab labels for each tab
- Active tab has `--active` class
- Close button calls onCloseTab with correct index
- Click on tab calls onSelectTab with correct index
- Tabs are draggable

- [ ] **Step 2: Implement TearoffTabBar**

```typescript
import { X } from 'lucide-react'
import type { PanelTab } from '../../stores/panelLayout'

interface TearoffTabBarProps {
  tabs: PanelTab[]
  activeTab: number
  onSelectTab: (index: number) => void
  onCloseTab: (index: number) => void
}

export function TearoffTabBar({ tabs, activeTab, onSelectTab, onCloseTab }: TearoffTabBarProps) {
  return (
    <div className="tearoff-tab-bar" role="tablist" aria-label="Panel tabs">
      {tabs.map((tab, i) => (
        <div
          key={`${tab.viewKey}-${i}`}
          role="tab"
          aria-selected={i === activeTab}
          className={`tearoff-tab${i === activeTab ? ' tearoff-tab--active' : ''}`}
          onClick={() => onSelectTab(i)}
        >
          <span className="tearoff-tab__label">{tab.label}</span>
          {tabs.length > 1 && (
            <button
              className="tearoff-tab__close"
              onClick={(e) => { e.stopPropagation(); onCloseTab(i) }}
              aria-label={`Close ${tab.label}`}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Add CSS to tearoff-shell.css**

```css
.tearoff-tab-bar {
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--neon-purple-border);
  background: var(--neon-surface-deep);
  flex-shrink: 0;
}

.tearoff-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--neon-text-dim);
  cursor: pointer;
  border-right: 1px solid var(--neon-surface-dim);
  transition: color 100ms ease, background 100ms ease;
  white-space: nowrap;
}

.tearoff-tab:hover {
  color: var(--neon-text-muted);
  background: var(--neon-surface-dim);
}

.tearoff-tab--active {
  color: var(--neon-text);
  background: var(--neon-bg);
  border-top: 2px solid var(--neon-cyan);
}

.tearoff-tab__close {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 100ms ease;
}

.tearoff-tab:hover .tearoff-tab__close {
  opacity: 0.6;
}

.tearoff-tab__close:hover {
  opacity: 1;
  background: var(--neon-surface-subtle);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/layout/__tests__/TearoffTabBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/layout/TearoffTabBar.tsx src/renderer/src/components/layout/__tests__/TearoffTabBar.test.tsx src/renderer/src/assets/tearoff-shell.css
git commit -m "feat(tearoff): TearoffTabBar component for panel mode"
```

---

### Task 4: Return All IPC

**Files:**
- Modify: `src/shared/ipc-channels.ts:299-312`
- Modify: `src/preload/index.ts:265-319`
- Modify: `src/preload/index.d.ts:234-250`
- Modify: `src/main/tearoff-manager.ts:340+`

- [ ] **Step 1: Add channel type**

In `TearoffChannels` interface of `ipc-channels.ts`, this is a `send` channel so it doesn't go in the typed map. Skip this file.

- [ ] **Step 2: Add preload method**

In `src/preload/index.ts`, add to tearoff namespace:

```typescript
returnAll: (payload: { windowId: string; views: string[] }) =>
  ipcRenderer.send('tearoff:returnAll', payload),
```

- [ ] **Step 3: Add type declaration**

In `src/preload/index.d.ts`, add to tearoff type:

```typescript
returnAll: (payload: { windowId: string; views: string[] }) => void
```

- [ ] **Step 4: Add main process handler**

In `src/main/tearoff-manager.ts`, inside `registerTearoffHandlers()`, add:

```typescript
ipcMain.on('tearoff:returnAll', (_event, payload: { windowId: string; views: string[] }) => {
  const { windowId, views } = payload ?? {}
  const entry = tearoffWindows.get(windowId)
  if (!entry) {
    logger.warn(`[tearoff] returnAll: unknown windowId ${windowId}`)
    return
  }

  const mainWin = getMainWindow()
  if (mainWin && !mainWin.isDestroyed()) {
    for (const view of views) {
      mainWin.webContents.send('tearoff:tabReturned', { windowId, view })
    }
  }

  tearoffWindows.delete(windowId)
  clearResizeTimer(windowId)
  try { entry.win.destroy() } catch { /* already destroyed */ }
  logger.info(`[tearoff] returnAll: returned ${views.length} views from ${windowId}`)
})
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts src/main/tearoff-manager.ts
git commit -m "feat(tearoff): returnAll IPC for bulk tab return"
```

---

### Task 5: Upgrade TearoffShell to Panel Mode

**Files:**
- Modify: `src/renderer/src/components/layout/TearoffShell.tsx:89-170`

This is the core task. Modify TearoffShell to:

- [ ] **Step 1: Initialize store on mount**

On mount, set `persistable = false` and initialize the store with the initial view:

```typescript
useEffect(() => {
  usePanelLayoutStore.getState().setPersistable(false)
  // Initialize store with the view from query params
  const leaf = createLeaf(view)
  usePanelLayoutStore.setState({
    root: leaf,
    focusedPanelId: leaf.panelId,
    activeView: view
  })
}, [])  // only on mount
```

- [ ] **Step 2: Derive mode from store**

Replace the static single-view rendering with mode-based rendering:

```typescript
const root = usePanelLayoutStore((s) => s.root)
const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)

const isMultiTab = root.type === 'split' || (root.type === 'leaf' && root.tabs.length > 1)
const focusedLeaf = focusedPanelId ? findLeaf(root, focusedPanelId) : null
```

- [ ] **Step 3: Upgrade crossWindowDrop handler**

Replace the current stub (~line 116-122) with real logic:

```typescript
useEffect(() => {
  if (!window.api?.tearoff?.onCrossWindowDrop) return
  return window.api.tearoff.onCrossWindowDrop((payload) => {
    const store = usePanelLayoutStore.getState()
    if (payload.zone === 'center') {
      store.addTab(payload.targetPanelId || store.focusedPanelId || '', payload.view as View)
    } else {
      const direction = (payload.zone === 'left' || payload.zone === 'right') ? 'horizontal' : 'vertical'
      const targetId = payload.targetPanelId || store.focusedPanelId || ''
      store.splitPanel(targetId, direction, payload.view as View)
    }
  })
}, [])
```

- [ ] **Step 4: Add Return All handler**

```typescript
function handleReturnAll() {
  const views = getOpenViews(usePanelLayoutStore.getState().root)
  window.api?.tearoff?.returnAll({ windowId, views: views as string[] })
}
```

- [ ] **Step 5: Add keyboard shortcuts for panel mode**

```typescript
useEffect(() => {
  if (!isMultiTab) return
  const handler = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === 'w') {
      e.preventDefault()
      // Close focused tab
      if (focusedLeaf && focusedLeaf.tabs.length > 0) {
        usePanelLayoutStore.getState().closeTab(focusedLeaf.panelId, focusedLeaf.activeTab)
      }
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [isMultiTab, focusedLeaf])
```

- [ ] **Step 6: Update render for conditional mode**

```tsx
return (
  <div className="tearoff-shell">
    <header className="tearoff-shell__header">
      <span className="tearoff-shell__title">
        {isMultiTab ? '' : label}
      </span>
      <div className="tearoff-shell__actions">
        {isMultiTab && (
          <button className="tearoff-shell__btn" onClick={handleReturnAll}
            aria-label="Return all tabs to main window" title="Return all">
            <Undo2 size={14} />
          </button>
        )}
        {!isMultiTab && (
          <button className="tearoff-shell__btn" onClick={handleReturn}
            aria-label="Return to main window" title="Return to main window">
            <Undo2 size={14} />
          </button>
        )}
      </div>
    </header>

    {isMultiTab && focusedLeaf && (
      <TearoffTabBar
        tabs={focusedLeaf.tabs}
        activeTab={focusedLeaf.activeTab}
        onSelectTab={(i) => usePanelLayoutStore.getState().setActiveTab(focusedLeaf.panelId, i)}
        onCloseTab={(i) => usePanelLayoutStore.getState().closeTab(focusedLeaf.panelId, i)}
      />
    )}

    <main className="tearoff-shell__content">
      {isMultiTab ? (
        <PanelRenderer node={root} />
      ) : (
        <Suspense fallback={null}>{resolveView(view)}</Suspense>
      )}
    </main>

    {/* Overlays */}
    <CrossWindowDropOverlay
      active={crossDrop.active}
      localX={crossDrop.localX}
      localY={crossDrop.localY}
      viewKey={crossDrop.viewKey ?? ''}
      onDrop={crossDrop.handleDrop}
    />
    {showDialog && <CloseDialog onClose={handleDialogClose} />}
  </div>
)
```

- [ ] **Step 7: Import new dependencies**

Add imports for: `PanelRenderer`, `TearoffTabBar`, `createLeaf`, `findLeaf`, `getOpenViews`, `findFirstLeaf`, `usePanelLayoutStore`, `View`

- [ ] **Step 8: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/layout/TearoffShell.tsx
git commit -m "feat(tearoff): upgrade TearoffShell to panel mode with tab bar"
```

---

### Task 6: Update Tests + Integration

**Files:**
- Modify: `src/renderer/src/components/layout/__tests__/TearoffShell.test.tsx`
- Modify: integration tests if handler counts changed

- [ ] **Step 1: Add panel mode tests to TearoffShell**

Add tests:
- Initializes store with `persistable: false` on mount
- Renders single-view when store has one tab
- Renders PanelRenderer when store has multiple tabs (mock PanelRenderer)
- Shows TearoffTabBar in panel mode
- "Return All" button visible in panel mode
- crossWindowDrop handler adds tab to store

- [ ] **Step 2: Update handler registration tests if needed**

Check if `tearoff:returnAll` (ipcMain.on) needs to be in `allowedExtras`.

- [ ] **Step 3: Run full suite**

Run: `npm run typecheck && npm test && npm run test:main`
Expected: ALL PASS

- [ ] **Step 4: Run coverage**

Run: `npm run test:coverage 2>&1 | grep ERROR`
Expected: No threshold failures

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tearoff): multi-tab tear-off windows complete"
```

---

### Task 7: Manual Testing

- [ ] **Step 1: Build and run**

```bash
npx electron-rebuild -f -w better-sqlite3
npm run dev
```

- [ ] **Step 2: Test single → panel transition**

1. Right-click sidebar → "Open in New Window" (Agents)
2. In main window, drag another tab (Settings) off the window toward the tear-off
3. Drop into the tear-off center → tab bar should appear with [Agents] [Settings]
4. Click each tab to verify switching works

- [ ] **Step 3: Test splitting**

1. Drag a tab from main window into tear-off edge zone
2. Verify: tear-off splits into two panes side-by-side

- [ ] **Step 4: Test Return All**

1. Multi-tab tear-off with 3 views
2. Click "Return All" button
3. Verify: all 3 tabs appear in main window, tear-off closes

- [ ] **Step 5: Test tab close**

1. Multi-tab tear-off → close one tab via X button
2. Verify: remaining tabs stay, layout adjusts

- [ ] **Step 6: Test Cmd+W**

1. Focus a tab in multi-tab tear-off
2. Press Cmd+W → tab closes

- [ ] **Step 7: Final commit if any polish needed**

```bash
git commit -m "feat(tearoff): multi-tab polish"
```

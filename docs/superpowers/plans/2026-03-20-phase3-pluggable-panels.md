# Phase 3: Pluggable Panel Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BDE's single-view-at-a-time layout with a VS Code-style dockable panel system using a recursive PanelNode tree, drag-and-drop docking, tab groups, and layout persistence.

**Architecture:** Three phases — 3a builds panel infrastructure with zero UX change (same single-view behavior, new engine underneath), 3b adds drag-and-drop docking and multi-panel, 3c adds keyboard shortcuts, persistence, and terminal xterm handling.

**Tech Stack:** TypeScript, React, Zustand, `react-resizable-panels` (already installed v4.7.2), HTML5 Drag and Drop API

**Spec:** `docs/superpowers/specs/2026-03-20-phase3-pluggable-panels-design.md`

---

## File Structure

### New Files

```
src/renderer/src/stores/panelLayout.ts                     # PanelNode tree types, state, mutations
src/renderer/src/components/panels/
├── PanelRenderer.tsx                                       # Recursive tree → react-resizable-panels
├── PanelLeaf.tsx                                           # Tab bar + view content wrapper
├── PanelTabBar.tsx                                         # Draggable tab strip
├── PanelDropOverlay.tsx                                    # 5-zone drop target overlay
├── PanelResizeHandle.tsx                                   # Styled resize handle
├── panelCss.ts                                             # Panel CSS-in-JS (inline styles with tokens)
└── __tests__/
    ├── panelLayout.test.ts                                 # Tree mutation pure function tests
    ├── PanelRenderer.test.tsx                              # Rendering tests
    ├── PanelTabBar.test.tsx                                # Tab bar interaction tests
    └── PanelDropOverlay.test.tsx                           # Drop zone hit-testing tests
```

### Key Modified Files

| File                                                    | Phase | Change                                                      |
| ------------------------------------------------------- | ----- | ----------------------------------------------------------- |
| `src/renderer/src/App.tsx`                              | 3a    | Replace `ViewRouter` with `<PanelRenderer>`                 |
| `src/renderer/src/stores/ui.ts`                         | 3a    | Add `useActiveView()` compat helper, keep `setView` working |
| `src/renderer/src/components/layout/ActivityBar.tsx`    | 3b    | Open dots, right-click menu, drag source                    |
| `src/renderer/src/components/layout/CommandPalette.tsx` | 3c    | Add panel commands (split, close, reset)                    |
| `src/renderer/src/assets/main.css`                      | 3a    | Panel CSS classes                                           |
| `CLAUDE.md`                                             | 3c    | Document panel architecture                                 |

---

## Phase 3a: Panel Infrastructure

### Task 1: PanelNode Types + Tree Mutation Functions

**Files:**

- Create: `src/renderer/src/stores/panelLayout.ts`
- Create: `src/renderer/src/components/panels/__tests__/panelLayout.test.ts`

- [ ] **Step 1: Write failing tests for tree types and pure mutation functions**

```typescript
// src/renderer/src/components/panels/__tests__/panelLayout.test.ts
import { describe, it, expect } from 'vitest'
import {
  type PanelNode,
  createLeaf,
  DEFAULT_LAYOUT,
  splitNode,
  closeTab,
  addTab,
  collapseIfNeeded,
  findLeaf,
  getOpenViews
} from '../../../stores/panelLayout'

describe('panelLayout tree mutations', () => {
  it('createLeaf creates a leaf with one tab', () => {
    const leaf = createLeaf('agents')
    expect(leaf.type).toBe('leaf')
    expect(leaf.tabs).toHaveLength(1)
    expect(leaf.tabs[0].viewKey).toBe('agents')
    expect(leaf.activeTab).toBe(0)
  })

  it('DEFAULT_LAYOUT is a single agents leaf', () => {
    expect(DEFAULT_LAYOUT.type).toBe('leaf')
    if (DEFAULT_LAYOUT.type === 'leaf') {
      expect(DEFAULT_LAYOUT.tabs[0].viewKey).toBe('agents')
    }
  })

  it('splitNode replaces a leaf with a split containing original + new', () => {
    const root = createLeaf('agents')
    const result = splitNode(root, root.panelId, 'horizontal', 'terminal')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.direction).toBe('horizontal')
      expect(result.children).toHaveLength(2)
      expect(result.sizes).toEqual([50, 50])
    }
  })

  it('splitNode works on nested trees', () => {
    const root = splitNode(
      createLeaf('agents'),
      createLeaf('agents').panelId,
      'horizontal',
      'terminal'
    )
    // root is split(agents, terminal) — now split the terminal panel vertically
    if (root.type === 'split' && root.children[1].type === 'leaf') {
      const terminalId = root.children[1].panelId
      const result = splitNode(root, terminalId, 'vertical', 'sprint')
      // Right side should now be a vertical split
      expect(result.type).toBe('split')
      if (result.type === 'split') {
        expect(result.children[1].type).toBe('split')
      }
    }
  })

  it('addTab adds a tab to the target leaf', () => {
    const root = createLeaf('agents')
    const result = addTab(root, root.panelId, 'sprint')
    if (result.type === 'leaf') {
      expect(result.tabs).toHaveLength(2)
      expect(result.tabs[1].viewKey).toBe('sprint')
      expect(result.activeTab).toBe(1) // switches to new tab
    }
  })

  it('closeTab removes a tab from a leaf', () => {
    let root = createLeaf('agents')
    root = addTab(root, root.panelId, 'sprint') as typeof root
    if (root.type === 'leaf') {
      const result = closeTab(root, root.panelId, 0)
      if (result && result.type === 'leaf') {
        expect(result.tabs).toHaveLength(1)
        expect(result.tabs[0].viewKey).toBe('sprint')
      }
    }
  })

  it('closeTab returns null when removing last tab', () => {
    const root = createLeaf('agents')
    const result = closeTab(root, root.panelId, 0)
    expect(result).toBeNull()
  })

  it('collapseIfNeeded removes split with single child', () => {
    // Manually create a split where one child is null (simulating closed leaf)
    const leaf = createLeaf('agents')
    expect(
      collapseIfNeeded({
        type: 'split',
        direction: 'horizontal',
        children: [leaf, null as any],
        sizes: [50, 50]
      })
    ).toBe(leaf)
  })

  it('findLeaf finds a leaf by panelId', () => {
    const root = createLeaf('agents')
    const found = findLeaf(root, root.panelId)
    expect(found).toBe(root)
  })

  it('getOpenViews returns all viewKeys in the tree', () => {
    let root: PanelNode = createLeaf('agents')
    root = splitNode(root, (root as any).panelId, 'horizontal', 'terminal')
    const views = getOpenViews(root)
    expect(views).toContain('agents')
    expect(views).toContain('terminal')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose src/renderer/src/components/panels/__tests__/panelLayout.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement panelLayout store with types and pure mutation functions**

Create `src/renderer/src/stores/panelLayout.ts`:

```typescript
import { create } from 'zustand'
import { randomUUID } from '../lib/uuid' // or use crypto.randomUUID / simple counter

// --- Types ---

export type View = 'agents' | 'terminal' | 'sprint' | 'pr-station' | 'memory' | 'cost' | 'settings'

export const VIEW_LABELS: Record<View, string> = {
  agents: 'Agents',
  terminal: 'Terminal',
  sprint: 'Sprint',
  'pr-station': 'PR Station',
  memory: 'Memory',
  cost: 'Cost',
  settings: 'Settings'
}

export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface PanelTab {
  viewKey: View
  label: string
}

export interface PanelLeafNode {
  type: 'leaf'
  panelId: string
  tabs: PanelTab[]
  activeTab: number
}

export interface PanelSplitNode {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: [PanelNode, PanelNode]
  sizes: [number, number]
}

export type PanelNode = PanelLeafNode | PanelSplitNode

// --- Pure Functions ---

let _idCounter = 0
function nextId(): string {
  return 'p' + ++_idCounter
}
// For tests: reset counter
export function _resetIdCounter(): void {
  _idCounter = 0
}

export function createLeaf(viewKey: View): PanelLeafNode {
  return {
    type: 'leaf',
    panelId: nextId(),
    tabs: [{ viewKey, label: VIEW_LABELS[viewKey] }],
    activeTab: 0
  }
}

export const DEFAULT_LAYOUT: PanelNode = createLeaf('agents')

export function findLeaf(node: PanelNode, panelId: string): PanelLeafNode | null {
  if (node.type === 'leaf') return node.panelId === panelId ? node : null
  return findLeaf(node.children[0], panelId) ?? findLeaf(node.children[1], panelId)
}

export function getOpenViews(node: PanelNode): View[] {
  if (node.type === 'leaf') return node.tabs.map((t) => t.viewKey)
  return [...getOpenViews(node.children[0]), ...getOpenViews(node.children[1])]
}

export function splitNode(
  root: PanelNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  viewKey: View
): PanelNode {
  if (root.type === 'leaf') {
    if (root.panelId === targetId) {
      return {
        type: 'split',
        direction,
        children: [root, createLeaf(viewKey)],
        sizes: [50, 50]
      }
    }
    return root
  }
  return {
    ...root,
    children: [
      splitNode(root.children[0], targetId, direction, viewKey),
      splitNode(root.children[1], targetId, direction, viewKey)
    ]
  }
}

export function addTab(root: PanelNode, targetId: string, viewKey: View): PanelNode {
  if (root.type === 'leaf') {
    if (root.panelId === targetId) {
      const newTabs = [...root.tabs, { viewKey, label: VIEW_LABELS[viewKey] }]
      return { ...root, tabs: newTabs, activeTab: newTabs.length - 1 }
    }
    return root
  }
  return {
    ...root,
    children: [
      addTab(root.children[0], targetId, viewKey),
      addTab(root.children[1], targetId, viewKey)
    ]
  }
}

export function closeTab(root: PanelNode, targetId: string, tabIndex: number): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return root
    const newTabs = root.tabs.filter((_, i) => i !== tabIndex)
    if (newTabs.length === 0) return null
    return { ...root, tabs: newTabs, activeTab: Math.min(root.activeTab, newTabs.length - 1) }
  }
  const left = closeTab(root.children[0], targetId, tabIndex)
  const right = closeTab(root.children[1], targetId, tabIndex)
  if (!left) return right
  if (!right) return left
  return { ...root, children: [left, right] }
}

export function collapseIfNeeded(node: PanelNode): PanelNode {
  if (node.type !== 'split') return node
  if (!node.children[0]) return node.children[1]
  if (!node.children[1]) return node.children[0]
  return node
}

export function setActiveTab(root: PanelNode, panelId: string, tabIndex: number): PanelNode {
  if (root.type === 'leaf') {
    if (root.panelId === panelId) return { ...root, activeTab: tabIndex }
    return root
  }
  return {
    ...root,
    children: [
      setActiveTab(root.children[0], panelId, tabIndex),
      setActiveTab(root.children[1], panelId, tabIndex)
    ]
  }
}

// --- Zustand Store ---

interface PanelLayoutState {
  root: PanelNode
  focusedPanelId: string
  splitPanel: (panelId: string, direction: 'horizontal' | 'vertical', viewKey: View) => void
  closeTab: (panelId: string, tabIndex: number) => void
  addTab: (panelId: string, viewKey: View) => void
  setActiveTab: (panelId: string, tabIndex: number) => void
  focusPanel: (panelId: string) => void
  resetLayout: () => void
  findPanelByView: (viewKey: View) => string | null
  getOpenViews: () => View[]
}

export const usePanelLayoutStore = create<PanelLayoutState>((set, get) => ({
  root: DEFAULT_LAYOUT,
  focusedPanelId: (DEFAULT_LAYOUT as PanelLeafNode).panelId,

  splitPanel: (panelId, direction, viewKey) => {
    set((s) => ({ root: splitNode(s.root, panelId, direction, viewKey) }))
  },

  closeTab: (panelId, tabIndex) => {
    set((s) => {
      const result = closeTab(s.root, panelId, tabIndex)
      if (!result) return { root: createLeaf('agents'), focusedPanelId: '' }
      return { root: result }
    })
  },

  addTab: (panelId, viewKey) => {
    set((s) => ({ root: addTab(s.root, panelId, viewKey) }))
  },

  setActiveTab: (panelId, tabIndex) => {
    set((s) => ({ root: setActiveTab(s.root, panelId, tabIndex) }))
  },

  focusPanel: (panelId) => set({ focusedPanelId: panelId }),

  resetLayout: () => {
    const leaf = createLeaf('agents')
    set({ root: leaf, focusedPanelId: leaf.panelId })
  },

  findPanelByView: (viewKey) => {
    const search = (node: PanelNode): string | null => {
      if (node.type === 'leaf')
        return node.tabs.some((t) => t.viewKey === viewKey) ? node.panelId : null
      return search(node.children[0]) ?? search(node.children[1])
    }
    return search(get().root)
  },

  getOpenViews: () => getOpenViews(get().root)
}))
```

Note: Check if `crypto.randomUUID()` works in the renderer. If not, use a simple incrementing counter (`p1`, `p2`, ...) which is simpler and sufficient for panel IDs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --reporter=verbose src/renderer/src/components/panels/__tests__/panelLayout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/panelLayout.ts src/renderer/src/components/panels/__tests__/panelLayout.test.ts
git commit -m "feat(panels): add PanelNode tree types and mutation functions"
```

---

### Task 2: PanelLeaf Component

**Files:**

- Create: `src/renderer/src/components/panels/PanelLeaf.tsx`

- [ ] **Step 1: Create PanelLeaf**

This component renders a single panel leaf — tab bar (if multiple tabs) + view content:

```typescript
// src/renderer/src/components/panels/PanelLeaf.tsx
import { Suspense, lazy } from 'react'
import { X } from 'lucide-react'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { tokens } from '../../design-system/tokens'
import { usePanelLayoutStore, type View, type PanelLeafNode } from '../../stores/panelLayout'

// Eager views
import { AgentsView } from '../../views/AgentsView'
import { TerminalView } from '../../views/TerminalView'

// Lazy views
const SprintView = lazy(() => import('../../views/SprintView'))
const MemoryView = lazy(() => import('../../views/MemoryView'))
const CostView = lazy(() => import('../../views/CostView'))
const SettingsView = lazy(() => import('../../views/SettingsView'))
const PRStationView = lazy(() => import('../../views/PRStationView'))

const VIEW_COMPONENTS: Record<View, React.ComponentType> = {
  agents: AgentsView,
  terminal: TerminalView,
  sprint: SprintView as unknown as React.ComponentType,
  memory: MemoryView as unknown as React.ComponentType,
  cost: CostView as unknown as React.ComponentType,
  settings: SettingsView as unknown as React.ComponentType,
  'pr-station': PRStationView as unknown as React.ComponentType,
}

function ViewSkeleton() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: tokens.color.surfaceHigh }} />
    </div>
  )
}

interface PanelLeafProps {
  node: PanelLeafNode
}

export function PanelLeaf({ node }: PanelLeafProps) {
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId)
  const focusPanel = usePanelLayoutStore((s) => s.focusPanel)
  const setActiveTab = usePanelLayoutStore((s) => s.setActiveTab)
  const closeTabAction = usePanelLayoutStore((s) => s.closeTab)
  const isFocused = focusedPanelId === node.panelId
  const showTabBar = node.tabs.length > 1

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        outline: isFocused ? `1px solid ${tokens.color.accent}` : '1px solid transparent',
        borderRadius: tokens.radius.sm,
      }}
      onClick={() => focusPanel(node.panelId)}
    >
      {/* Tab bar — only shown when multiple tabs */}
      {showTabBar && (
        <div style={{
          display: 'flex',
          height: 28,
          background: tokens.color.surface,
          borderBottom: `1px solid ${tokens.color.border}`,
          flexShrink: 0,
        }}>
          {node.tabs.map((tab, i) => (
            <div
              key={`${tab.viewKey}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.space[1],
                padding: `0 ${tokens.space[2]}`,
                fontSize: tokens.size.xs,
                color: i === node.activeTab ? tokens.color.text : tokens.color.textMuted,
                background: i === node.activeTab ? tokens.color.surfaceHigh : 'transparent',
                borderRight: `1px solid ${tokens.color.border}`,
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={(e) => { e.stopPropagation(); setActiveTab(node.panelId, i) }}
            >
              <span>{tab.label}</span>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'none',
                  border: 'none',
                  color: tokens.color.textDim,
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={(e) => { e.stopPropagation(); closeTabAction(node.panelId, i) }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* View content — all tabs mounted, only active visible */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {node.tabs.map((tab, i) => {
          const ViewComponent = VIEW_COMPONENTS[tab.viewKey]
          return (
            <div
              key={`${tab.viewKey}-${i}`}
              style={{
                display: i === node.activeTab ? 'flex' : 'none',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            >
              <ErrorBoundary name={tab.label}>
                <Suspense fallback={<ViewSkeleton />}>
                  <ViewComponent />
                </Suspense>
              </ErrorBoundary>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/panels/PanelLeaf.tsx
git commit -m "feat(panels): add PanelLeaf component with tab bar and view mounting"
```

---

### Task 3: PanelResizeHandle + PanelRenderer

**Files:**

- Create: `src/renderer/src/components/panels/PanelResizeHandle.tsx`
- Create: `src/renderer/src/components/panels/PanelRenderer.tsx`
- Create: `src/renderer/src/components/panels/__tests__/PanelRenderer.test.tsx`

- [ ] **Step 1: Create PanelResizeHandle**

```typescript
// src/renderer/src/components/panels/PanelResizeHandle.tsx
import { PanelResizeHandle as ResizeHandle } from 'react-resizable-panels'
import { tokens } from '../../design-system/tokens'

export function PanelResizeHandle({ direction }: { direction: 'horizontal' | 'vertical' }) {
  const isVertical = direction === 'vertical'
  return (
    <ResizeHandle
      style={{
        width: isVertical ? '100%' : 4,
        height: isVertical ? 4 : '100%',
        background: 'transparent',
        cursor: isVertical ? 'row-resize' : 'col-resize',
        transition: tokens.transition.fast,
      }}
    />
  )
}
```

- [ ] **Step 2: Create PanelRenderer**

Recursive component that walks the PanelNode tree:

```typescript
// src/renderer/src/components/panels/PanelRenderer.tsx
import { PanelGroup, Panel } from 'react-resizable-panels'
import { PanelLeaf } from './PanelLeaf'
import { PanelResizeHandle } from './PanelResizeHandle'
import type { PanelNode } from '../../stores/panelLayout'

interface PanelRendererProps {
  node: PanelNode
}

export function PanelRenderer({ node }: PanelRendererProps) {
  if (node.type === 'leaf') {
    return <PanelLeaf node={node} />
  }

  return (
    <PanelGroup direction={node.direction}>
      <Panel defaultSize={node.sizes[0]} minSize={10}>
        <PanelRenderer node={node.children[0]} />
      </Panel>
      <PanelResizeHandle direction={node.direction} />
      <Panel defaultSize={node.sizes[1]} minSize={10}>
        <PanelRenderer node={node.children[1]} />
      </Panel>
    </PanelGroup>
  )
}
```

- [ ] **Step 3: Write tests for PanelRenderer**

```typescript
// src/renderer/src/components/panels/__tests__/PanelRenderer.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PanelRenderer } from '../PanelRenderer'
import { createLeaf, splitNode, _resetIdCounter } from '../../../stores/panelLayout'

// Mock react-resizable-panels
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="panel">{children}</div>,
  PanelResizeHandle: () => <div data-testid="resize-handle" />,
}))

// Mock all view components
vi.mock('../../../views/AgentsView', () => ({ AgentsView: () => <div>Agents</div> }))
vi.mock('../../../views/TerminalView', () => ({ TerminalView: () => <div>Terminal</div> }))
vi.mock('../../../views/SprintView', () => ({ default: () => <div>Sprint</div> }))
vi.mock('../../../views/MemoryView', () => ({ default: () => <div>Memory</div> }))
vi.mock('../../../views/CostView', () => ({ default: () => <div>Cost</div> }))
vi.mock('../../../views/SettingsView', () => ({ default: () => <div>Settings</div> }))
vi.mock('../../../views/PRStationView', () => ({ default: () => <div>PRStation</div> }))

describe('PanelRenderer', () => {
  beforeEach(() => _resetIdCounter())

  it('renders a single leaf', () => {
    const { getByText } = render(<PanelRenderer node={createLeaf('agents')} />)
    expect(getByText('Agents')).toBeDefined()
  })

  it('renders a horizontal split with two leaves', () => {
    const leaf = createLeaf('agents')
    const root = splitNode(leaf, leaf.panelId, 'horizontal', 'terminal')
    const { getAllByTestId, getByText } = render(<PanelRenderer node={root} />)

    expect(getAllByTestId('panel-group')).toHaveLength(1)
    expect(getAllByTestId('panel')).toHaveLength(2)
    expect(getByText('Agents')).toBeDefined()
    expect(getByText('Terminal')).toBeDefined()
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --reporter=verbose src/renderer/src/components/panels/__tests__/PanelRenderer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/panels/PanelResizeHandle.tsx src/renderer/src/components/panels/PanelRenderer.tsx src/renderer/src/components/panels/__tests__/PanelRenderer.test.tsx
git commit -m "feat(panels): add PanelRenderer with recursive tree rendering"
```

---

### Task 4: Replace ViewRouter with PanelRenderer in App.tsx

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/stores/ui.ts`

- [ ] **Step 1: Add useActiveView compat helper to ui.ts**

Keep the existing `useUIStore` working by deriving `activeView` from the panel tree. In `src/renderer/src/stores/ui.ts`:

```typescript
import { create } from 'zustand'
import { usePanelLayoutStore, type View, findLeaf } from './panelLayout'

export type { View } from './panelLayout'

interface UIStore {
  activeView: View
  setView: (view: View) => void
}

// Compat store — reads from panel layout, setView opens/focuses the view
export const useUIStore = create<UIStore>((set) => ({
  activeView: 'agents',
  setView: (view) => {
    const store = usePanelLayoutStore.getState()
    const existing = store.findPanelByView(view)
    if (existing) {
      store.focusPanel(existing)
      // Also activate the tab if it's not the active one
      const leaf = findLeaf(store.root, existing)
      if (leaf) {
        const tabIdx = leaf.tabs.findIndex((t) => t.viewKey === view)
        if (tabIdx >= 0 && tabIdx !== leaf.activeTab) {
          store.setActiveTab(existing, tabIdx)
        }
      }
    } else {
      // Open as new tab in focused panel
      store.addTab(store.focusedPanelId, view)
    }
    set({ activeView: view })
  }
}))

// Subscribe to panel layout changes to keep activeView in sync
usePanelLayoutStore.subscribe((state) => {
  const focused = findLeaf(state.root, state.focusedPanelId)
  if (focused) {
    const activeTab = focused.tabs[focused.activeTab]
    if (activeTab) {
      useUIStore.setState({ activeView: activeTab.viewKey })
    }
  }
})
```

- [ ] **Step 2: Replace ViewRouter in App.tsx**

In `src/renderer/src/App.tsx`:

- Remove the `ViewRouter` component entirely (lines 74-122)
- Remove view-specific imports that are now handled by PanelLeaf: `AgentsView`, `TerminalView`, lazy imports for Sprint/Memory/Cost/Settings/PRStation
- Add: `import { PanelRenderer } from './components/panels/PanelRenderer'`
- Add: `import { usePanelLayoutStore } from './stores/panelLayout'`
- In the `App` component, add: `const root = usePanelLayoutStore((s) => s.root)`
- Replace `<ViewRouter activeView={activeView} />` with `<PanelRenderer node={root} />`
- Keep all keyboard shortcut handling — `Cmd+1-7` still calls `setView()` which now operates on the panel tree

- [ ] **Step 3: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS — app renders identically (single Agents panel as default)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/stores/ui.ts
git commit -m "feat(panels): replace ViewRouter with PanelRenderer in App.tsx"
```

---

### Task 5: Panel CSS

**Files:**

- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Add panel CSS classes**

Add to `src/renderer/src/assets/main.css`:

```css
/* --- Panel System --- */

.panel-leaf {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-leaf--focused {
  outline: 1px solid var(--bde-accent);
  border-radius: 4px;
}

.panel-tab-bar {
  display: flex;
  height: 28px;
  background: var(--bde-surface);
  border-bottom: 1px solid var(--bde-border);
  flex-shrink: 0;
  overflow-x: auto;
}

.panel-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  font-size: 11px;
  border-right: 1px solid var(--bde-border);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  color: var(--bde-text-muted);
}

.panel-tab--active {
  color: var(--bde-text);
  background: var(--bde-surface-high);
}

.panel-tab__close {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: var(--bde-text-dim);
  cursor: pointer;
  padding: 0;
  border-radius: 2px;
}

.panel-tab__close:hover {
  color: var(--bde-text);
  background: var(--bde-border);
}
```

- [ ] **Step 2: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/assets/main.css
git commit -m "feat(panels): add panel CSS classes"
```

---

### Task 6: Smoke Test + Verify Phase 3a

**Files:**

- Modify: `src/renderer/src/views/__tests__/smoke.test.tsx`

- [ ] **Step 1: Update smoke test mocks for panel layout**

Add mock for the panelLayout store in the smoke test. The existing `useUIStore` mock should still work via the compat layer.

- [ ] **Step 2: Run full test suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: ALL PASS — app is functionally identical to before (single panel, same shortcuts)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(panels): update smoke tests for panel layout"
```

**CHECKPOINT:** Phase 3a complete. The panel infrastructure is in place, default layout is a single Agents panel, app looks and behaves exactly the same. From here, Phase 3b adds multi-panel capabilities.

---

## Phase 3b: Docking + Multi-Panel

### Task 7: PanelTabBar with Drag Source

**Files:**

- Create: `src/renderer/src/components/panels/PanelTabBar.tsx`
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx` (extract tab bar)

- [ ] **Step 1: Create PanelTabBar as a separate component**

Extract the tab bar JSX from PanelLeaf into `PanelTabBar.tsx`. Add HTML5 drag source on each tab:

```typescript
// Key additions:
// - Each tab div gets: draggable={true}, onDragStart
// - onDragStart sets dataTransfer with { viewKey, sourcePanelId, sourceTabIndex }
// - onDragStart sets effectAllowed = 'move'
```

- [ ] **Step 2: Update PanelLeaf to use PanelTabBar**

Replace inline tab bar in PanelLeaf with `<PanelTabBar node={node} />`.

- [ ] **Step 3: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/panels/PanelTabBar.tsx src/renderer/src/components/panels/PanelLeaf.tsx
git commit -m "feat(panels): extract PanelTabBar with drag source"
```

---

### Task 8: PanelDropOverlay with 5-Zone Hit Testing

**Files:**

- Create: `src/renderer/src/components/panels/PanelDropOverlay.tsx`
- Create: `src/renderer/src/components/panels/__tests__/PanelDropOverlay.test.tsx`

- [ ] **Step 1: Write failing test for zone hit-testing**

```typescript
// src/renderer/src/components/panels/__tests__/PanelDropOverlay.test.tsx
import { describe, it, expect } from 'vitest'
import { getDropZone } from '../PanelDropOverlay'

describe('getDropZone', () => {
  // Panel rect: 0,0 to 400x300
  const rect = { left: 0, top: 0, width: 400, height: 300 }

  it('returns top for upper 25% strip', () => {
    expect(getDropZone(200, 30, rect)).toBe('top')
  })

  it('returns bottom for lower 25% strip', () => {
    expect(getDropZone(200, 270, rect)).toBe('bottom')
  })

  it('returns left for left 25% strip (excluding top/bottom)', () => {
    expect(getDropZone(50, 150, rect)).toBe('left')
  })

  it('returns right for right 25% strip (excluding top/bottom)', () => {
    expect(getDropZone(350, 150, rect)).toBe('right')
  })

  it('returns center for middle area', () => {
    expect(getDropZone(200, 150, rect)).toBe('center')
  })
})
```

- [ ] **Step 2: Implement PanelDropOverlay**

Export `getDropZone` function (pure geometry) and the overlay component:

```typescript
// src/renderer/src/components/panels/PanelDropOverlay.tsx
import { useState, useRef, useCallback } from 'react'
import type { DropZone } from '../../stores/panelLayout'

interface Rect { left: number; top: number; width: number; height: number }

export function getDropZone(x: number, y: number, rect: Rect): DropZone {
  const relX = x - rect.left
  const relY = y - rect.top
  const pctX = relX / rect.width
  const pctY = relY / rect.height

  if (pctY < 0.25) return 'top'
  if (pctY > 0.75) return 'bottom'
  if (pctX < 0.25) return 'left'
  if (pctX > 0.75) return 'right'
  return 'center'
}

interface PanelDropOverlayProps {
  panelId: string
  onDrop: (panelId: string, zone: DropZone, data: { viewKey: string; sourcePanelId?: string; sourceTabIndex?: number }) => void
}

export function PanelDropOverlay({ panelId, onDrop }: PanelDropOverlayProps) {
  const [activeZone, setActiveZone] = useState<DropZone | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setActiveZone(getDropZone(e.clientX, e.clientY, rect))
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!activeZone) return
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/bde-panel'))
      onDrop(panelId, activeZone, data)
    } catch { /* invalid drag data */ }
    setActiveZone(null)
  }, [activeZone, panelId, onDrop])

  const handleDragLeave = useCallback(() => setActiveZone(null), [])

  // Render highlight overlay for active zone
  return (
    <div
      ref={ref}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'all', zIndex: 10 }}
    >
      {activeZone && <ZoneHighlight zone={activeZone} />}
    </div>
  )
}

function ZoneHighlight({ zone }: { zone: DropZone }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    background: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 4,
    transition: 'all 100ms ease',
  }

  switch (zone) {
    case 'top': return <div style={{ ...style, top: 0, left: 0, right: 0, height: '50%' }} />
    case 'bottom': return <div style={{ ...style, bottom: 0, left: 0, right: 0, height: '50%' }} />
    case 'left': return <div style={{ ...style, top: 0, left: 0, bottom: 0, width: '50%' }} />
    case 'right': return <div style={{ ...style, top: 0, right: 0, bottom: 0, width: '50%' }} />
    case 'center': return <div style={{ ...style, inset: '10%' }} />
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --reporter=verbose src/renderer/src/components/panels/__tests__/PanelDropOverlay.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/panels/PanelDropOverlay.tsx src/renderer/src/components/panels/__tests__/PanelDropOverlay.test.tsx
git commit -m "feat(panels): add PanelDropOverlay with 5-zone hit testing"
```

---

### Task 9: Wire Drag-and-Drop into PanelLeaf

**Files:**

- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx`
- Modify: `src/renderer/src/stores/panelLayout.ts` (add `moveTab`)

- [ ] **Step 1: Add moveTab mutation to panelLayout store**

`moveTab(sourcePanelId, sourceTabIndex, targetPanelId, zone)`:

- If zone is 'center': remove tab from source, add to target
- If zone is edge: remove tab from source, split target in the zone direction

- [ ] **Step 2: Wire PanelDropOverlay into PanelLeaf**

Add `<PanelDropOverlay>` as an absolute-positioned child in PanelLeaf, shown only during drag (track via `onDragEnter`/`onDragLeave` on the leaf container). Wire `onDrop` to `moveTab` store action.

- [ ] **Step 3: Verify typecheck + manual test**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/panels/PanelLeaf.tsx src/renderer/src/stores/panelLayout.ts
git commit -m "feat(panels): wire drag-and-drop into PanelLeaf"
```

---

### Task 10: ActivityBar Drag Source + Open Indicators

**Files:**

- Modify: `src/renderer/src/components/layout/ActivityBar.tsx`

- [ ] **Step 1: Update ActivityBar**

Changes:

- Import `usePanelLayoutStore`
- Read `getOpenViews()` and `focusedPanelId` to determine open/focused state
- Add open indicator dot (small circle) next to icons for views in the tree
- Make view icons `draggable={true}` with `onDragStart` that sets `application/bde-panel` data
- Left-click behavior: if view is open → `focusPanel`, if closed → `addTab` to focused panel
- Add right-click context menu: "Open to the Right" (split horizontal), "Open Below" (split vertical), "Open in New Tab" (addTab), "Close All" (close all instances)

- [ ] **Step 2: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/layout/ActivityBar.tsx
git commit -m "feat(panels): add ActivityBar drag source, open indicators, context menu"
```

---

### Task 11: Smoke Test Phase 3b

**Files:**

- Various test updates

- [ ] **Step 1: Run full test suite**

Run: `npm run typecheck && npm test`
Expected: ALL PASS

- [ ] **Step 2: Commit any test fixes**

```bash
git add -A
git commit -m "test(panels): update tests for Phase 3b docking"
```

**CHECKPOINT:** Phase 3b complete. Users can now split, tab, drag-and-drop, and close panels. ActivityBar shows open/focused state with right-click menu.

---

## Phase 3c: Polish

### Task 12: Panel Keyboard Shortcuts

**Files:**

- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add new keyboard shortcuts to handleKeyDown**

Add after existing `Cmd+1-7` handler:

```typescript
// Cmd+\ — Split focused panel right
if (e.metaKey && e.key === '\\') {
  e.preventDefault()
  const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
  splitPanel(focusedPanelId, 'horizontal', 'agents') // opens agents by default
  return
}

// Cmd+W — Close focused panel's active tab
if (e.metaKey && e.key === 'w') {
  e.preventDefault()
  const { focusedPanelId, root } = usePanelLayoutStore.getState()
  const leaf = findLeaf(root, focusedPanelId)
  if (leaf) usePanelLayoutStore.getState().closeTab(focusedPanelId, leaf.activeTab)
  return
}

// Cmd+Shift+[ / ] — Cycle tabs
if (e.metaKey && e.shiftKey && (e.key === '[' || e.key === ']')) {
  e.preventDefault()
  const { focusedPanelId, root, setActiveTab } = usePanelLayoutStore.getState()
  const leaf = findLeaf(root, focusedPanelId)
  if (leaf && leaf.tabs.length > 1) {
    const delta = e.key === ']' ? 1 : -1
    const next = (leaf.activeTab + delta + leaf.tabs.length) % leaf.tabs.length
    setActiveTab(focusedPanelId, next)
  }
  return
}
```

- [ ] **Step 2: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(panels): add keyboard shortcuts (split, close, cycle tabs)"
```

---

### Task 13: Layout Persistence

**Files:**

- Modify: `src/renderer/src/stores/panelLayout.ts`

- [ ] **Step 1: Add save/restore logic**

In the panelLayout store:

- On store creation: read `panel.layout` from settings, validate, use as initial state or fall back to default
- After every mutation: debounce-save (500ms) the root tree to `panel.layout` setting
- `resetLayout`: also deletes the `panel.layout` setting

```typescript
// Add to store initialization:
const saved = await window.api.settings.getJson('panel.layout')
const initial = isValidLayout(saved) ? saved : DEFAULT_LAYOUT

// Add debounced save subscriber:
let saveTimeout: ReturnType<typeof setTimeout> | null = null
usePanelLayoutStore.subscribe((state) => {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    window.api.settings.setJson('panel.layout', state.root)
  }, 500)
})

// Validation:
function isValidLayout(node: unknown): node is PanelNode {
  if (!node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  if (n.type === 'leaf') {
    return Array.isArray(n.tabs) && n.tabs.length > 0
  }
  if (n.type === 'split') {
    return (
      Array.isArray(n.children) &&
      n.children.length === 2 &&
      isValidLayout(n.children[0]) &&
      isValidLayout(n.children[1])
    )
  }
  return false
}
```

Note: Since `window.api.settings.getJson` is async, the store may need to initialize with a default and then update once the saved layout loads. Handle this with a `loadSavedLayout()` method called from App.tsx on mount.

- [ ] **Step 2: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/panelLayout.ts
git commit -m "feat(panels): add layout persistence with debounced save/restore"
```

---

### Task 14: Command Palette Panel Commands

**Files:**

- Modify: `src/renderer/src/components/layout/CommandPalette.tsx`

- [ ] **Step 1: Add panel commands**

Add to the `commands` array in CommandPalette:

```typescript
{
  id: 'panel-split-right',
  label: 'Split Right',
  category: 'panel',
  hint: '⌘\\',
  action: () => {
    const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
    splitPanel(focusedPanelId, 'horizontal', 'agents')
    onClose()
  },
},
{
  id: 'panel-split-below',
  label: 'Split Below',
  category: 'panel',
  action: () => {
    const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
    splitPanel(focusedPanelId, 'vertical', 'agents')
    onClose()
  },
},
{
  id: 'panel-close',
  label: 'Close Panel',
  category: 'panel',
  hint: '⌘W',
  action: () => {
    const { focusedPanelId, root } = usePanelLayoutStore.getState()
    const leaf = findLeaf(root, focusedPanelId)
    if (leaf) usePanelLayoutStore.getState().closeTab(focusedPanelId, leaf.activeTab)
    onClose()
  },
},
{
  id: 'panel-reset',
  label: 'Reset Layout',
  category: 'panel',
  action: () => {
    usePanelLayoutStore.getState().resetLayout()
    toast.success('Layout reset')
    onClose()
  },
},
```

- [ ] **Step 2: Verify typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/layout/CommandPalette.tsx
git commit -m "feat(panels): add panel commands to command palette"
```

---

### Task 15: Update CLAUDE.md + Final Verification

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture notes**

Add to the Architecture Notes section:

- **Panel system**: `src/renderer/src/stores/panelLayout.ts` — recursive PanelNode tree (leaf/split), `src/renderer/src/components/panels/` — PanelRenderer, PanelLeaf, PanelTabBar, PanelDropOverlay. Layout persists to `panel.layout` setting.
- Update "Views" note to mention panels.

- [ ] **Step 2: Run full CI checks**

Run: `npm run typecheck && npm test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with panel architecture notes"
```

---

## Summary

| Phase  | Tasks | Key Deliverable                                                                                      |
| ------ | ----- | ---------------------------------------------------------------------------------------------------- |
| **3a** | 1-6   | Panel infrastructure — PanelNode tree, PanelRenderer, PanelLeaf, replace ViewRouter. Zero UX change. |
| **3b** | 7-11  | Docking — PanelTabBar drag, PanelDropOverlay 5-zone, moveTab, ActivityBar launcher                   |
| **3c** | 12-15 | Polish — Keyboard shortcuts, layout persistence, command palette commands                            |

**Total tasks:** 15
**New files:** 8 (store + 5 panel components + 4 test files)
**Modified files:** 5 (App.tsx, ui.ts, ActivityBar, CommandPalette, main.css, CLAUDE.md)

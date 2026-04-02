# Phase 3: Pluggable Panel Architecture — Design Spec

## Goal

Replace BDE's single-view-at-a-time layout with a VS Code-style dockable panel system. Users can split, tab, drag-and-drop, and resize panels to build their ideal workspace. Layout persists across restarts.

## Context

BDE currently has 7 views (Agents, Terminal, Sprint, PR Station, Memory, Cost, Settings) rendered one at a time via a `ViewRouter` in `App.tsx`. The `UIStore` tracks a single `activeView`. Phase 3 replaces this with a recursive panel tree that renders multiple views simultaneously, with drag-and-drop docking, tab groups, and resize handles powered by `react-resizable-panels` (already in the dependency tree).

---

## 1. Panel Tree Data Model

Layout is a recursive binary tree. Each node is either a `leaf` (one or more tabbed views) or a `split` (two children with a divider):

```typescript
type View = 'agents' | 'terminal' | 'sprint' | 'pr-station' | 'memory' | 'cost' | 'settings'

interface PanelLeafNode {
  type: 'leaf'
  panelId: string
  tabs: { viewKey: View; label: string }[]
  activeTab: number
}

interface PanelSplitNode {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: [PanelNode, PanelNode]
  sizes: [number, number]  // percentage split
}

type PanelNode = PanelLeafNode | PanelSplitNode
```

### Examples

**Default (single Agents panel):**
```json
{ "type": "leaf", "panelId": "p1", "tabs": [{ "viewKey": "agents", "label": "Agents" }], "activeTab": 0 }
```

**Agents left + Terminal right (50/50):**
```json
{
  "type": "split",
  "direction": "horizontal",
  "children": [
    { "type": "leaf", "panelId": "p1", "tabs": [{ "viewKey": "agents", "label": "Agents" }], "activeTab": 0 },
    { "type": "leaf", "panelId": "p2", "tabs": [{ "viewKey": "terminal", "label": "Terminal" }], "activeTab": 0 }
  ],
  "sizes": [50, 50]
}
```

**Three panels (Agents left, Terminal top-right, Sprint bottom-right):**
```json
{
  "type": "split",
  "direction": "horizontal",
  "children": [
    { "type": "leaf", "panelId": "p1", "tabs": [{ "viewKey": "agents", "label": "Agents" }], "activeTab": 0 },
    {
      "type": "split",
      "direction": "vertical",
      "children": [
        { "type": "leaf", "panelId": "p2", "tabs": [{ "viewKey": "terminal", "label": "Terminal" }], "activeTab": 0 },
        { "type": "leaf", "panelId": "p3", "tabs": [{ "viewKey": "sprint", "label": "Sprint" }], "activeTab": 0 }
      ],
      "sizes": [50, 50]
    }
  ],
  "sizes": [50, 50]
}
```

### Tab Groups

Multiple views can share a single leaf as tabs. The user drags a panel onto the center drop zone to tab it:

```json
{
  "type": "leaf",
  "panelId": "p1",
  "tabs": [
    { "viewKey": "agents", "label": "Agents" },
    { "viewKey": "sprint", "label": "Sprint" }
  ],
  "activeTab": 0
}
```

---

## 2. State Management

### panelLayout Zustand Store

Replaces `ui.ts`'s single `activeView` with a full layout store:

```typescript
interface PanelLayoutState {
  root: PanelNode
  focusedPanelId: string
  // Tree mutations
  splitPanel: (panelId: string, direction: 'horizontal' | 'vertical', viewKey: View) => void
  closeTab: (panelId: string, tabIndex: number) => void
  addTab: (panelId: string, viewKey: View) => void
  moveTab: (sourcePanelId: string, tabIndex: number, targetPanelId: string, zone: DropZone) => void
  setActiveTab: (panelId: string, tabIndex: number) => void
  focusPanel: (panelId: string) => void
  updateSizes: (splitNodePath: number[], sizes: [number, number]) => void
  resetLayout: () => void
  // Derived
  findPanelByView: (viewKey: View) => string | null
  getOpenViews: () => View[]
}
```

The `View` type remains the same union. `activeView` is replaced by `focusedPanelId` + the focused panel's `activeTab`.

### Backward Compatibility

Code that currently reads `useUIStore(s => s.activeView)` needs migration. Provide a compatibility helper:

```typescript
function useActiveView(): View {
  const root = usePanelLayoutStore(s => s.root)
  const focusedId = usePanelLayoutStore(s => s.focusedPanelId)
  // Walk tree to find focused leaf, return its active tab's viewKey
}
```

This lets existing code (StatusBar, TitleBar, notification hooks) work without immediate refactoring.

---

## 3. Rendering Architecture

### PanelRenderer

Recursive React component that walks the `PanelNode` tree:

- **Split node** → `<PanelGroup direction={direction}>` from `react-resizable-panels`, containing two `<Panel defaultSize={sizes[n]}>` children with a `<PanelResizeHandle>` between them. The `onLayout` callback updates `sizes` in the store.
- **Leaf node** → `<PanelLeaf>` component:
  - **Tab bar** (if multiple tabs) — Draggable tab headers with close (X) buttons
  - **View content** — The active tab's view component inside `<ErrorBoundary>` and `<Suspense>`
  - **Background tabs** — Mounted but hidden (`display: none`) to preserve state

### View Mounting Strategy

| View | Loading | Mount Behavior |
|------|---------|---------------|
| Agents | Eager | Mounted when in tree, hidden when background tab |
| Terminal | Eager | Mounted when in tree. xterm detach/reattach on tab switch. |
| Sprint | Lazy | `React.lazy()` + Suspense. Mounted when in tree. |
| PR Station | Lazy | Same |
| Memory | Lazy | Same |
| Cost | Lazy | Same |
| Settings | Lazy | Same |

**Terminal special handling:** xterm.js requires a visible DOM node. When Terminal is in a background tab, call `terminal.element = null` to detach. When tab activates, reattach to the new container div. The existing `TerminalPane` component handles this — it attaches xterm in a `useEffect` that depends on the container ref.

**Views not in the tree** are completely unmounted. Opening a panel mounts the view fresh.

### Component Hierarchy

```
<App>
  <TitleBar />
  <div className="app-shell__body">
    <ActivityBar />
    <PanelRenderer node={root} />   ← replaces ViewRouter
  </div>
  <StatusBar />
  <CommandPalette />
  <ToastContainer />
</App>
```

---

## 4. Drag-and-Drop Docking

### Drag Sources

1. **Panel tab headers** — Drag an existing tab to reposition it
2. **ActivityBar view icons** — Drag a view from the sidebar into the panel area

Both produce the same drag data: `{ viewKey: View, sourcePanelId?: string, sourceTabIndex?: number }`.

### Drop Zones

When dragging over a panel leaf, five zones appear as translucent overlays:

```
┌────────────────────┐
│       TOP          │
├────┬──────────┬────┤
│    │          │    │
│ L  │  CENTER  │  R │
│    │          │    │
├────┴──────────┴────┤
│      BOTTOM        │
└────────────────────┘
```

- **Top** — Split target vertically, place dragged view above
- **Bottom** — Split target vertically, place dragged view below
- **Left** — Split target horizontally, place dragged view left
- **Right** — Split target horizontally, place dragged view right
- **Center** — Add as new tab in target's tab group

### Zone Hit-Testing

Divide the panel's bounding rect into zones:
- Top/Bottom: 25% height strips at edges
- Left/Right: 25% width strips at edges (excluding top/bottom strips)
- Center: remaining middle area

### Visual Feedback

- Active zone highlights with `rgba(59, 130, 246, 0.2)` (info color, dimmed) fill
- Ghost preview of the dragged tab follows cursor at 50% opacity
- Invalid drop targets (dropping onto self) show no highlight

### Implementation

HTML5 Drag and Drop API. No external DnD library needed — all drag sources and targets are our own components.

- `onDragStart` on tab headers and ActivityBar icons — sets drag data
- `onDragOver` on `<PanelLeaf>` overlay — determines zone from mouse position, shows highlight
- `onDrop` — executes tree mutation (split or add-tab)
- `onDragEnd` — cleanup highlights

### Drop Handling (Tree Mutations)

**Edge drop (top/bottom/left/right):**
1. If source is an existing tab, remove it from source panel
2. Replace target leaf with a new split node containing target + new leaf
3. Direction: top/bottom → vertical, left/right → horizontal
4. New leaf placed first (top/left) or second (bottom/right)

**Center drop (tab):**
1. If source is an existing tab, remove it from source panel
2. Add as new tab in target leaf's `tabs` array

**Close handling:**
- Closing the last tab in a leaf removes that leaf from the tree
- If a split node ends up with only one child, collapse: the remaining child replaces the split node in the parent

---

## 5. ActivityBar Updates

The ActivityBar transforms from a view switcher to a panel launcher with open/closed state:

### Visual Changes

- **Open indicator** — Small dot next to icons for views that exist somewhere in the panel tree
- **Focused highlight** — The green accent bar highlights the view in the currently focused panel (not just any open panel)
- **Drag handle** — View icons are draggable (drag source for docking)

### Interaction

| Action | Behavior |
|--------|----------|
| Left-click (view open) | Focus the panel containing that view |
| Left-click (view closed) | Open as new tab in the focused panel |
| Right-click | Context menu: "Open to the Right", "Open Below", "Open in New Tab", "Close All Instances" |
| Drag icon into panels | Dock at drop zone position |

### Derived State

ActivityBar reads from the panel layout store:
- `getOpenViews()` → which icons get the open dot
- `focusedPanelId` + active tab → which icon gets the accent bar

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+1-7 | Focus panel containing that view (or open it in focused panel if not present) |
| Cmd+\ | Split focused panel right with empty panel |
| Cmd+W | Close focused panel's active tab |
| Cmd+Shift+[ / ] | Cycle tabs within focused panel |
| Cmd+Alt+Arrow | Move focus between panels (directional in tree) |
| Cmd+P → "Split Right" | Split focused panel right |
| Cmd+P → "Split Below" | Split focused panel below |
| Cmd+P → "Reset Layout" | Restore default single Agents panel |

### Focus Navigation (Cmd+Alt+Arrow)

Walk the panel tree to find the nearest sibling in the requested direction:
- Left/Right — Find sibling in horizontal split ancestors
- Up/Down — Find sibling in vertical split ancestors
- If no sibling in that direction, wrap or no-op

---

## 7. Layout Persistence

### Save

- Serialize `root` PanelNode tree to JSON
- Write to SQLite `settings` table under key `panel.layout`
- Debounced: 500ms after last mutation (split, close, resize, tab reorder)
- Uses existing `window.api.settings.setJson('panel.layout', tree)`

### Restore

On app launch:
1. Read `panel.layout` from settings
2. Validate: all `viewKey` values are valid `View` members, tree structure is well-formed
3. If valid, use as initial `root`
4. If missing/corrupt, fall back to default (single Agents leaf)

### Reset

"Reset Layout" command (Cmd+P or button):
1. Delete `panel.layout` setting
2. Set `root` to default
3. Toast: "Layout reset"

---

## 8. CSS Considerations

**No CSS modules migration.** The existing BEM naming (`.sprint-board__`, `.pr-station__`, `.cost-view__`, etc.) already namespaces view styles. Multiple views rendering simultaneously will not conflict because:
- Each view uses unique BEM prefixes
- No two views share class names
- Views are contained in `overflow: hidden` panel divs

**New CSS needed:**
- `.panel-leaf` — Container with focus ring, overflow hidden
- `.panel-tab-bar` — Tab strip with draggable tabs
- `.panel-tab` — Individual tab with label, close button, drag handle
- `.panel-drop-overlay` — Absolute-positioned drop zone highlights
- `.panel-resize-handle` — Styled resize handle between panels (4px, hover highlight)

**Panel chrome budget:** Tab bar ~28px, resize handles 4px. Views get the remaining space.

---

## 9. Migration Path

### Phase 3a: Panel Infrastructure (no breaking changes)

1. Create `panelLayout` store with PanelNode tree model
2. Create `PanelRenderer` recursive component
3. Create `PanelLeaf` with tab bar and view mounting
4. Replace `ViewRouter` in App.tsx with `PanelRenderer`
5. Provide `useActiveView()` compat helper
6. Default layout: single Agents leaf (identical to current UX)

**At this point the app looks and behaves exactly the same.** Single panel, same keyboard shortcuts, same ActivityBar. But the infrastructure is in place.

### Phase 3b: Docking + Multi-panel

7. Add drag-and-drop on tab headers
8. Add drop zone overlays with 5-zone hit testing
9. Implement tree mutations (split, close, collapse)
10. Add drag-from-ActivityBar
11. Update ActivityBar with open indicators and right-click menu

### Phase 3c: Polish

12. Add keyboard shortcuts (Cmd+\, Cmd+W, Cmd+Alt+Arrow, Cmd+Shift+[/])
13. Add layout persistence (save/restore)
14. Add command palette panel commands
15. Handle Terminal xterm detach/reattach

---

## 10. Files

### New Files

```
src/renderer/src/stores/panelLayout.ts          — PanelNode tree state + mutations
src/renderer/src/components/panels/
├── PanelRenderer.tsx                            — Recursive tree → react-resizable-panels
├── PanelLeaf.tsx                                — Tab bar + view content container
├── PanelTabBar.tsx                              — Draggable tab strip
├── PanelDropOverlay.tsx                         — 5-zone drop target overlay
├── PanelResizeHandle.tsx                        — Styled resize handle
└── __tests__/
    ├── panelLayout.test.ts                      — Tree mutation logic tests
    ├── PanelRenderer.test.tsx                   — Rendering tests
    └── PanelDropOverlay.test.tsx                — Drop zone hit-testing tests
```

### Modified Files

| File | Change |
|------|--------|
| `src/renderer/src/App.tsx` | Replace ViewRouter with PanelRenderer |
| `src/renderer/src/stores/ui.ts` | Deprecate activeView, add useActiveView compat |
| `src/renderer/src/components/layout/ActivityBar.tsx` | Open indicators, right-click menu, drag source |
| `src/renderer/src/components/layout/CommandPalette.tsx` | Add panel commands |
| `src/renderer/src/assets/main.css` | Panel CSS classes |
| `src/renderer/src/views/TerminalView.tsx` | xterm detach/reattach for background tabs |

### No Changes Needed

All 7 view files remain unchanged — they render inside `<PanelLeaf>` which handles sizing, error boundaries, and suspense. Views don't need to know they're in a panel.

---

## 11. Testing Strategy

**Unit tests:**
- Tree mutations (split, close, collapse, addTab, moveTab) — pure functions on PanelNode
- Drop zone hit-testing — geometry math, no DOM needed
- `useActiveView` compat helper — returns correct view from tree

**Component tests:**
- PanelRenderer renders correct nesting for 1, 2, 3 panel trees
- PanelLeaf shows tab bar for multi-tab leaves, hides for single tab
- ActivityBar shows open dots for views in tree

**Integration:**
- Smoke tests: app renders with default panel layout
- Existing view smoke tests continue to pass (views mount inside panels)

---

## 12. What This Does NOT Include

- **Extension API / PanelDefinition interface** — Internal views only. Extension API is a future phase.
- **Named layout presets** — Save/switch between multiple layouts. Can be added later as "Save Layout As..."
- **Panel maximize/minimize** — Double-click to maximize a panel. Nice-to-have, not in scope.
- **Floating/detached panels** — Panels always dock in the tree. No pop-out windows.

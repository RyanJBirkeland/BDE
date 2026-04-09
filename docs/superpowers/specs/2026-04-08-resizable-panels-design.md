# Resizable Panels & Drawers

**Date:** 2026-04-08  
**Status:** Approved  
**Scope:** All fixed-size UI surfaces in BDE — overlay drawers and panel splits

---

## Goal

Make every fixed-size pane, drawer, and sidebar in the app freely resizable so screen space can be allocated as the user prefers. Sizes are session-only (reset to defaults on restart — no persistence).

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Overlay drawers | Custom `useDrawerResize` hook | Drawers are `position: fixed` — outside document flow, incompatible with `react-resizable-panels` |
| Panel splits | `react-resizable-panels` | Already a dep (v4.7.2), used in IDEView + TaskWorkbench |
| Handle style | Subtle — invisible at rest, faint cyan glow on hover | Matches IDEView's existing `.ide-separator` behavior |
| Persistence | Session-only (`useState`) | No persistence layer needed |
| SpecPanel | Out of scope | Centered modal overlay (`max-width: 80vw`), not a side-anchored panel |

---

## Architecture

Two patterns, one per surface type:

```
Overlay drawers (position: fixed, right-anchored)
  └── useDrawerResize hook  →  TaskDetailDrawer, ConflictDrawer, HealthCheckDrawer

Panel splits (in-flow layout)
  └── react-resizable-panels  →  CodeReview, Agents, Settings, DiffViewer
      IDE already wired — verify separator works
```

---

## Pattern 1: `useDrawerResize` Hook

**File:** `src/renderer/src/hooks/useDrawerResize.ts`

Extracted from `TaskDetailDrawer.tsx` lines 93–133. All right-anchored drawers share this one hook.

### Signature

```ts
interface UseDrawerResizeConfig {
  defaultWidth: number
  minWidth: number
  maxWidth: number
}

interface UseDrawerResizeResult {
  width: number
  handleResizeStart: (e: React.MouseEvent) => void
}

export function useDrawerResize(config: UseDrawerResizeConfig): UseDrawerResizeResult
```

### Behavior

- `handleResizeStart` attaches `mousemove` + `mouseup` to `document` during drag
- Delta direction: `startX − currentX` (dragging left = wider, since drawers anchor to right edge)
- Clamps to `[minWidth, maxWidth]`
- Sets `document.body.style.cursor = 'col-resize'` and `userSelect = 'none'` during drag
- Cleans up listeners on `mouseup` and on component unmount (via `useEffect` cleanup)
- **Cleanup must use a `useRef<(() => void) | null>(null)` to store the cleanup closure**, not a direct `useEffect` dependency on the handler — otherwise a mid-drag unmount will leak the `mousemove` listener. See `TaskDetailDrawer.tsx` lines 82–91 for the exact pattern.

### Usage in each drawer

Each drawer renders a 4px resize handle as the **first child**:

```tsx
const { width, handleResizeStart } = useDrawerResize({
  defaultWidth: 380,
  minWidth: 280,
  maxWidth: 700
})

return (
  <div className="my-drawer" style={{ width }}>
    <div className="drawer-resize-handle" onMouseDown={handleResizeStart} />
    {/* drawer content */}
  </div>
)
```

### Per-drawer bounds

| Drawer | Default | Min | Max |
|---|---|---|---|
| `TaskDetailDrawer` | 380px | 280px | 700px |
| `ConflictDrawer` | 440px | 300px | 650px |
| `HealthCheckDrawer` | 440px | 300px | 600px |

### Handle CSS

Add to `src/renderer/src/assets/design-system.css`:

```css
/* Resize handle for right-anchored overlay drawers */
.drawer-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  /* Invisible at rest */
}

.drawer-resize-handle::after {
  content: '';
  position: absolute;
  inset: 0;
  background: transparent;
  transition: background 150ms ease, box-shadow 150ms ease;
}

.drawer-resize-handle:hover::after,
.drawer-resize-handle:active::after {
  background: var(--neon-cyan);
  box-shadow: 0 0 8px var(--neon-cyan-glow);
  opacity: 0.6;
}
```

All three drawers have `position: fixed`, which establishes a containing block for absolutely-positioned children — the `position: absolute` resize handle with `left: 0; top: 0; bottom: 0` will position correctly relative to the drawer without any additional CSS.

---

## Pattern 2: `react-resizable-panels` for Panel Splits

Import: `import { Group, Panel, Separator } from 'react-resizable-panels'`

### Shared separator CSS

Add to `src/renderer/src/assets/design-system.css`:

```css
/* Shared panel separator — used by all split views */
.panel-separator {
  background: var(--neon-purple-border);
}

.panel-separator:hover,
.panel-separator:active {
  background: var(--neon-cyan);
  box-shadow: 0 0 8px var(--neon-cyan-glow);
}
```

(Identical to `.ide-separator` — IDEView can migrate to `.panel-separator` in a follow-up, or keep its own class. Both are fine.)

---

### CodeReviewView

**File:** `src/renderer/src/views/CodeReviewView.tsx`

Replace the `<ReviewQueue /> + <div className="cr-main">` flex layout:

```tsx
// Before: plain flex in .cr-view CSS
<ReviewQueue />
<BatchActions />
<div className="cr-main">...</div>

// After: react-resizable-panels
// BatchActions is position:absolute so it stays as a sibling of Group, not inside a Panel
<Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
  <Panel defaultSize={22} minSize={12} maxSize={40}>
    <ReviewQueue />
  </Panel>
  <Separator className="panel-separator" />
  <Panel minSize={40}>
    <div className="cr-main">
      <ReviewDetail />
      <ReviewActions />
    </div>
  </Panel>
</Group>
<BatchActions />
```

**CSS changes in `code-review-neon.css`:**
- Remove `width: 260px` and `min-width: 160px` from `.cr-queue` — width is now controlled by the panel
- `.cr-queue` keeps `height: 100%`, `overflow-y: auto`, `flex-direction: column`
- `.cr-view` keeps `display: flex; flex-direction: column; height: 100%`

---

### AgentsView

**File:** `src/renderer/src/views/AgentsView.tsx`

The inner flex row `{display: 'flex', flex: 1, minHeight: 0}` wraps `.agents-sidebar` and the console area. Convert:

```tsx
// Before
<div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
  <div className="agents-sidebar">...</div>
  <div className="agents-console">...</div>
</div>

// After
<Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
  <Panel defaultSize={20} minSize={12} maxSize={40}>
    <div className="agents-sidebar">...</div>
  </Panel>
  <Separator className="panel-separator" />
  <Panel minSize={40}>
    <div className="agents-console">...</div>
  </Panel>
</Group>
```

**CSS changes in `agents-neon.css`:**
- Remove `width: 220px`, `min-width: 180px`, `max-width: 400px` from `.agents-sidebar`
- Remove `resize: horizontal` and `overflow: hidden` from `.agents-sidebar` — these conflict with the Panel separator (the native CSS resize handle would appear alongside the Panel separator)
- Keep `height: 100%`, `overflow-y: auto`, `flex-direction: column`, borders

---

### SettingsView

**File:** `src/renderer/src/views/SettingsView.tsx`

`.stg-layout` is a plain flex row. Convert:

```tsx
// Before
<div className="stg-layout">
  <SettingsSidebar ... />
  <motion.div className="stg-content">...</motion.div>
</div>

// After
<div className="stg-layout">
  <Group orientation="horizontal" style={{ flex: 1, height: '100%' }}>
    <Panel defaultSize={18} minSize={12} maxSize={30}>
      <SettingsSidebar ... />
    </Panel>
    <Separator className="panel-separator" />
    <Panel minSize={50}>
      <motion.div className="stg-content">...</motion.div>
    </Panel>
  </Group>
</div>
```

**CSS changes in `settings-v2-neon.css`:**
- Remove `width: 180px` and `min-width: 180px` from `.stg-sidebar`
- Keep `height: 100%`, padding, borders, background
- `.stg-layout` becomes `display: flex; height: 100%` (Group fills it)

---

### DiffViewer (diff file sidebar)

**File:** `src/renderer/src/components/diff/DiffViewer.tsx`

The return renders `<DiffFileList />` + `<div className="diff-content">` in a flex container (`.diff-view-container`). Convert:

```tsx
// Before
<div className="diff-view-container">
  <DiffFileList ... />
  <div className="diff-content" ref={containerRef}>...</div>
</div>

// After
<div className="diff-view-container">
  <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
    <Panel defaultSize={22} minSize={10} maxSize={40}>
      <DiffFileList ... />
    </Panel>
    <Separator className="panel-separator" />
    <Panel minSize={40}>
      <div className="diff-content" ref={containerRef}>...</div>
    </Panel>
  </Group>
</div>
```

**CSS changes in `diff.css`:**
- Remove `width: 200px` and `flex-shrink: 0` from `.diff-sidebar`
- Keep `height: 100%`, `overflow: hidden`, background, border
- `.diff-view__loading-sidebar` fixed `width: 260px` can stay (it's only a skeleton loader)

---

### IDEView

**File:** `src/renderer/src/views/IDEView.tsx`

IDEView already uses `react-resizable-panels` correctly with a `<Separator className="ide-separator ide-separator--h" />` between the file sidebar panel and editor panel. **Verify it works as-is** — no code changes expected unless manual testing reveals the separator is non-interactive.

If the separator is non-interactive, the likely cause is the conditional mount pattern (`{!sidebarCollapsed && <Panel>}`) causing react-resizable-panels to lose track of panel state. Use the library's imperative `collapse()` / `expand()` API instead:

```tsx
// If fix needed — keep Panel mounted, use imperative API
const sidebarPanelRef = useRef<PanelInstance>(null)

useEffect(() => {
  if (sidebarCollapsed) sidebarPanelRef.current?.collapse()
  else sidebarPanelRef.current?.expand()
}, [sidebarCollapsed])

<Panel ref={sidebarPanelRef} defaultSize={20} minSize={10} collapsible>
  <FileSidebar ... />
</Panel>
<Separator className="ide-separator ide-separator--h" />
<Panel defaultSize={80} minSize={30}>
  {/* editor content — no more conditional defaultSize needed */}
</Panel>
```

Note: remove the `defaultSize={sidebarCollapsed ? 100 : 80}` hack on the editor Panel once the imperative API handles collapse.

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/src/hooks/useDrawerResize.ts` | **NEW** — shared drawer resize hook |
| `src/renderer/src/assets/design-system.css` | Add `.drawer-resize-handle` + `.panel-separator` CSS |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` | Replace inline drag logic with `useDrawerResize` |
| `src/renderer/src/components/sprint/ConflictDrawer.tsx` | Add `useDrawerResize` + resize handle div |
| `src/renderer/src/components/sprint/HealthCheckDrawer.tsx` | Add `useDrawerResize` + resize handle div |
| `src/renderer/src/views/CodeReviewView.tsx` | Wrap in Group/Panel/Separator |
| `src/renderer/src/assets/code-review-neon.css` | Remove fixed `.cr-queue` width |
| `src/renderer/src/views/AgentsView.tsx` | Wrap in Group/Panel/Separator |
| `src/renderer/src/assets/agents-neon.css` | Remove fixed `.agents-sidebar` width |
| `src/renderer/src/views/SettingsView.tsx` | Wrap in Group/Panel/Separator |
| `src/renderer/src/assets/settings-v2-neon.css` | Remove fixed `.stg-sidebar` width |
| `src/renderer/src/components/diff/DiffViewer.tsx` | Wrap DiffFileList in Group/Panel/Separator |
| `src/renderer/src/assets/diff.css` | Remove fixed `.diff-sidebar` width |
| `src/renderer/src/views/IDEView.tsx` | Verify only — fix conditional mount if needed |

---

## Implementation Order

**Phase 1 — Hook + drawers (low risk, isolated)**
1. Create `useDrawerResize.ts`
2. Add `.drawer-resize-handle` + `.panel-separator` to `design-system.css`
3. Refactor `TaskDetailDrawer` to use hook
4. Add hook to `ConflictDrawer`
5. Add hook to `HealthCheckDrawer`

**Phase 2 — Panel splits (moderate risk, layout changes)**
6. `CodeReviewView` — Group/Panel/Separator, remove fixed `.cr-queue` width
7. `AgentsView` — Group/Panel/Separator, remove fixed `.agents-sidebar` width
8. `DiffViewer` — Group/Panel/Separator, remove fixed `.diff-sidebar` width

**Phase 3 — Remaining**
9. `SettingsView` — Group/Panel/Separator, remove fixed `.stg-sidebar` width
10. `IDEView` — verify; fix conditional mount pattern only if broken

---

## Testing

For each surface after change:
- Drag the resize handle and confirm width updates live
- Release mouse off-screen and confirm drag state cleans up (cursor resets)
- Reload the app and confirm size resets to default (session-only)
- Resize the window to minimum and confirm panels don't overflow or collapse below minSize
- Tab key focus: drawers should not trap focus on the resize handle (it has no `tabIndex`)

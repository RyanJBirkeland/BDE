# View Sidebar Layout Refactor

**Date:** 2026-04-10
**Status:** Draft

## Problem

Views with sidebars (CodeReview, Agents, Settings, Planner) use `react-resizable-panels` (`Group`/`Panel`/`Separator`) for their sidebar+content split. The outer panel system (PanelLeaf/PanelRenderer) also uses `react-resizable-panels` for view arrangement. This nesting creates two problems:

1. **Overflow bug:** A global CSS override `[data-panel] { min-width: revert; }` in `UnifiedHeader.css:356-358` applies to both the outer panel system and inner view-level panels. It reverts the library's inline `min-width: 0px`, preventing flex items from shrinking below content width. Inner panels overflow their containers.

2. **Unnecessary complexity:** Resizable sidebars in these views add no meaningful UX value. Users don't resize the Code Review queue or Agent list. The library adds JS overhead and creates sizing conflicts for no benefit.

## Solution

Replace `react-resizable-panels` in 4 sidebar views and 1 component with plain CSS flex layouts. Keep it only in IDE (three-zone resizable layout), TaskWorkbench (copilot split is user-resizable), and the outer panel system.

### Shared CSS pattern

Add to a shared location (e.g., `src/renderer/src/assets/design-system/view-layout.css`):

```css
.view-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.view-sidebar {
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--bde-border);
}

.view-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

### Per-view sidebar widths

Derived from current `defaultSize` percentages at typical window widths, rounded to clean values:

| View       | Current                 | New sidebar width               |
| ---------- | ----------------------- | ------------------------------- |
| CodeReview | 22% Panel               | `260px`                         |
| Agents     | 28% Panel               | `300px`                         |
| Settings   | 18% Panel               | `220px`                         |
| Planner    | 22% Panel               | `260px`                         |
| IDE        | 20% Panel (collapsible) | **Keep react-resizable-panels** |

Each view sets the sidebar width via a view-specific CSS class (e.g., `.cr-view .view-sidebar { width: 260px; }`).

## Views to change

### 1. CodeReviewView.tsx

**Before:**

```tsx
<Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
  <Panel defaultSize={22} minSize={12} maxSize={40}>
    <ReviewQueue />
  </Panel>
  <Separator className="panel-separator" />
  <Panel minSize={40}>
    <div className="cr-main">...</div>
  </Panel>
</Group>
```

**After:**

```tsx
<div className="view-layout">
  <ReviewQueue />
  <div className="cr-main view-content">...</div>
</div>
```

Remove `import { Group, Panel, Separator } from 'react-resizable-panels'`.

### 2. AgentsView.tsx

**Before:**

```tsx
<Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
  <Panel defaultSize={28} minSize={18} maxSize={44}>
    <div className="agents-sidebar">...</div>
  </Panel>
  <Separator className="panel-separator" />
  <Panel minSize={40}>...</Panel>
</Group>
```

**After:**

```tsx
<div className="view-layout">
  <div className="agents-sidebar view-sidebar">...</div>
  <div className="view-content">...</div>
</div>
```

### 3. SettingsView.tsx

**Before:**

```tsx
<Group orientation="horizontal" style={{ flex: 1, height: '100%' }}>
  <Panel defaultSize={18} minSize={12} maxSize={30}>
    <SettingsSidebar />
  </Panel>
  <Separator />
  <Panel minSize={50}>...</Panel>
</Group>
```

**After:**

```tsx
<div className="view-layout">
  <SettingsSidebar />
  <div className="stg-content view-content">...</div>
</div>
```

### 4. PlannerView.tsx

Note: The Group is inside a `<div className="planner-body">` wrapper — the wrapper stays, `view-layout` replaces the Group inside it.

**Before:**

```tsx
<div className="planner-body">
  <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
    <Panel defaultSize="22%" minSize="12%" maxSize="40%">
      <EpicList />
    </Panel>
    <Separator className="panel-separator" />
    <Panel minSize="40%">...</Panel>
  </Group>
</div>
```

**After:**

```tsx
<div className="planner-body view-layout">
  <EpicList />
  <div className="view-content">...</div>
</div>
```

### 5. DiffViewer.tsx (component)

`src/renderer/src/components/diff/DiffViewer.tsx` uses `react-resizable-panels` for a file list sidebar + diff content split inside CodeReview's ChangesTab. Same pattern, same fix.

**After:**

```tsx
<div className="view-layout">
  <DiffFileList />
  <div className="view-content">...</div>
</div>
```

## CSS cleanup

### Remove or scope `[data-panel]` override

In `src/renderer/src/components/layout/UnifiedHeader.css:356-358`:

```css
/* Current — applies globally, breaks inner panels */
[data-panel] {
  min-width: revert;
}
```

Options:

- **Remove entirely** if the outer panel system works without it (test this)
- **Scope to outer panels only** via `.panel-leaf [data-panel]` if removal causes regression

### Remove `panel-separator` from views

The `panel-separator` class and any view-level separator CSS can be removed from the affected views. The separator styling stays for the outer panel system and IDE.

### Remove AgentsView scoped `[data-panel]` override

In `src/renderer/src/views/AgentsView.css:121-125`, remove the `.agents-view [data-panel]:first-child { min-width: 160px; }` rule — it was a workaround for react-resizable-panels and is no longer needed. The sidebar width is now controlled by `.view-sidebar` with a fixed value.

### SettingsView wrapper note

The existing `<div className="stg-layout">` outer wrapper stays. The `view-layout` div replaces the `Group` inside it — `stg-layout` provides the view-level styling, `view-layout` provides the flex sidebar+content split.

## Files to change

| File                                                    | Action                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| `src/renderer/src/assets/design-system/view-layout.css` | **Create** — shared flex layout classes           |
| `src/renderer/src/views/CodeReviewView.tsx`             | Replace Group/Panel with flex divs                |
| `src/renderer/src/views/CodeReviewView.css`             | Add sidebar width                                 |
| `src/renderer/src/views/AgentsView.tsx`                 | Replace Group/Panel with flex divs                |
| `src/renderer/src/views/AgentsView.css`                 | Add sidebar width, remove `[data-panel]` override |
| `src/renderer/src/views/SettingsView.tsx`               | Replace Group/Panel with flex divs                |
| `src/renderer/src/views/SettingsView.css`               | Add sidebar width                                 |
| `src/renderer/src/views/PlannerView.tsx`                | Replace Group/Panel with flex divs                |
| `src/renderer/src/views/PlannerView.css`                | Add sidebar width                                 |
| `src/renderer/src/components/diff/DiffViewer.tsx`       | Replace Group/Panel with flex divs                |
| `src/renderer/src/components/diff/DiffViewer.css`       | Add sidebar width                                 |
| `src/renderer/src/components/layout/UnifiedHeader.css`  | Remove or scope `[data-panel]` override           |

## How to test

1. Open each affected view — sidebar and content should render side-by-side with no overflow
2. Resize the BDE window narrower — content should shrink, never overflow
3. Use panel splits (drag a view into a split) — views should still layout correctly in narrow panels
4. IDE view should still have resizable sidebar and terminal (unchanged)
5. Tear-off windows should work correctly with the new layout
6. Check responsive behavior — all views should degrade gracefully at narrow widths

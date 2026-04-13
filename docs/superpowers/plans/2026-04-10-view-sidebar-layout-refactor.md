# View Sidebar Layout Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `react-resizable-panels` in 4 views + 1 component with plain CSS flex layouts to fix sidebar overflow bugs.

**Architecture:** Create a shared `view-layout.css` with `.view-layout`, `.view-sidebar`, `.view-content` classes. Each view replaces its `Group`/`Panel`/`Separator` markup with plain divs using these classes. Per-view CSS sets the sidebar width. The `[data-panel]` global override is scoped to the outer panel system only.

**Tech Stack:** CSS (flex layout), React (JSX structure changes), TypeScript

**Spec:** `docs/superpowers/specs/2026-04-10-view-sidebar-layout-refactor-design.md`

---

### Task 1: Create shared view-layout.css

**Files:**

- Create: `src/renderer/src/assets/design-system/view-layout.css`
- Modify: `src/renderer/src/assets/main.css` (add import)

- [ ] **Step 1: Create the CSS file**

```css
/* View Layout — shared sidebar + content flex pattern */

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

- [ ] **Step 2: Add import to main.css**

In `src/renderer/src/assets/main.css`, add after the last `@import` line:

```css
@import './design-system/view-layout.css';
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (CSS-only change)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/design-system/view-layout.css src/renderer/src/assets/main.css
git commit -m "feat: add shared view-layout.css for sidebar+content flex pattern"
```

---

### Task 2: Refactor CodeReviewView

**Files:**

- Modify: `src/renderer/src/views/CodeReviewView.tsx`
- Modify: `src/renderer/src/views/CodeReviewView.css`

- [ ] **Step 1: Update CodeReviewView.tsx**

Remove the import:

```tsx
import { Group, Panel, Separator } from 'react-resizable-panels'
```

Replace lines 115-126 (the Group/Panel/Separator block):

```tsx
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
```

With:

```tsx
<div className="view-layout">
  <ReviewQueue />
  <div className="cr-main view-content">
    <ReviewDetail />
    <ReviewActions />
  </div>
</div>
```

- [ ] **Step 2: Add sidebar width to CodeReviewView.css**

`ReviewQueue` renders `<aside className="cr-queue">` which already has its own `border-right` and `overflow-y: auto`. Target it directly — no need to add `view-sidebar` class. Add after the existing `.cr-view` rule:

```css
.cr-view .cr-queue {
  width: 260px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/CodeReviewView.tsx src/renderer/src/views/CodeReviewView.css
git commit -m "refactor: CodeReviewView — replace resizable panels with flex layout"
```

---

### Task 3: Refactor AgentsView

**Files:**

- Modify: `src/renderer/src/views/AgentsView.tsx`
- Modify: `src/renderer/src/views/AgentsView.css`

- [ ] **Step 1: Update AgentsView.tsx**

Remove the import:

```tsx
import { Group, Panel, Separator } from 'react-resizable-panels'
```

Replace lines 258-362 (the Group/Panel/Separator block). The current structure is:

```tsx
<Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
  <Panel defaultSize={28} minSize={18} maxSize={44}>
    <div className="agents-sidebar">{/* ...sidebar header, banner, AgentList... */}</div>
  </Panel>
  <Separator className="panel-separator" />
  <Panel minSize={40}>
    <div style={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* ...AgentLaunchpad | AgentConsole | FleetGlance... */}
    </div>
  </Panel>
</Group>
```

With:

```tsx
<div className="view-layout">
  <div className="agents-sidebar view-sidebar">
    {/* ...sidebar header, banner, AgentList — contents unchanged... */}
  </div>
  <div className="view-content">
    {/* ...AgentLaunchpad | AgentConsole | FleetGlance — contents unchanged... */}
  </div>
</div>
```

The right panel's inline `style={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}` is now handled by `.view-content` — remove the inline style div entirely, its children go directly inside `.view-content`.

- [ ] **Step 2: Update AgentsView.css**

Remove lines 121-125 (the `[data-panel]` override):

```css
/* Prevent the fleet-list panel from collapsing to 0 at initial render
   (react-resizable-panels sets minWidth:0 inline; this overrides it). */
.agents-view [data-panel]:first-child {
  min-width: 160px;
}
```

The `.agents-sidebar` rule at line 128 already has `border-right`, `display: flex`, `flex-direction: column`, `height: 100%`, `min-width: 160px`. Add `width` and `flex-shrink`:

```css
.agents-sidebar {
  border-right: 1px solid var(--bde-accent-border);
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 300px;
  flex-shrink: 0;
  background: linear-gradient(
```

Remove `min-width: 160px` (replaced by the fixed `width: 300px`).

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/AgentsView.tsx src/renderer/src/views/AgentsView.css
git commit -m "refactor: AgentsView — replace resizable panels with flex layout"
```

---

### Task 4: Refactor SettingsView

**Files:**

- Modify: `src/renderer/src/views/SettingsView.tsx`
- Modify: `src/renderer/src/views/SettingsView.css`

- [ ] **Step 1: Update SettingsView.tsx**

Remove the import:

```tsx
import { Group, Panel, Separator } from 'react-resizable-panels'
```

Replace lines 101-121 (the Group inside `stg-layout`):

```tsx
      <Group orientation="horizontal" style={{ flex: 1, height: '100%' }}>
        <Panel defaultSize={18} minSize={12} maxSize={30}>
          <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={handleSelect} />
        </Panel>
        <Separator className="panel-separator" />
        <Panel minSize={50}>
          <motion.div className="stg-content" ...>
            ...
          </motion.div>
        </Panel>
      </Group>
```

With:

```tsx
      <div className="view-layout">
        <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={handleSelect} />
        <motion.div className="stg-content view-content" ...>
          ...
        </motion.div>
      </div>
```

The `stg-layout` outer wrapper stays — `view-layout` goes where `Group` was.

- [ ] **Step 2: Add sidebar width to SettingsView.css**

`SettingsSidebar` renders `<nav className="stg-sidebar">`. Target it directly. Add after `.stg-layout`:

```css
.stg-sidebar {
  width: 220px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/SettingsView.tsx src/renderer/src/views/SettingsView.css
git commit -m "refactor: SettingsView — replace resizable panels with flex layout"
```

---

### Task 5: Refactor PlannerView

**Files:**

- Modify: `src/renderer/src/views/PlannerView.tsx`
- Modify: `src/renderer/src/views/PlannerView.css`

- [ ] **Step 1: Update PlannerView.tsx**

Remove the import:

```tsx
import { Group, Panel, Separator } from 'react-resizable-panels'
```

Replace lines 149-181 (the `planner-body` div containing the Group):

```tsx
      <div className="planner-body">
        <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
          <Panel defaultSize="22%" minSize="12%" maxSize="40%">
            <EpicList ... />
          </Panel>
          <Separator className="panel-separator" />
          <Panel minSize="40%">
            {selectedGroup && <EpicDetail ... />}
            {!selectedGroup && !loading && <EmptyState ... />}
          </Panel>
        </Group>
      </div>
```

With:

```tsx
      <div className="planner-body view-layout">
        <EpicList ... />
        <div className="view-content">
          {selectedGroup && <EpicDetail ... />}
          {!selectedGroup && !loading && <EmptyState ... />}
        </div>
      </div>
```

Note: `planner-body` already has `flex: 1; display: flex; overflow: hidden;` — adding `view-layout` to it is redundant but harmless (both set `display: flex`). The `view-layout` class adds `height: 100%` which is fine inside a flex child.

- [ ] **Step 2: Add sidebar width to PlannerView.css**

`EpicList` renders `<div className="planner-epic-list">`. Target it directly. Add after `.planner-body`:

```css
.planner-epic-list {
  width: 260px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/PlannerView.tsx src/renderer/src/views/PlannerView.css
git commit -m "refactor: PlannerView — replace resizable panels with flex layout"
```

---

### Task 6: Refactor DiffViewer component

**Files:**

- Modify: `src/renderer/src/components/diff/DiffViewer.tsx`
- Modify: `src/renderer/src/components/diff/DiffViewer.css`

- [ ] **Step 1: Update DiffViewer.tsx**

Remove the import:

```tsx
import { Group, Panel, Separator } from 'react-resizable-panels'
```

Replace lines 436-483 (the return block). The current structure:

```tsx
<div className="diff-view-container">
  <Group orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
    <Panel defaultSize={22} minSize={10} maxSize={40}>
      <DiffFileList files={files} activeFileIndex={activeFileIndex} onSelect={scrollToFile} />
    </Panel>
    <Separator className="panel-separator" />
    <Panel minSize={40}>
      <div className="diff-content" ref={containerRef}>
        {/* ...VirtualizedDiffBanner, VirtualizedDiffContent or PlainDiffContent... */}
      </div>
    </Panel>
  </Group>
</div>
```

With:

```tsx
<div className="diff-view-container view-layout">
  <DiffFileList files={files} activeFileIndex={activeFileIndex} onSelect={scrollToFile} />
  <div className="diff-content view-content" ref={containerRef}>
    {/* ...contents unchanged... */}
  </div>
</div>
```

- [ ] **Step 2: Update DiffViewer.css**

The existing `.diff-view-container` rule (line 108) has `flex: 1; display: flex; overflow: hidden;` — adding `view-layout` is compatible. `DiffFileList` renders `<div className="diff-sidebar">`. Target it directly.

Add after `.diff-view-container`:

```css
.diff-view-container .diff-sidebar {
  width: 220px;
  flex-shrink: 0;
}
```

Note: `.diff-content` already exists and has its own styles. Adding `view-content` gives it the flex/overflow constraints. Check `.diff-content` doesn't conflict — if it sets `overflow: auto`, it should change to `overflow-y: auto` since `view-content` sets `overflow: hidden`.

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/diff/DiffViewer.tsx src/renderer/src/components/diff/DiffViewer.css
git commit -m "refactor: DiffViewer — replace resizable panels with flex layout"
```

---

### Task 7: Scope the `[data-panel]` CSS override

**Files:**

- Modify: `src/renderer/src/components/layout/UnifiedHeader.css`

- [ ] **Step 1: Scope the override**

In `src/renderer/src/components/layout/UnifiedHeader.css`, lines 353-358:

```css
/* Override react-resizable-panels inline min-width: 0px which
   lets panels collapse when the Group container width isn't
   resolved during initial render. */
[data-panel] {
  min-width: revert;
}
```

Now that no inner views use `react-resizable-panels` (except IDE and TaskWorkbench), the override only needs to apply to the outer panel system. Scope it:

```css
/* Override react-resizable-panels inline min-width: 0px which
   lets panels collapse when the Group container width isn't
   resolved during initial render. Scoped to the outer panel system only. */
.panel-leaf [data-panel] {
  min-width: revert;
}
```

- [ ] **Step 2: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Verify no overflow**

Run: `npm run dev`
Open each affected view (CodeReview, Agents, Settings, Planner) and resize the window narrower. Content should shrink, never overflow. Also check IDE still works with resizable panels.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/UnifiedHeader.css
git commit -m "fix: scope [data-panel] min-width override to outer panel system only"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full CI suite**

```bash
npm run typecheck && npm test && npm run lint
```

Expected: All pass with zero errors.

- [ ] **Step 2: Visual verification checklist**

Run `npm run dev` and verify:

- [ ] CodeReview: sidebar (260px) + content, no overflow on narrow window
- [ ] Agents: sidebar (300px) + content, no overflow on narrow window
- [ ] Settings: sidebar (220px) + content, no overflow on narrow window
- [ ] Planner: sidebar (260px) + content, no overflow on narrow window
- [ ] DiffViewer (inside CodeReview ChangesTab): file list + diff, no overflow
- [ ] IDE: resizable sidebar + editor + terminal still works (unchanged)
- [ ] Panel splits: views in narrow split panels don't overflow
- [ ] Tear-off windows: layout correct in detached windows

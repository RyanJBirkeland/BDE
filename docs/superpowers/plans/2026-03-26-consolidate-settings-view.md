# Consolidate Memory + Cost + Settings into One Settings View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Memory, Cost, and Settings views into a single tabbed Settings view, removing `memory` and `cost` as first-class views from the app shell.

**Architecture:** MemoryView and CostView become `MemorySection` and `CostSection` — settings tab components rendered inside SettingsView's existing tab system. The `View` type union shrinks from 10 to 8 members. Keyboard shortcuts compact to ⌘1–⌘7 with Settings at ⌘7.

**Tech Stack:** React, TypeScript, Zustand, lucide-react, framer-motion, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/renderer/src/components/settings/MemorySection.tsx` | Memory tab content (adapted from MemoryView) |
| Create | `src/renderer/src/components/settings/CostSection.tsx` | Cost tab content (adapted from CostView) |
| Modify | `src/renderer/src/views/SettingsView.tsx` | Add Memory + Cost tabs to TABS array and SECTION_MAP |
| Modify | `src/renderer/src/stores/panelLayout.ts:7-56` | Remove `'memory'` and `'cost'` from View union + VIEW_LABELS |
| Modify | `src/renderer/src/stores/sidebar.ts:4-15` | Remove `'memory'` and `'cost'` from ALL_VIEWS |
| Modify | `src/renderer/src/stores/ui.ts` | No changes needed (View type re-exported from panelLayout) |
| Modify | `src/renderer/src/App.tsx:28-51` | Update VIEW_SHORTCUT_MAP (⌘7→settings, remove ⌘8/⌘9) + VIEW_TITLES |
| Modify | `src/renderer/src/components/panels/PanelLeaf.tsx:12-64` | Remove MemoryView/CostView lazy imports, VIEW_LOADERS entries, resolveView cases |
| Modify | `src/renderer/src/components/layout/NeonSidebar.tsx:23-60` | Remove memory/cost from VIEW_ICONS, VIEW_LABELS, VIEW_SHORTCUTS |
| Modify | `src/renderer/src/components/layout/OverflowMenu.tsx:21-45` | Remove memory/cost from VIEW_ICONS, VIEW_LABELS |
| Modify | `src/renderer/src/components/layout/CommandPalette.tsx:85-86` | Remove "Go to Memory" / "Go to Cost" commands |
| Delete | `src/renderer/src/views/MemoryView.tsx` | Replaced by MemorySection |
| Delete | `src/renderer/src/views/CostView.tsx` | Replaced by CostSection |
| Modify | `src/renderer/src/components/settings/__tests__/SettingsView.test.tsx` | Add assertions for Memory + Cost tabs |
| Modify | `src/renderer/src/views/__tests__/MemoryView.test.tsx` | Update imports to test MemorySection |
| Modify | `src/renderer/src/views/__tests__/MemoryView-unsaved.test.tsx` | Update imports to test MemorySection |
| Modify | `src/renderer/src/stores/__tests__/panelLayout.test.ts` | Remove references to `'memory'`/`'cost'` views |
| Modify | `src/renderer/src/stores/__tests__/sidebar.test.ts` | Update ALL_VIEWS expectations |
| Modify | `src/renderer/src/stores/__tests__/ui.test.ts` | Remove memory/cost view references |
| Modify | `src/renderer/src/components/layout/__tests__/OverflowMenu.test.tsx` | Update view list expectations |
| Modify | `src/renderer/src/views/__tests__/CostView.test.tsx` | Update imports to test CostSection |
| Modify | `src/renderer/src/views/__tests__/smoke.test.tsx` | Remove MemoryView/CostView smoke tests, add SettingsView smoke |
| Modify | `src/renderer/src/components/panels/__tests__/PanelLeaf.test.tsx` | Remove MemoryView/CostView mocks |
| Modify | `src/renderer/src/components/panels/__tests__/PanelRenderer.test.tsx` | Remove MemoryView/CostView mocks |

---

### Task 1: Remove `memory` and `cost` from the View type system and migrate saved layouts

**Files:**
- Modify: `src/renderer/src/stores/panelLayout.ts:7-17, 45-56`
- Modify: `src/renderer/src/stores/sidebar.ts:4-15`

- [ ] **Step 1: Update the View type union**

In `src/renderer/src/stores/panelLayout.ts`, remove `'memory'` and `'cost'`:

```typescript
export type View =
  | 'dashboard'
  | 'agents'
  | 'ide'
  | 'sprint'
  | 'pr-station'
  | 'git'
  | 'settings'
  | 'task-workbench'
```

- [ ] **Step 2: Update VIEW_LABELS**

In the same file, remove the `memory` and `cost` entries:

```typescript
export const VIEW_LABELS: Record<View, string> = {
  dashboard: 'Dashboard',
  agents: 'Agents',
  ide: 'IDE',
  sprint: 'Task Pipeline',
  'pr-station': 'PR Station',
  settings: 'Settings',
  'task-workbench': 'Task Workbench',
  git: 'Source Control'
}
```

- [ ] **Step 3: Update ALL_VIEWS in sidebar store**

In `src/renderer/src/stores/sidebar.ts`, remove `'memory'` and `'cost'`:

```typescript
const ALL_VIEWS: View[] = [
  'dashboard',
  'agents',
  'ide',
  'sprint',
  'pr-station',
  'git',
  'settings',
  'task-workbench'
]
```

- [ ] **Step 4: Add saved layout migration**

In `src/renderer/src/stores/panelLayout.ts`, update `loadSavedLayout` to migrate stale `memory`/`cost` tabs to `settings`. Add a helper function before the store:

```typescript
/** Migrate stale view keys from before settings consolidation. */
function migrateLayout(node: PanelNode): PanelNode {
  if (node.type === 'leaf') {
    const tabs = node.tabs.map((t) =>
      t.viewKey === ('memory' as View) || t.viewKey === ('cost' as View)
        ? { viewKey: 'settings' as View, label: VIEW_LABELS['settings'] }
        : t
    )
    // Deduplicate — if migration created duplicate settings tabs, keep first
    const seen = new Set<View>()
    const deduped = tabs.filter((t) => {
      if (seen.has(t.viewKey)) return false
      seen.add(t.viewKey)
      return true
    })
    return { ...node, tabs: deduped, activeTab: Math.min(node.activeTab, deduped.length - 1) }
  }
  return { ...node, children: [migrateLayout(node.children[0]), migrateLayout(node.children[1])] }
}
```

Then in `loadSavedLayout`, call it after validation:

```typescript
if (saved && isValidLayout(saved)) {
  const root = migrateLayout(saved as PanelNode)
  // ...
}
```

- [ ] **Step 5: Run typecheck to find all remaining references**

Run: `cd ~/worktrees/bde/feat/consolidate-settings && npx tsc --noEmit 2>&1 | head -60`

This will surface every file still referencing `'memory'` or `'cost'` as a View — use these errors to guide the remaining tasks.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/panelLayout.ts src/renderer/src/stores/sidebar.ts
git commit -m "feat: remove memory and cost from View type union"
```

---

### Task 2: Create MemorySection and CostSection settings components

**Files:**
- Create: `src/renderer/src/components/settings/MemorySection.tsx`
- Create: `src/renderer/src/components/settings/CostSection.tsx`
- Delete: `src/renderer/src/views/MemoryView.tsx`
- Delete: `src/renderer/src/views/CostView.tsx`

- [ ] **Step 1: Create MemorySection**

Create `src/renderer/src/components/settings/MemorySection.tsx`. This is the full content of `src/renderer/src/views/MemoryView.tsx` with these changes:

1. Rename the default export from `MemoryView` to `MemorySection`
2. Export it as a named export (not default): `export function MemorySection()`
3. Remove the outer `<motion.div>` wrapper and header (`memory-view__header`) — the Settings tab container already provides animation and header
4. Change the root element to `<div className="memory-view__content">` (the split sidebar+editor layout)
5. Remove the `activeView !== 'memory'` guard on keyboard navigation (line 236) — replace with `activeView !== 'settings'` since the section now lives inside Settings
6. Keep all imports, state, callbacks, CSS class names unchanged

The key structural change — before:
```tsx
export default function MemoryView() {
  return (
    <motion.div className="memory-view memory-view--column" ...>
      <div className="memory-view__header">...</div>
      <div className="memory-view__content">
        {/* sidebar + editor */}
      </div>
      <ConfirmModal {...confirmProps} />
    </motion.div>
  )
}
```

After:
```tsx
export function MemorySection() {
  // ... all the same hooks/state/callbacks ...
  return (
    <div className="memory-view memory-view--column" style={{ height: '100%' }}>
      <div className="memory-view__content">
        {/* sidebar + editor — unchanged */}
      </div>
      <ConfirmModal {...confirmProps} />
    </div>
  )
}
```

- [ ] **Step 2: Create CostSection**

Create `src/renderer/src/components/settings/CostSection.tsx`. Adapted from `src/renderer/src/views/CostView.tsx`:

1. Rename default export to named `export function CostSection()`
2. Remove the outer `<motion.div>` wrapper — keep the glass class for styling
3. Remove the header with title ("Cost Tracker") — keep the action buttons (Refresh + Export CSV) but move them into a toolbar div
4. Keep all internal components (`ClaudeCodePanel`, `TaskTable`, `exportCsv`), formatting helpers, polling, and state unchanged

Before:
```tsx
export default function CostView() {
  return (
    <motion.div className="cost-view cost-view--glass" ...>
      <div className="cost-view__header">
        <span className="cost-view__title text-gradient-aurora">Cost Tracker</span>
        <div className="cost-view__header-actions">...</div>
      </div>
      <div className="cost-view__scroll">...</div>
    </motion.div>
  )
}
```

After:
```tsx
export function CostSection() {
  return (
    <div className="cost-view cost-view--glass" style={{ height: '100%' }}>
      <div className="cost-view__header-actions" style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {/* Refresh + Export buttons */}
      </div>
      <div className="cost-view__scroll">...</div>
    </div>
  )
}
```

- [ ] **Step 3: Delete old view files**

```bash
rm src/renderer/src/views/MemoryView.tsx
rm src/renderer/src/views/CostView.tsx
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: create MemorySection and CostSection settings components"
```

---

### Task 3: Wire Memory + Cost tabs into SettingsView

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx`

- [ ] **Step 1: Add imports for new sections**

Add to the imports in `SettingsView.tsx`:

```typescript
import { Brain, DollarSign } from 'lucide-react'
import { MemorySection } from '../components/settings/MemorySection'
import { CostSection } from '../components/settings/CostSection'
```

- [ ] **Step 2: Update TABS array**

Insert Memory and Cost before Appearance (after Agent Manager):

```typescript
const TABS = [
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'agentManager', label: 'Agent Manager', icon: Cpu },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'cost', label: 'Cost', icon: DollarSign },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'about', label: 'About', icon: Info }
] as const
```

- [ ] **Step 3: Update SECTION_MAP**

Add Memory and Cost entries:

```typescript
const SECTION_MAP: Record<TabId, () => React.JSX.Element> = {
  connections: ConnectionsSection,
  repositories: RepositoriesSection,
  templates: TaskTemplatesSection,
  agent: AgentRuntimeSection,
  agentManager: AgentManagerSection,
  memory: MemorySection,
  cost: CostSection,
  appearance: AppearanceSection,
  about: AboutSection
}
```

- [ ] **Step 4: Verify the tab renders**

Run: `cd ~/worktrees/bde/feat/consolidate-settings && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/SettingsView.tsx
git commit -m "feat: add Memory and Cost tabs to SettingsView"
```

---

### Task 4: Update keyboard shortcuts and app shell

**Files:**
- Modify: `src/renderer/src/App.tsx:28-51`

- [ ] **Step 1: Update VIEW_SHORTCUT_MAP**

```typescript
const VIEW_SHORTCUT_MAP: Partial<Record<string, View>> = {
  '1': 'dashboard',
  '2': 'agents',
  '3': 'ide',
  '4': 'sprint',
  '5': 'pr-station',
  '6': 'git',
  '7': 'settings'
}
```

- [ ] **Step 2: Update VIEW_TITLES**

Remove `memory` and `cost` entries:

```typescript
const VIEW_TITLES: Record<View, string> = {
  dashboard: 'Dashboard',
  agents: 'Agents',
  ide: 'IDE',
  sprint: 'Task Pipeline',
  'pr-station': 'PR Station',
  git: 'Source Control',
  settings: 'Settings',
  'task-workbench': 'Task Workbench'
}
```

- [ ] **Step 3: Update shortcuts help text**

Change the description from `'⌘1–8'` to `'⌘1–7'`:

```typescript
{ keys: '\u23181\u20137', description: 'Switch views' },
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: compact keyboard shortcuts to ⌘1-7"
```

---

### Task 5: Update PanelLeaf view routing

**Files:**
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx:12-64`

- [ ] **Step 1: Remove lazy imports for MemoryView and CostView**

Delete these lines:
```typescript
const MemoryView = React.lazy(() => import('../../views/MemoryView'))
const CostView = React.lazy(() => import('../../views/CostView'))
```

- [ ] **Step 2: Remove VIEW_LOADERS entries**

Remove:
```typescript
  memory: () => import('../../views/MemoryView'),
  cost: () => import('../../views/CostView'),
```

- [ ] **Step 3: Remove resolveView cases**

Remove these cases from the switch:
```typescript
    case 'memory':
      return <MemoryView />
    case 'cost':
      return <CostView />
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/panels/PanelLeaf.tsx
git commit -m "feat: remove memory/cost from panel view routing"
```

---

### Task 6: Update sidebar, overflow menu, and command palette

**Files:**
- Modify: `src/renderer/src/components/layout/NeonSidebar.tsx:23-60`
- Modify: `src/renderer/src/components/layout/OverflowMenu.tsx:21-45`
- Modify: `src/renderer/src/components/layout/CommandPalette.tsx`

- [ ] **Step 1: Update NeonSidebar VIEW_ICONS**

Remove `memory` and `cost` entries:

```typescript
const VIEW_ICONS: Record<View, LucideIcon> = {
  dashboard: LayoutDashboard,
  agents: Terminal,
  ide: SquareTerminal,
  sprint: Workflow,
  'pr-station': GitPullRequest,
  git: GitCommitHorizontal,
  settings: Settings,
  'task-workbench': GitBranch
}
```

Also remove unused imports: `Brain`, `DollarSign`.

- [ ] **Step 2: Update NeonSidebar VIEW_LABELS**

Remove `memory` and `cost` entries:

```typescript
const VIEW_LABELS: Record<View, string> = {
  dashboard: 'Dashboard',
  agents: 'Agents',
  ide: 'IDE',
  sprint: 'Task Pipeline',
  'pr-station': 'PR Station',
  git: 'Source Control',
  settings: 'Settings',
  'task-workbench': 'Task Workbench'
}
```

- [ ] **Step 3: Update NeonSidebar VIEW_SHORTCUTS**

Remove `memory` and `cost`, update settings to ⌘7:

```typescript
const VIEW_SHORTCUTS: Record<View, string> = {
  dashboard: '⌘1',
  agents: '⌘2',
  ide: '⌘3',
  sprint: '⌘4',
  'pr-station': '⌘5',
  git: '⌘6',
  settings: '⌘7',
  'task-workbench': '⌘0'
}
```

- [ ] **Step 4: Update OverflowMenu**

In `src/renderer/src/components/layout/OverflowMenu.tsx`, remove `memory` and `cost` from `VIEW_ICONS` and `VIEW_LABELS` (same pattern as NeonSidebar). Remove unused `Brain`, `DollarSign` imports.

```typescript
const VIEW_ICONS: Record<View, LucideIcon> = {
  dashboard: LayoutDashboard,
  agents: Terminal,
  ide: SquareTerminal,
  sprint: Workflow,
  'pr-station': GitPullRequest,
  git: GitCommitHorizontal,
  settings: Settings,
  'task-workbench': GitBranch
}

const VIEW_LABELS: Record<View, string> = {
  dashboard: 'Dashboard',
  agents: 'Agents',
  ide: 'IDE',
  sprint: 'Task Pipeline',
  'pr-station': 'PR Station',
  git: 'Source Control',
  settings: 'Settings',
  'task-workbench': 'Task Workbench'
}
```

- [ ] **Step 5: Update CommandPalette**

In `src/renderer/src/components/layout/CommandPalette.tsx`, remove the "Go to Memory" and "Go to Cost" commands (lines ~85-86). Update hint for "Go to Settings" to `⌘7`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/layout/NeonSidebar.tsx src/renderer/src/components/layout/OverflowMenu.tsx src/renderer/src/components/layout/CommandPalette.tsx
git commit -m "feat: update sidebar, overflow menu, and command palette for consolidated settings"
```

---

### Task 7: Update all tests

**Files:**
- Modify: `src/renderer/src/components/settings/__tests__/SettingsView.test.tsx`
- Modify: `src/renderer/src/views/__tests__/MemoryView.test.tsx`
- Modify: `src/renderer/src/views/__tests__/MemoryView-unsaved.test.tsx`
- Modify: `src/renderer/src/views/__tests__/CostView.test.tsx`
- Modify: `src/renderer/src/views/__tests__/smoke.test.tsx`
- Modify: `src/renderer/src/components/panels/__tests__/PanelLeaf.test.tsx`
- Modify: `src/renderer/src/components/panels/__tests__/PanelRenderer.test.tsx`
- Modify: `src/renderer/src/stores/__tests__/panelLayout.test.ts`
- Modify: `src/renderer/src/stores/__tests__/sidebar.test.ts`
- Modify: `src/renderer/src/stores/__tests__/ui.test.ts`
- Modify: `src/renderer/src/components/layout/__tests__/OverflowMenu.test.tsx`

- [ ] **Step 1: Update SettingsView test**

In `SettingsView.test.tsx`, add assertions for the new tabs:

```typescript
it('renders all tab labels', () => {
  render(<SettingsView />)
  expect(screen.getAllByText('Connections').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('Repositories').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('Templates').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('Agent').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('Agent Manager').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('Memory').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('Cost').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('Appearance').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('About').length).toBeGreaterThanOrEqual(1)
})
```

Add a test for switching to the Memory tab:

```typescript
it('switches to Memory section on tab click', async () => {
  const user = userEvent.setup()
  render(<SettingsView />)
  await user.click(screen.getByText('Memory'))
  expect(screen.getByText('Files')).toBeInTheDocument()
})
```

Add mocks for `memory:listFiles`, `memory:readFile`, `memory:writeFile`, `memory:search` on `window.api` if not already present — MemorySection calls these on mount.

- [ ] **Step 2: Update MemoryView tests**

In both `MemoryView.test.tsx` and `MemoryView-unsaved.test.tsx`, update the import path:

```typescript
// Before:
import MemoryView from '../MemoryView'
// After:
import { MemorySection } from '../../components/settings/MemorySection'
```

Replace all `<MemoryView />` renders with `<MemorySection />`. The tests should otherwise pass as-is since the internal structure is unchanged.

Also update the `activeView` mock to return `'settings'` instead of `'memory'` (since the keyboard nav guard now checks for `'settings'`).

- [ ] **Step 3: Update panelLayout tests**

In `src/renderer/src/stores/__tests__/panelLayout.test.ts`, find any test using `'memory'` or `'cost'` as a View and replace with a valid view (e.g., `'settings'` or `'git'`).

- [ ] **Step 4: Update sidebar tests**

In `src/renderer/src/stores/__tests__/sidebar.test.ts`, update any hardcoded ALL_VIEWS arrays or length assertions to reflect 8 views instead of 10.

- [ ] **Step 5: Update ui store tests**

In `src/renderer/src/stores/__tests__/ui.test.ts`, replace any `'memory'` or `'cost'` view references with valid views.

- [ ] **Step 6: Update CostView tests**

In `src/renderer/src/views/__tests__/CostView.test.tsx`, update the import path:

```typescript
// Before:
import CostView from '../CostView'
// After:
import { CostSection } from '../../components/settings/CostSection'
```

Replace all `<CostView />` renders with `<CostSection />`.

- [ ] **Step 7: Update smoke tests**

In `src/renderer/src/views/__tests__/smoke.test.tsx`, remove the `MemoryView` and `CostView` imports and their individual smoke test cases. They are now tested as part of SettingsView. Optionally add a smoke test for SettingsView if not already present.

- [ ] **Step 8: Update PanelLeaf and PanelRenderer test mocks**

In `src/renderer/src/components/panels/__tests__/PanelLeaf.test.tsx` and `PanelRenderer.test.tsx`, remove the `vi.mock` calls for `../../../views/MemoryView` and `../../../views/CostView` — these modules no longer exist.

- [ ] **Step 9: Update OverflowMenu tests**

In `src/renderer/src/components/layout/__tests__/OverflowMenu.test.tsx`, update view list expectations to exclude `'memory'` and `'cost'`.

- [ ] **Step 10: Run full test suite**

```bash
cd ~/worktrees/bde/feat/consolidate-settings && npm install && npm test 2>&1 | tail -30
```

All tests must pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "test: update tests for consolidated settings view"
```

---

### Task 8: Run typecheck and final verification

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
cd ~/worktrees/bde/feat/consolidate-settings && npm run typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 2: Run full test suite with coverage**

```bash
npm run test:coverage 2>&1 | tail -30
```

Expected: all pass, coverage thresholds met.

- [ ] **Step 3: Run build**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 4: Verify no stale references**

```bash
grep -rn "'memory'" src/renderer/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__ | grep -v MemorySection | grep -v memory.css | grep -v memoryService
grep -rn "'cost'" src/renderer/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__ | grep -v CostSection | grep -v cost.css | grep -v costData | grep -v cost_usd | grep -v costTier
```

Expected: no stale view references.

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A && git commit -m "chore: final cleanup for settings consolidation"
```

---

## CSS Notes

- `memory.css` and `cost.css` remain untouched — class names are stable
- The Memory tab needs adequate height since it has a sidebar+editor split layout. The `style={{ height: '100%' }}` on the root div handles this. If the settings scroll container clips it, the `.settings-view__scroll` may need `overflow: visible` or `display: flex; flex: 1` for the Memory tab specifically. Test visually.
- Cost tab works fine in a scroll container — no special height handling needed.

## Migration Notes

- Saved panel layouts with `memory`/`cost` tabs are auto-migrated to `settings` in `loadSavedLayout()` (Task 1, Step 4).
- Saved sidebar pinned views with `memory`/`cost` are silently filtered out by `loadSaved()` in sidebar.ts (existing behavior — it filters against `ALL_VIEWS`). This is benign; the entries just disappear from the sidebar.

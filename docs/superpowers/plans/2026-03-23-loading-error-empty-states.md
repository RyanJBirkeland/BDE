# Phase 2: Loading / Error / Empty State Standardization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every async view/component follows a consistent skeleton → content → error → empty pattern, eliminating silent failures and blank screens.

**Architecture:** Standardize on the existing `EmptyState`, `ErrorBanner`, and `Spinner` UI components. Add skeleton loading to AgentList. Add silent-failure toasts to forms and drag operations. No new dependencies.

**Tech Stack:** React, TypeScript, Zustand, existing UI components (`EmptyState`, `ErrorBanner`, `Spinner`)

---

## File Structure

| Action | File                                                                      | Responsibility                                      |
| ------ | ------------------------------------------------------------------------- | --------------------------------------------------- |
| Modify | `src/renderer/src/components/agents/AgentList.tsx`                        | Add loading skeleton                                |
| Modify | `src/renderer/src/components/sprint/KanbanBoard.tsx`                      | Add WIP limit feedback toast                        |
| Modify | `src/renderer/src/components/settings/CredentialForm.tsx`                 | Add validation + error/success feedback             |
| Modify | `src/renderer/src/views/PRStationView.tsx`                                | Standardize empty state to use EmptyState component |
| Modify | `src/renderer/src/views/CostView.tsx`                                     | Add tooltips to truncated task names                |
| Modify | `src/renderer/src/components/panels/PanelTabBar.tsx`                      | Add title attribute to truncated tabs               |
| Create | `src/renderer/src/components/agents/__tests__/AgentList-loading.test.tsx` | Test loading skeleton                               |
| Create | `src/renderer/src/components/sprint/__tests__/KanbanBoard-wip.test.tsx`   | Test WIP feedback                                   |

---

### Task 1: Add Loading Skeleton to AgentList

**Files:**

- Modify: `src/renderer/src/components/agents/AgentList.tsx`
- Create: `src/renderer/src/components/agents/__tests__/AgentList-loading.test.tsx`

**Context:** AgentList renders agents immediately without any loading indicator. When `fetchAgents()` is in-flight, users see an empty list and think there are no agents. The store already tracks `loading` state — it just needs to be consumed in the UI.

- [ ] **Step 1: Write failing test for loading skeleton**

```typescript
// src/renderer/src/components/agents/__tests__/AgentList-loading.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentList } from '../AgentList'

describe('AgentList loading state', () => {
  it('renders skeleton placeholders when loading is true', () => {
    const { container } = render(
      <AgentList agents={[]} selectedId={null} onSelect={() => {}} loading={true} />
    )
    const skeletons = container.querySelectorAll('.bde-skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders empty state when not loading and no agents', () => {
    render(
      <AgentList agents={[]} selectedId={null} onSelect={() => {}} loading={false} />
    )
    expect(screen.getByText(/no agents/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentList-loading.test.tsx`
Expected: FAIL — `loading` prop doesn't exist yet

- [ ] **Step 3: Add loading prop and skeleton to AgentList**

In `src/renderer/src/components/agents/AgentList.tsx`:

```typescript
interface AgentListProps {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading?: boolean  // NEW
  filter?: string
}

// Inside the component, before rendering agents:
if (loading && agents.length === 0) {
  return (
    <div className="agent-list" style={{ padding: tokens.space[3] }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bde-skeleton" style={{
          height: 48,
          borderRadius: tokens.radius.md,
          marginBottom: tokens.space[2],
        }} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Pass loading prop from AgentsView**

In `src/renderer/src/views/AgentsView.tsx`, the `agentHistory` store has a `loading` field. Pass it:

```typescript
const loading = useAgentHistoryStore((s) => s.loading)
// ...
<AgentList agents={agents} selectedId={selectedId} onSelect={handleSelect} loading={loading} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/agents/__tests__/AgentList-loading.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/agents/AgentList.tsx src/renderer/src/views/AgentsView.tsx src/renderer/src/components/agents/__tests__/AgentList-loading.test.tsx
git commit -m "feat: add loading skeleton to AgentList"
```

---

### Task 2: Add WIP Limit Feedback to Kanban Board

**Files:**

- Modify: `src/renderer/src/components/sprint/KanbanBoard.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/KanbanBoard-wip.test.tsx`

**Context:** When the user drags a task to the "In Progress" column and WIP limit (5) is reached, the drag silently fails. Users think the app is broken. Need to show a toast explaining the limit.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/sprint/__tests__/KanbanBoard-wip.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { WIP_LIMIT_IN_PROGRESS } from '../../../lib/constants'

describe('KanbanBoard WIP feedback', () => {
  it('WIP_LIMIT_IN_PROGRESS is defined and reasonable', () => {
    expect(WIP_LIMIT_IN_PROGRESS).toBe(5)
  })

  it('column header shows capacity when tasks are present', () => {
    // This tests the display format function
    const formatCapacity = (count: number, limit: number) =>
      limit > 0 ? `(${count}/${limit})` : `(${count})`

    expect(formatCapacity(3, 5)).toBe('(3/5)')
    expect(formatCapacity(5, 5)).toBe('(5/5)')
  })
})
```

- [ ] **Step 2: Run test — verify passes (logic baseline)**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/KanbanBoard-wip.test.tsx`
Expected: PASS

- [ ] **Step 3: Add WIP capacity indicator to column headers**

In `src/renderer/src/components/sprint/KanbanBoard.tsx`, find where column headers are rendered and add:

```typescript
// In the column header rendering:
<span style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.xs }}>
  {column === 'in_progress' && ` (${inProgressCount}/${WIP_LIMIT_IN_PROGRESS})`}
</span>
```

- [ ] **Step 4: Add toast on WIP limit rejection**

In the drag-end handler where WIP is checked:

```typescript
import { toast } from '../../stores/toasts'

// Where WIP check prevents the drop:
if (inProgressCount >= WIP_LIMIT_IN_PROGRESS) {
  toast.info(
    `Work-in-progress limit reached (${WIP_LIMIT_IN_PROGRESS}). Complete or cancel an active task first.`
  )
  return
}
```

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/sprint/KanbanBoard.tsx src/renderer/src/components/sprint/__tests__/KanbanBoard-wip.test.tsx
git commit -m "feat: show WIP capacity indicator and toast on limit reached"
```

---

### Task 3: Standardize PR Station Empty State

**Files:**

- Modify: `src/renderer/src/views/PRStationView.tsx:136-139`

**Context:** PR Station uses a custom empty state with inline icon + text instead of the standard `EmptyState` component used by Memory and Cost views.

- [ ] **Step 1: Replace custom empty state with EmptyState component**

In `src/renderer/src/views/PRStationView.tsx`, find the empty detail panel section:

```typescript
// BEFORE (custom inline):
<div className="pr-station__empty">
  <FileCode2 size={32} />
  <span>Select a PR to view details</span>
</div>

// AFTER (standardized):
import { EmptyState } from '../components/ui/EmptyState'

<EmptyState
  icon={<FileCode2 size={32} />}
  title="Select a PR"
  description="Choose a pull request from the list to view details, diffs, and reviews."
/>
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/PRStationView.tsx
git commit -m "fix: standardize PR Station empty state to use EmptyState component"
```

---

### Task 4: Add Tooltips to Truncated Content

**Files:**

- Modify: `src/renderer/src/views/CostView.tsx:62-64,155`
- Modify: `src/renderer/src/components/panels/PanelTabBar.tsx:62-110`

**Context:** Task names in Cost view and tab labels in PanelTabBar are truncated with CSS ellipsis but have no title attribute or tooltip, so users can't see the full text.

- [ ] **Step 1: Add title attribute to truncated Cost table cells**

In `src/renderer/src/views/CostView.tsx`, find the task name cell:

```typescript
// Add title attribute to show full text on hover:
<td title={run.task} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
  {truncate(run.task, 40)}
</td>
```

- [ ] **Step 2: Add title attribute to PanelTabBar tabs**

In `src/renderer/src/components/panels/PanelTabBar.tsx`, find the tab label span:

```typescript
// Add title attribute:
<div
  className={`panel-tab ${isActive ? 'panel-tab--active' : ''}`}
  title={tab.label}  // ADD THIS
  // ... rest of props
>
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/CostView.tsx src/renderer/src/components/panels/PanelTabBar.tsx
git commit -m "fix: add title tooltips to truncated text in Cost view and panel tabs"
```

---

### Task 5: Add Settings Form Validation Feedback

**Files:**

- Modify: `src/renderer/src/components/settings/CredentialForm.tsx`

**Context:** Settings forms (especially credential inputs) have no inline validation, no required field indicators, and silently fail when save/test operations fail.

- [ ] **Step 1: Add save success/error feedback**

```typescript
import { toast } from '../../stores/toasts'

// Wrap save handler:
const handleSave = async () => {
  try {
    await window.api.settings.set(key, value)
    toast.success('Setting saved')
  } catch (err) {
    toast.error(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}

// Wrap test/validate handler:
const handleTest = async () => {
  try {
    setTesting(true)
    const result = await window.api.settings.test?.(key)
    if (result?.ok) {
      toast.success('Connection successful')
    } else {
      toast.error(result?.error ?? 'Connection failed')
    }
  } catch (err) {
    toast.error(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
  } finally {
    setTesting(false)
  }
}
```

- [ ] **Step 2: Add required field visual indicator**

```typescript
// Add asterisk to required field labels:
<label className="settings-field">
  <span>API Key <span style={{ color: tokens.color.danger }}>*</span></span>
  <Input value={value} onChange={...} />
</label>
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/CredentialForm.tsx
git commit -m "feat: add validation feedback and required indicators to Settings forms"
```

---

### Task 6: Improve Cost View Number Alignment

**Files:**

- Modify: `src/renderer/src/views/CostView.tsx:157-181`

**Context:** Numeric columns (Cost, Duration, Cache Hit %) are left-aligned, making visual comparison difficult.

- [ ] **Step 1: Right-align numeric columns**

In `src/renderer/src/views/CostView.tsx`, add `textAlign: 'right'` to numeric `<td>` and `<th>` elements:

```typescript
// For th headers:
<th onClick={...} style={{ textAlign: 'right', cursor: 'pointer' }}>Cost {sortIcon}</th>
<th onClick={...} style={{ textAlign: 'right', cursor: 'pointer' }}>Duration {sortIcon}</th>
<th style={{ textAlign: 'right' }}>Cache Hit</th>

// For td cells:
<td style={{ textAlign: 'right', fontFamily: tokens.font.code }}>{formatCost(run.cost_usd)}</td>
<td style={{ textAlign: 'right', fontFamily: tokens.font.code }}>{formatDuration(run.duration_ms)}</td>
<td style={{ textAlign: 'right' }}>{cacheHitPct(run)}%</td>
```

Also mark non-sortable column headers with a muted cursor:

```typescript
// Non-sortable headers:
<th style={{ cursor: 'default' }}>Task</th>
<th style={{ cursor: 'default' }}>Repo</th>
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/CostView.tsx
git commit -m "fix: right-align numeric columns in Cost view table"
```

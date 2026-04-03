# Phase 4: Unified Task Pipeline & Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Dashboard home view and enhance the Sprint Center with an inline task monitor panel so users can watch agent progress without context-switching between views.

**Architecture:** Two new features: (1) A Dashboard view that aggregates data from existing stores (sprintTasks, costData, unifiedAgents) into a card-based overview. (2) Promotion of the LogDrawer from a modal overlay to an optional side panel within Sprint Center, using the existing `react-resizable-panels` library. Both features read from existing stores — no new IPC channels needed.

**Tech Stack:** React, TypeScript, Zustand, react-resizable-panels, existing design tokens

**Prerequisites:** PRs #348 (security), #349 (architecture), #350 (accessibility) are merged to main. ActivityBar now uses `<nav>` with `aria-label`/`aria-current`, PanelTabBar has `role="tablist"`/`role="tab"`, PanelLeaf has `role="tabpanel"`. Preserve all ARIA attributes when modifying these files.

---

## File Structure

| Action | File                                                                     | Responsibility                                      |
| ------ | ------------------------------------------------------------------------ | --------------------------------------------------- |
| Create | `src/renderer/src/views/DashboardView.tsx`                               | Card-based home screen with aggregated metrics      |
| Create | `src/renderer/src/views/__tests__/DashboardView.test.tsx`                | Tests for Dashboard                                 |
| Modify | `src/renderer/src/components/sprint/SprintCenter.tsx`                    | Replace LogDrawer overlay with inline panel option  |
| Create | `src/renderer/src/components/sprint/TaskMonitorPanel.tsx`                | Inline task output panel (promoted LogDrawer)       |
| Create | `src/renderer/src/components/sprint/__tests__/TaskMonitorPanel.test.tsx` | Tests for monitor panel                             |
| Create | `src/renderer/src/components/dashboard/DashboardCard.tsx`                | Reusable summary card                               |
| Create | `src/renderer/src/components/dashboard/ActiveTasksCard.tsx`              | Active/queued tasks list                            |
| Create | `src/renderer/src/components/dashboard/RecentCompletionsCard.tsx`        | Recently completed tasks                            |
| Create | `src/renderer/src/components/dashboard/CostSummaryCard.tsx`              | Weekly cost snapshot                                |
| Create | `src/renderer/src/components/dashboard/OpenPRsCard.tsx`                  | Open PRs needing attention                          |
| Modify | `src/renderer/src/components/layout/ActivityBar.tsx`                     | Add Dashboard as first nav item                     |
| Modify | `src/renderer/src/components/panels/PanelLeaf.tsx`                       | Register Dashboard view in lazy switch              |
| Modify | `src/renderer/src/stores/panelLayout.ts`                                 | Add 'dashboard' to View type                        |
| Modify | `src/renderer/src/lib/constants.ts`                                      | Add dashboard polling interval                      |
| Modify | `src/shared/ipc-channels.ts`                                             | No changes needed — all data from existing channels |

---

### Task 1: Add Dashboard View Type and Navigation

**Files:**

- Modify: `src/renderer/src/stores/panelLayout.ts`
- Modify: `src/renderer/src/components/layout/ActivityBar.tsx`
- Modify: `src/renderer/src/components/panels/PanelLeaf.tsx`

**Context:** The app currently has 8 views. Dashboard will become the 9th — and the first item in the ActivityBar. The `View` type union lives in `stores/panelLayout.ts` (not `ui.ts`) and must be extended. The ActivityBar needs a new entry with LayoutDashboard icon. PanelLeaf's lazy switch must include the new view.

- [ ] **Step 1: Extend View type in panelLayout.ts**

In `src/renderer/src/stores/panelLayout.ts`, find the `View` type union and add `'dashboard'`. Also add `'dashboard'` to the `VIEW_LABELS` map:

```typescript
export type View =
  | 'dashboard'
  | 'agents'
  | 'terminal'
  | 'sprint'
  | 'pr-station'
  | 'memory'
  | 'cost'
  | 'settings'
  | 'task-workbench'

export const VIEW_LABELS: Record<View, string> = {
  dashboard: 'Dashboard'
  // ... existing entries
}
```

- [ ] **Step 2: Add Dashboard to ActivityBar as first item and update all keyboard shortcuts**

In `src/renderer/src/components/layout/ActivityBar.tsx`, add to the nav items array:

```typescript
import { LayoutDashboard } from 'lucide-react'

// Insert as first item:
{ view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: '⌘1' },
```

**New coordinated shortcut assignments** (shifts all existing shortcuts down by 1):

| Shortcut | View                    |
| -------- | ----------------------- |
| ⌘1       | Dashboard               |
| ⌘2       | Agents                  |
| ⌘3       | Terminal                |
| ⌘4       | Sprint                  |
| ⌘5       | PR Station              |
| ⌘6       | Git (from Phase 6 plan) |
| ⌘7       | Memory                  |
| ⌘8       | Cost                    |
| ⌘9       | Settings                |

**Important:** The keyboard handlers in `App.tsx` must also be updated to match these new assignments. Search for the `⌘+digit` / `Cmd+digit` key event handler block and remap each digit to the corresponding view above.

- [ ] **Step 3: Register Dashboard in PanelLeaf lazy switch**

In `src/renderer/src/components/panels/PanelLeaf.tsx`:

```typescript
const DashboardView = lazy(() => import('../../views/DashboardView'))

// In the view switch:
case 'dashboard':
  return <Suspense fallback={<ViewSkeleton />}><DashboardView /></Suspense>
```

- [ ] **Step 4: Set Dashboard as default view**

In `src/renderer/src/stores/panelLayout.ts`, update the default root layout to use 'dashboard':

```typescript
export const DEFAULT_LAYOUT: PanelNode = createLeaf('dashboard') // was 'agents'
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/panelLayout.ts src/renderer/src/components/layout/ActivityBar.tsx src/renderer/src/components/panels/PanelLeaf.tsx src/renderer/src/App.tsx
git commit -m "feat: register Dashboard view type and navigation"
```

---

### Task 2: Build DashboardCard Base Component

**Files:**

- Create: `src/renderer/src/components/dashboard/DashboardCard.tsx`

**Context:** Each dashboard section is a card with a title, optional icon, and content area. Uses existing `Card` component with consistent styling.

- [ ] **Step 1: Write the DashboardCard component**

```typescript
// src/renderer/src/components/dashboard/DashboardCard.tsx
import type { ReactNode } from 'react'
import { tokens } from '../../design-system/tokens'

interface DashboardCardProps {
  title: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
}

export function DashboardCard({ title, icon, action, children }: DashboardCardProps) {
  return (
    <div style={{
      background: tokens.color.surface,
      border: `1px solid ${tokens.color.border}`,
      borderRadius: tokens.radius.lg,
      padding: tokens.space[4],
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.space[3],
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          fontSize: tokens.fontSize.sm,
          fontWeight: 600,
          color: tokens.color.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {icon}
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/dashboard/DashboardCard.tsx
git commit -m "feat: add DashboardCard base component"
```

---

### Task 3: Build Dashboard Section Cards

**Files:**

- Create: `src/renderer/src/components/dashboard/ActiveTasksCard.tsx`
- Create: `src/renderer/src/components/dashboard/RecentCompletionsCard.tsx`
- Create: `src/renderer/src/components/dashboard/CostSummaryCard.tsx`
- Create: `src/renderer/src/components/dashboard/OpenPRsCard.tsx`

- [ ] **Step 1: Build ActiveTasksCard**

```typescript
// src/renderer/src/components/dashboard/ActiveTasksCard.tsx
import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { DashboardCard } from './DashboardCard'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { tokens } from '../../design-system/tokens'
import type { SprintTask } from '../../../../shared/ipc-channels'

export function ActiveTasksCard() {
  const tasks = useSprintTasks((s) => s.tasks)

  const activeTasks = useMemo(() =>
    tasks.filter((t) => ['queued', 'in_progress', 'blocked'].includes(t.status))
      .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))
      .slice(0, 5),
    [tasks]
  )

  const counts = useMemo(() => ({
    running: tasks.filter((t) => t.status === 'in_progress').length,
    queued: tasks.filter((t) => t.status === 'queued').length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
  }), [tasks])

  return (
    <DashboardCard title="Active Tasks" icon={<Activity size={14} />}>
      <div style={{ display: 'flex', gap: tokens.space[2], marginBottom: tokens.space[2] }}>
        {counts.running > 0 && <Badge variant="success">Running: {counts.running}</Badge>}
        {counts.queued > 0 && <Badge variant="info">Queued: {counts.queued}</Badge>}
        {counts.blocked > 0 && <Badge variant="warning">Blocked: {counts.blocked}</Badge>}
      </div>
      {activeTasks.length === 0 ? (
        <div style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.sm }}>
          No active tasks. Create one from Sprint Center.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          {activeTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </DashboardCard>
  )
}

function TaskRow({ task }: { task: SprintTask }) {
  const statusColor: Record<string, string> = {
    in_progress: tokens.color.success,
    queued: tokens.color.info,
    blocked: tokens.color.warning,
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: tokens.space[2],
      padding: `${tokens.space[1]} ${tokens.space[2]}`,
      borderRadius: tokens.radius.sm,
      fontSize: tokens.fontSize.sm,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: statusColor[task.status] ?? tokens.color.textDim,
        flexShrink: 0,
      }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {task.title}
      </span>
      <Badge variant="muted" size="sm">P{task.priority ?? 3}</Badge>
    </div>
  )
}
```

- [ ] **Step 2: Build RecentCompletionsCard**

```typescript
// src/renderer/src/components/dashboard/RecentCompletionsCard.tsx
import { useMemo } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { DashboardCard } from './DashboardCard'
import { tokens } from '../../design-system/tokens'

export function RecentCompletionsCard() {
  const tasks = useSprintTasks((s) => s.tasks)

  const recent = useMemo(() =>
    tasks
      .filter((t) => t.status === 'done' && t.updated_at)
      .sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime())
      .slice(0, 5),
    [tasks]
  )

  return (
    <DashboardCard title="Recent Completions" icon={<CheckCircle2 size={14} />}>
      {recent.length === 0 ? (
        <div style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.sm }}>
          No completed tasks yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          {recent.map((task) => (
            <div key={task.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[2],
              padding: `${tokens.space[1]} ${tokens.space[2]}`,
              fontSize: tokens.fontSize.sm,
            }}>
              <CheckCircle2 size={12} style={{ color: tokens.color.success, flexShrink: 0 }} aria-hidden="true" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {task.title}
              </span>
              <span style={{ color: tokens.color.textDim, fontSize: tokens.fontSize.xs }}>
                {task.repo}
              </span>
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  )
}
```

- [ ] **Step 3: Build CostSummaryCard**

```typescript
// src/renderer/src/components/dashboard/CostSummaryCard.tsx
import { DollarSign } from 'lucide-react'
import { useCostDataStore } from '../../stores/costData'
import { DashboardCard } from './DashboardCard'
import { tokens } from '../../design-system/tokens'

export function CostSummaryCard() {
  const { totalCost, localAgents } = useCostDataStore()
  const taskCount = localAgents.length

  return (
    <DashboardCard title="Cost This Session" icon={<DollarSign size={14} />}>
      <div style={{ display: 'flex', gap: tokens.space[6] }}>
        <Stat label="Total Cost" value={`$${totalCost.toFixed(2)}`} />
        <Stat label="Agent Runs" value={String(taskCount)} />
        <Stat
          label="Avg Cost"
          value={taskCount > 0 ? `$${(totalCost / taskCount).toFixed(2)}` : '—'}
        />
      </div>
    </DashboardCard>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: tokens.fontSize.xxl, fontWeight: 600, fontFamily: tokens.font.code }}>
        {value}
      </div>
      <div style={{ fontSize: tokens.fontSize.xs, color: tokens.color.textMuted }}>{label}</div>
    </div>
  )
}
```

- [ ] **Step 4: Build OpenPRsCard**

```typescript
// src/renderer/src/components/dashboard/OpenPRsCard.tsx
import { useMemo, useState, useEffect } from 'react'
import { GitPullRequest } from 'lucide-react'
import { DashboardCard } from './DashboardCard'
import { Badge } from '../ui/Badge'
import { tokens } from '../../design-system/tokens'

interface PRSummary {
  title: string
  repo: string
  number: number
  checksStatus: 'pass' | 'fail' | 'pending' | 'unknown'
}

export function OpenPRsCard() {
  const [prs, setPrs] = useState<PRSummary[]>([])

  useEffect(() => {
    window.api.getPrList?.().then((list: any[]) => {
      setPrs(
        (list ?? []).slice(0, 5).map((pr) => ({
          title: pr.title,
          repo: pr.base?.repo?.name ?? '',
          number: pr.number,
          checksStatus: 'unknown',
        }))
      )
    }).catch(() => {})
  }, [])

  return (
    <DashboardCard title="Open PRs" icon={<GitPullRequest size={14} />}>
      {prs.length === 0 ? (
        <div style={{ color: tokens.color.textMuted, fontSize: tokens.fontSize.sm }}>
          No open PRs.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          {prs.map((pr) => (
            <div key={`${pr.repo}#${pr.number}`} style={{
              display: 'flex', alignItems: 'center', gap: tokens.space[2],
              padding: `${tokens.space[1]} ${tokens.space[2]}`,
              fontSize: tokens.fontSize.sm,
            }}>
              <GitPullRequest size={12} style={{ color: tokens.color.success, flexShrink: 0 }} aria-hidden="true" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pr.title}
              </span>
              <Badge variant="muted" size="sm">{pr.repo}#{pr.number}</Badge>
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/dashboard/
git commit -m "feat: add Dashboard section cards (active tasks, completions, cost, PRs)"
```

---

### Task 4: Build DashboardView

**Files:**

- Create: `src/renderer/src/views/DashboardView.tsx`
- Create: `src/renderer/src/views/__tests__/DashboardView.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/views/__tests__/DashboardView.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.stubGlobal('window', {
  ...window,
  api: {
    sprint: { list: vi.fn().mockResolvedValue([]) },
    cost: { agentRuns: vi.fn().mockResolvedValue([]) },
    getPrList: vi.fn().mockResolvedValue([]),
  },
})

import DashboardView from '../DashboardView'

describe('DashboardView', () => {
  it('renders dashboard heading', () => {
    render(<DashboardView />)
    expect(screen.getByText(/dashboard/i)).toBeDefined()
  })

  it('renders all 4 section cards', () => {
    render(<DashboardView />)
    expect(screen.getByText(/active tasks/i)).toBeDefined()
    expect(screen.getByText(/recent completions/i)).toBeDefined()
    expect(screen.getByText(/cost/i)).toBeDefined()
    expect(screen.getByText(/open prs/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/views/__tests__/DashboardView.test.tsx`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Build DashboardView**

```typescript
// src/renderer/src/views/DashboardView.tsx
import { useEffect } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { ActiveTasksCard } from '../components/dashboard/ActiveTasksCard'
import { RecentCompletionsCard } from '../components/dashboard/RecentCompletionsCard'
import { CostSummaryCard } from '../components/dashboard/CostSummaryCard'
import { OpenPRsCard } from '../components/dashboard/OpenPRsCard'
import { tokens } from '../design-system/tokens'

export default function DashboardView() {
  const loadData = useSprintTasks((s) => s.loadData)
  const fetchCost = useCostDataStore((s) => s.fetchLocalAgents)

  useEffect(() => {
    loadData()
    fetchCost()
  }, [loadData, fetchCost])

  return (
    <div style={{
      padding: tokens.space[5],
      height: '100%',
      overflow: 'auto',
    }}>
      <h2 style={{
        fontSize: tokens.fontSize.xl,
        fontWeight: 600,
        marginBottom: tokens.space[5],
      }}>
        Dashboard
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: tokens.space[4],
      }}>
        <ActiveTasksCard />
        <OpenPRsCard />
        <RecentCompletionsCard />
        <CostSummaryCard />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/views/__tests__/DashboardView.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/views/DashboardView.tsx src/renderer/src/views/__tests__/DashboardView.test.tsx
git commit -m "feat: add Dashboard home view with aggregated metrics"
```

---

### Task 5: Build TaskMonitorPanel (Promoted LogDrawer)

**Files:**

- Create: `src/renderer/src/components/sprint/TaskMonitorPanel.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/TaskMonitorPanel.test.tsx`
- Modify: `src/renderer/src/components/sprint/SprintCenter.tsx`

**Context:** The LogDrawer is a modal overlay that blocks the Kanban board. Users can't watch agent progress while managing tasks. The TaskMonitorPanel is the same content rendered as a resizable side panel using `react-resizable-panels` instead of an overlay.

- [ ] **Step 1: Write failing test**

```typescript
// src/renderer/src/components/sprint/__tests__/TaskMonitorPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskMonitorPanel } from '../TaskMonitorPanel'

vi.stubGlobal('window', {
  ...window,
  api: { sprint: { readLog: vi.fn().mockResolvedValue('') } },
})

describe('TaskMonitorPanel', () => {
  it('renders task title when task is provided', () => {
    render(
      <TaskMonitorPanel
        task={{ id: '1', title: 'Fix auth bug', status: 'in_progress' } as any}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Fix auth bug')).toBeDefined()
  })

  it('renders empty state when no task is provided', () => {
    render(<TaskMonitorPanel task={null} onClose={() => {}} />)
    expect(screen.getByText(/select a task/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskMonitorPanel.test.tsx`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Build TaskMonitorPanel**

```typescript
// src/renderer/src/components/sprint/TaskMonitorPanel.tsx
import { useEffect, useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import { useSprintEvents } from '../../stores/sprintEvents'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { tokens } from '../../design-system/tokens'
import type { SprintTask } from '../../../../shared/ipc-channels'

interface TaskMonitorPanelProps {
  task: SprintTask | null
  onClose: () => void
}

export function TaskMonitorPanel({ task, onClose }: TaskMonitorPanelProps) {
  const taskEvents = useSprintEvents((s) => task ? s.taskEvents[task.id] ?? [] : [])
  const [logContent, setLogContent] = useState('')

  useEffect(() => {
    if (!task?.id) return
    // Poll log content for the active task
    const poll = async () => {
      try {
        const content = await window.api.sprint.readLog(task.id, 0)
        if (typeof content === 'string') setLogContent(content)
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [task?.id])

  if (!task) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          icon={<ExternalLink size={24} />}
          title="Select a task"
          description="Click a running task to monitor its progress here."
        />
      </div>
    )
  }

  const statusVariant: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'muted'> = {
    in_progress: 'success',
    queued: 'info',
    done: 'muted',
    failed: 'danger',
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: tokens.color.surface,
      borderLeft: `1px solid ${tokens.color.border}`,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[2]} ${tokens.space[3]}`,
        borderBottom: `1px solid ${tokens.color.border}`,
        minHeight: 40,
      }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: tokens.fontSize.sm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </span>
        <Badge variant={statusVariant[task.status] ?? 'muted'} size="sm">{task.status}</Badge>
        <button className="bde-btn bde-btn--icon bde-btn--sm" onClick={onClose} aria-label="Close monitor panel">
          <X size={14} />
        </button>
      </div>

      {/* Agent output */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: tokens.space[3],
        fontFamily: tokens.font.code,
        fontSize: tokens.fontSize.xs,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        color: tokens.color.textMuted,
      }}>
        {taskEvents.length > 0 ? (
          taskEvents.map((evt, i) => (
            <div key={i} style={{ marginBottom: tokens.space[1] }}>
              {evt.type === 'assistant' && <span style={{ color: tokens.color.text }}>{evt.content}</span>}
              {evt.type === 'tool_use' && <span style={{ color: tokens.color.info }}>→ {evt.tool_name}</span>}
              {evt.type === 'tool_result' && <span style={{ color: tokens.color.textDim }}>{String(evt.content).slice(0, 200)}</span>}
            </div>
          ))
        ) : logContent ? (
          logContent
        ) : (
          <span style={{ color: tokens.color.textDim }}>Waiting for agent output...</span>
        )}
      </div>

      {/* Footer with PR link if available */}
      {task.pr_url && (
        <div style={{
          padding: `${tokens.space[2]} ${tokens.space[3]}`,
          borderTop: `1px solid ${tokens.color.border}`,
          fontSize: tokens.fontSize.xs,
        }}>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.api.openExternal(task.pr_url!) }}
            style={{ color: tokens.color.accent, display: 'flex', alignItems: 'center', gap: tokens.space[1] }}
          >
            <ExternalLink size={10} /> View PR
          </a>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Integrate TaskMonitorPanel into SprintCenter**

In `src/renderer/src/components/sprint/SprintCenter.tsx`, replace the LogDrawer overlay with an inline panel:

```typescript
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TaskMonitorPanel } from './TaskMonitorPanel'

// In the return, wrap the kanban area and monitor panel:
<PanelGroup direction="horizontal">
  <Panel defaultSize={monitorTaskId ? 65 : 100} minSize={40}>
    {/* Existing Kanban board content */}
  </Panel>

  {monitorTaskId && (
    <>
      <PanelResizeHandle className="panel-resize-handle" />
      <Panel defaultSize={35} minSize={20}>
        <TaskMonitorPanel
          task={tasks.find((t) => t.id === monitorTaskId) ?? null}
          onClose={() => setLogDrawerTaskId(null)}
        />
      </Panel>
    </>
  )}
</PanelGroup>
```

Keep the LogDrawer as a fallback for narrow windows — show LogDrawer below 800px width, inline panel above.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskMonitorPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/sprint/TaskMonitorPanel.tsx src/renderer/src/components/sprint/__tests__/TaskMonitorPanel.test.tsx src/renderer/src/components/sprint/SprintCenter.tsx
git commit -m "feat: add inline TaskMonitorPanel to Sprint Center (promoted LogDrawer)"
```

---

### Task 6: Extend Onboarding to Check Git, Repos, and Supabase

**Files:**

- Modify: `src/renderer/src/components/Onboarding.tsx`

**Context:** Onboarding currently only checks Claude Code CLI and OAuth token. Users pass onboarding and then hit errors because git isn't installed, repos aren't configured, or Supabase isn't reachable.

- [ ] **Step 1: Add additional onboarding checks**

Extend the checks array in Onboarding.tsx:

```typescript
const checks = [
  { label: 'Claude Code CLI', check: () => window.api.authStatus().then((r) => r.cliFound) },
  {
    label: 'Authentication token',
    check: () => window.api.authStatus().then((r) => r.tokenFound && !r.tokenExpired)
  },
  {
    label: 'Git available',
    check: () =>
      window.api
        .gitStatus('.')
        .then(() => true)
        .catch(() => false)
  },
  {
    label: 'Repositories configured',
    check: () =>
      window.api.settings
        .getJson('repos')
        .then((repos: any[]) => Array.isArray(repos) && repos.length > 0),
    optional: true // user can configure later
  },
  {
    label: 'Supabase connected',
    check: () =>
      window.api.sprint
        .list()
        .then(() => true)
        .catch(() => false),
    optional: true
  }
]
```

For optional checks that fail, show a warning instead of blocking. Add a "Skip" button that lets users proceed with warnings.

- [ ] **Step 2: Add guidance text for failed checks**

```typescript
const helpText: Record<string, string> = {
  'Claude Code CLI': 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
  'Authentication token': 'Run: claude login',
  'Git available': 'Install git: brew install git (macOS) or apt install git (Linux)',
  'Repositories configured': 'Go to Settings → Repositories to add your repos',
  'Supabase connected': 'Go to Settings → Connections to configure Supabase URL and key'
}
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Onboarding.tsx
git commit -m "feat: extend onboarding to check git, repos, and Supabase connectivity"
```

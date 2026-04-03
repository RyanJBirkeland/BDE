# Sprint Center Pipeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sprint Center's sidebar-list + detail-pane layout with a three-zone vertical pipeline view where tasks visually flow through stages.

**Architecture:** Three zones — left sidebar (Backlog + Failed), center pipeline (Queued → Blocked → Active → Review → Done), right detail drawer (slides in on task click). Built as new components alongside existing ones; swap at the view level. Uses framer-motion `layoutId` for smooth stage transitions.

**Tech Stack:** React, TypeScript, Zustand, framer-motion, CSS custom properties (`var(--neon-*)`)

**Spec:** `docs/superpowers/specs/2026-03-26-sprint-pipeline-redesign-design.md`

**Worktree:** Create with `git worktree add -b feat/sprint-pipeline ~/worktrees/bde/feat-sprint-pipeline main` — run `npm install` before starting.

---

### Task 1: Add pipeline UI state to sprintUI store

**Files:**

- Modify: `src/renderer/src/stores/sprintUI.ts`
- Test: `src/renderer/src/stores/__tests__/sprintUI.test.ts` (if exists, else inline verification)

- [ ] **Step 1: Add new state fields and actions**

Add to `SprintUIState` interface and store implementation:

```typescript
// Add to interface
drawerOpen: boolean
specPanelOpen: boolean
doneViewOpen: boolean

// Add to actions
setDrawerOpen: (open: boolean) => void
setSpecPanelOpen: (open: boolean) => void
setDoneViewOpen: (open: boolean) => void
```

Add to the store's initial state:

```typescript
drawerOpen: false,
specPanelOpen: false,
doneViewOpen: false,

setDrawerOpen: (open): void => set({ drawerOpen: open }),
setSpecPanelOpen: (open): void => set({ specPanelOpen: open }),
setDoneViewOpen: (open): void => set({ doneViewOpen: open }),
```

- [ ] **Step 2: Update setSelectedTaskId to auto-open drawer**

Modify `setSelectedTaskId` to open the drawer when a task is selected:

```typescript
setSelectedTaskId: (id): void => set({ selectedTaskId: id, drawerOpen: id !== null }),
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit -p tsconfig.web.json --composite false`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/stores/sprintUI.ts
git commit -m "feat(sprint): add pipeline drawer state to sprintUI store"
```

---

### Task 2: Create sprint-pipeline-neon.css

**Files:**

- Create: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Create the CSS file**

Create `src/renderer/src/assets/sprint-pipeline-neon.css` with all pipeline layout classes. This file handles the three-zone layout, pipeline stages, task pills, backlog sidebar, detail drawer, and spec panel.

```css
/* ═══════════════════════════════════════════════════════
   Sprint Pipeline — Three-Zone Vertical Pipeline View
   ═══════════════════════════════════════════════════════ */

/* ── Shell Layout ── */
.sprint-pipeline {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--neon-bg);
  font-family: var(--bde-font-code);
}

.sprint-pipeline__header {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: linear-gradient(180deg, rgba(138, 43, 226, 0.08) 0%, rgba(10, 0, 21, 0.6) 100%);
  border-bottom: 1px solid var(--neon-purple-border);
  flex-shrink: 0;
}

.sprint-pipeline__title {
  color: var(--neon-cyan);
  font-weight: 700;
  font-size: 14px;
}

.sprint-pipeline__stat {
  font-size: 10px;
  color: var(--neon-text-dim);
}

.sprint-pipeline__stat b {
  color: var(--neon-text-muted);
}

.sprint-pipeline__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── Left Sidebar (Backlog + Failed) ── */
.pipeline-sidebar {
  width: 200px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}

.pipeline-sidebar__section {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.pipeline-sidebar__section--grow {
  flex: 1;
  overflow-y: auto;
}

.pipeline-sidebar__section + .pipeline-sidebar__section {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.pipeline-sidebar__label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.pipeline-sidebar__count {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 9px;
  font-weight: 600;
}

/* Backlog card */
.backlog-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 4px;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease;
}

.backlog-card:hover {
  border-color: var(--neon-cyan-border);
  background: var(--neon-cyan-surface);
}

.backlog-card__title {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.backlog-card__meta {
  font-size: 9px;
  color: var(--neon-text-dim);
  display: flex;
  gap: 8px;
}

.backlog-card__action {
  font-size: 9px;
  color: var(--neon-cyan);
  margin-top: 4px;
  opacity: 0;
  transition: opacity 150ms ease;
}

.backlog-card:hover .backlog-card__action {
  opacity: 1;
}

/* Failed card */
.failed-card {
  background: var(--neon-red-surface);
  border: 1px solid var(--neon-red-border);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 4px;
  cursor: pointer;
  transition: background 150ms ease;
}

.failed-card:hover {
  background: rgba(255, 50, 100, 0.08);
}

.failed-card__title {
  font-size: 11px;
  color: var(--neon-red);
}

.failed-card__meta {
  font-size: 9px;
  color: var(--neon-text-dim);
  margin-top: 2px;
}

/* ── Pipeline Center ── */
.pipeline-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  overflow-y: auto;
}

/* Connector line */
.pipeline-center::before {
  content: '';
  position: absolute;
  left: 28px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(
    180deg,
    var(--neon-cyan) 0%,
    rgba(255, 180, 50, 0.6) 20%,
    var(--neon-purple) 45%,
    rgba(100, 200, 255, 0.6) 70%,
    rgba(255, 100, 200, 0.4) 100%
  );
  z-index: 0;
  opacity: 0.3;
}

/* ── Pipeline Stage ── */
.pipeline-stage {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px 10px 48px;
  position: relative;
  min-height: 64px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.pipeline-stage:last-child {
  border-bottom: none;
}

/* Stage dot on connector */
.pipeline-stage__dot {
  position: absolute;
  left: 22px;
  top: 14px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  color: var(--neon-bg);
}

.pipeline-stage__dot--queued {
  background: var(--neon-cyan);
  box-shadow: 0 0 10px rgba(0, 255, 200, 0.4);
}

.pipeline-stage__dot--blocked {
  background: var(--neon-orange);
  box-shadow: 0 0 10px rgba(255, 180, 50, 0.4);
}

.pipeline-stage__dot--active {
  background: var(--neon-purple);
  box-shadow: 0 0 10px rgba(191, 90, 242, 0.5);
  animation: pipeline-pulse 2s ease-in-out infinite;
}

.pipeline-stage__dot--review {
  background: var(--neon-blue);
  box-shadow: 0 0 10px rgba(100, 200, 255, 0.4);
}

.pipeline-stage__dot--done {
  background: var(--neon-pink);
  box-shadow: 0 0 8px rgba(255, 100, 200, 0.3);
}

@keyframes pipeline-pulse {
  0%,
  100% {
    box-shadow: 0 0 10px rgba(191, 90, 242, 0.5);
  }
  50% {
    box-shadow: 0 0 20px rgba(191, 90, 242, 0.8);
  }
}

.pipeline-stage__header {
  width: 72px;
  flex-shrink: 0;
}

.pipeline-stage__name {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.pipeline-stage__name--queued {
  color: var(--neon-cyan);
}
.pipeline-stage__name--blocked {
  color: var(--neon-orange);
}
.pipeline-stage__name--active {
  color: var(--neon-purple);
}
.pipeline-stage__name--review {
  color: var(--neon-blue);
}
.pipeline-stage__name--done {
  color: var(--neon-pink);
}

.pipeline-stage__count {
  font-size: 9px;
  color: var(--neon-text-dim);
  margin-top: 1px;
}

.pipeline-stage__cards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
  align-content: flex-start;
}

/* ── Task Pill ── */
.task-pill {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 200ms ease;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 300px;
}

.task-pill:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}

.task-pill--selected {
  border-color: var(--neon-cyan-border) !important;
  background: var(--neon-cyan-surface) !important;
  box-shadow: 0 0 12px rgba(0, 255, 200, 0.15);
}

.task-pill--active {
  border-color: var(--neon-purple-border);
  background: var(--neon-purple-surface);
}

.task-pill--active:hover {
  border-color: rgba(191, 90, 242, 0.5);
  box-shadow: 0 0 12px rgba(191, 90, 242, 0.15);
}

.task-pill--blocked {
  border-color: var(--neon-orange-border);
  background: var(--neon-orange-surface);
}

.task-pill--review {
  border-color: var(--neon-blue-border);
  background: var(--neon-blue-surface);
}

.task-pill--done {
  opacity: 0.5;
  border-color: var(--neon-pink-border);
}

.task-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.task-pill__title {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.task-pill__badge {
  font-size: 8px;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
  font-weight: 600;
}

.task-pill__time {
  font-size: 9px;
  color: var(--neon-text-dim);
  flex-shrink: 0;
}

/* Done footer */
.pipeline-stage__done-footer {
  font-size: 9px;
  color: var(--neon-text-dim);
  margin-top: 6px;
  width: 100%;
}

.pipeline-stage__done-link {
  color: var(--neon-pink);
  cursor: pointer;
  background: none;
  border: none;
  font: inherit;
  padding: 0;
}

.pipeline-stage__done-link:hover {
  text-decoration: underline;
}

/* Arrival glow animation */
@keyframes task-arrive {
  0% {
    box-shadow: 0 0 16px var(--neon-cyan);
  }
  100% {
    box-shadow: none;
  }
}

.task-pill--arriving {
  animation: task-arrive 500ms ease-out;
}

/* ── Detail Drawer ── */
.task-drawer {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--neon-purple-border);
  background: linear-gradient(135deg, rgba(138, 43, 226, 0.04), rgba(10, 0, 21, 0.95));
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.task-drawer__head {
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.task-drawer__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--neon-text);
  margin-bottom: 8px;
  word-break: break-word;
}

.task-drawer__status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.task-drawer__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.task-drawer__body {
  padding: 12px 16px;
  flex: 1;
}

.task-drawer__field {
  margin-bottom: 14px;
}

.task-drawer__label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--neon-text-dim);
  margin-bottom: 4px;
}

.task-drawer__value {
  font-size: 11px;
  color: var(--neon-text-muted);
  line-height: 1.5;
}

/* Prompt block */
.task-drawer__prompt {
  background: var(--neon-surface-dim);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: var(--bde-font-code);
  font-size: 11px;
  color: var(--neon-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.5;
}

/* Spec link */
.task-drawer__spec-link {
  color: var(--neon-cyan);
  font-size: 11px;
  cursor: pointer;
  background: none;
  border: none;
  font: inherit;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-drawer__spec-link:hover {
  text-decoration: underline;
}

/* Agent link */
.task-drawer__agent-link {
  color: var(--neon-cyan);
  font-size: 11px;
  cursor: pointer;
  background: none;
  border: none;
  font: inherit;
  padding: 0;
}

/* Actions bar */
.task-drawer__actions {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.task-drawer__btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid;
  cursor: pointer;
  font-family: var(--bde-font-code);
  transition: background 100ms ease;
}

.task-drawer__btn--primary {
  background: var(--neon-purple-surface);
  border-color: var(--neon-purple-border);
  color: var(--neon-purple);
}

.task-drawer__btn--primary:hover {
  background: rgba(191, 90, 242, 0.2);
}

.task-drawer__btn--secondary {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--neon-text-muted);
}

.task-drawer__btn--secondary:hover {
  background: rgba(255, 255, 255, 0.08);
}

.task-drawer__btn--danger {
  background: var(--neon-red-surface);
  border-color: var(--neon-red-border);
  color: var(--neon-red);
}

.task-drawer__btn--danger:hover {
  background: rgba(255, 50, 100, 0.15);
}

/* ── Spec Panel (wide overlay) ── */
.spec-panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  display: flex;
  justify-content: flex-end;
}

.spec-panel {
  width: 600px;
  max-width: 80vw;
  background: linear-gradient(135deg, rgba(138, 43, 226, 0.06), rgba(10, 0, 21, 0.98));
  border-left: 1px solid var(--neon-purple-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.spec-panel__header {
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.spec-panel__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--neon-text);
}

.spec-panel__close {
  background: none;
  border: none;
  color: var(--neon-text-dim);
  cursor: pointer;
  padding: 4px;
  font-size: 18px;
}

.spec-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--neon-text-muted);
}

.spec-panel__actions {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  gap: 8px;
}

/* ── Done History Modal ── */
.done-history-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.done-history {
  width: 500px;
  max-height: 70vh;
  background: linear-gradient(135deg, rgba(138, 43, 226, 0.06), rgba(10, 0, 21, 0.98));
  border: 1px solid var(--neon-purple-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.done-history__header {
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.done-history__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--neon-pink);
}

.done-history__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.done-history__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 100ms ease;
}

.done-history__item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.done-history__item-title {
  flex: 1;
  font-size: 11px;
  color: var(--neon-text-muted);
}

.done-history__item-time {
  font-size: 9px;
  color: var(--neon-text-dim);
}

/* ── Reduced Motion ── */
@media (prefers-reduced-motion: reduce) {
  .pipeline-stage__dot--active {
    animation: none;
  }
  .task-pill--arriving {
    animation: none;
  }
  .task-pill:hover {
    transform: none;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat(sprint): add pipeline-specific neon CSS"
```

---

### Task 3: Create TaskPill component

**Files:**

- Create: `src/renderer/src/components/sprint/TaskPill.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskPill } from '../TaskPill'

const baseMockTask = {
  id: 'task-1',
  title: 'Add auth middleware',
  status: 'queued' as const,
  repo: 'bde',
  priority: 2,
  task: 'Follow the plan...',
  spec: null,
  pr_url: null,
  pr_number: null,
  pr_status: null,
  agent_run_id: null,
  notes: null,
  depends_on: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-03-26T10:00:00Z',
  updated_at: '2026-03-26T10:00:00Z',
  claimed_by: null,
  max_runtime_ms: null,
  fast_fail_count: 0,
  playground_enabled: false
}

describe('TaskPill', () => {
  it('renders task title', () => {
    render(<TaskPill task={baseMockTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('Add auth middleware')).toBeInTheDocument()
  })

  it('renders repo badge', () => {
    render(<TaskPill task={baseMockTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText('bde')).toBeInTheDocument()
  })

  it('applies selected class when selected', () => {
    const { container } = render(<TaskPill task={baseMockTask} selected={true} onClick={vi.fn()} />)
    expect(container.querySelector('.task-pill--selected')).toBeInTheDocument()
  })

  it('applies active class for active tasks', () => {
    const activeTask = { ...baseMockTask, status: 'active' as const }
    const { container } = render(<TaskPill task={activeTask} selected={false} onClick={vi.fn()} />)
    expect(container.querySelector('.task-pill--active')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<TaskPill task={baseMockTask} selected={false} onClick={onClick} />)
    fireEvent.click(screen.getByText('Add auth middleware'))
    expect(onClick).toHaveBeenCalledWith('task-1')
  })

  it('shows elapsed time for active tasks with started_at', () => {
    const activeTask = {
      ...baseMockTask,
      status: 'active' as const,
      started_at: new Date(Date.now() - 300000).toISOString()
    }
    render(<TaskPill task={activeTask} selected={false} onClick={vi.fn()} />)
    expect(screen.getByText(/\dm/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TaskPill**

Create `src/renderer/src/components/sprint/TaskPill.tsx`:

```tsx
/**
 * TaskPill — Compact task card for pipeline display.
 * Shows status dot, title, repo badge, and elapsed time (for active tasks).
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'

interface TaskPillProps {
  task: SprintTask
  selected: boolean
  onClick: (id: string) => void
}

function getStatusClass(status: string, prStatus?: string | null): string {
  if (status === 'active' && prStatus !== 'open') return 'task-pill--active'
  if (status === 'blocked') return 'task-pill--blocked'
  if (status === 'active' && prStatus === 'open') return 'task-pill--review'
  if (status === 'done' && prStatus === 'open') return 'task-pill--review'
  if (status === 'done') return 'task-pill--done'
  return ''
}

function getDotColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'var(--neon-cyan)'
    case 'blocked':
      return 'var(--neon-orange)'
    case 'active':
      return 'var(--neon-purple)'
    case 'done':
      return 'var(--neon-pink)'
    default:
      return 'var(--neon-cyan)'
  }
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

export function TaskPill({ task, selected, onClick }: TaskPillProps) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (task.status !== 'active' || !task.started_at) return
    setElapsed(formatElapsed(task.started_at))
    const interval = setInterval(() => setElapsed(formatElapsed(task.started_at!)), 10000)
    return () => clearInterval(interval)
  }, [task.status, task.started_at])

  const statusClass = getStatusClass(task.status, task.pr_status)
  const classes = ['task-pill', statusClass, selected ? 'task-pill--selected' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <motion.div
      layoutId={task.id}
      className={classes}
      onClick={() => onClick(task.id)}
      transition={SPRINGS.default}
      data-testid="task-pill"
    >
      <div className="task-pill__dot" style={{ background: getDotColor(task.status) }} />
      <span className="task-pill__title">{task.title}</span>
      <span
        className="task-pill__badge"
        style={{
          background: 'var(--neon-cyan-surface)',
          color: 'var(--neon-cyan)'
        }}
      >
        {task.repo}
      </span>
      {elapsed && <span className="task-pill__time">{elapsed}</span>}
    </motion.div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sprint/TaskPill.tsx src/renderer/src/components/sprint/__tests__/TaskPill.test.tsx
git commit -m "feat(sprint): add TaskPill component for pipeline display"
```

---

### Task 4: Create PipelineStage component

**Files:**

- Create: `src/renderer/src/components/sprint/PipelineStage.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/PipelineStage.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineStage } from '../PipelineStage'

describe('PipelineStage', () => {
  it('renders stage name', () => {
    render(
      <PipelineStage
        name="queued"
        label="Queued"
        tasks={[]}
        count="3 tasks"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })

  it('renders task count', () => {
    render(
      <PipelineStage
        name="active"
        label="Active"
        tasks={[]}
        count="2 of 5"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(screen.getByText('2 of 5')).toBeInTheDocument()
  })

  it('renders stage dot with count', () => {
    const { container } = render(
      <PipelineStage
        name="queued"
        label="Queued"
        tasks={[]}
        count="0"
        selectedTaskId={null}
        onTaskClick={vi.fn()}
      />
    )
    expect(container.querySelector('.pipeline-stage__dot--queued')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement PipelineStage**

```tsx
/**
 * PipelineStage — Single row in the vertical pipeline.
 * Shows stage dot, label, count, and task pills.
 */
import { AnimatePresence } from 'framer-motion'
import { TaskPill } from './TaskPill'
import type { SprintTask } from '../../../../shared/types'

interface PipelineStageProps {
  name: 'queued' | 'blocked' | 'active' | 'review' | 'done'
  label: string
  tasks: SprintTask[]
  count: string
  selectedTaskId: string | null
  onTaskClick: (id: string) => void
  doneFooter?: React.ReactNode
}

export function PipelineStage({
  name,
  label,
  tasks,
  count,
  selectedTaskId,
  onTaskClick,
  doneFooter
}: PipelineStageProps) {
  return (
    <div className="pipeline-stage">
      <div className={`pipeline-stage__dot pipeline-stage__dot--${name}`}>{tasks.length}</div>
      <div className="pipeline-stage__header">
        <div className={`pipeline-stage__name pipeline-stage__name--${name}`}>{label}</div>
        <div className="pipeline-stage__count">{count}</div>
      </div>
      <div className="pipeline-stage__cards">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskPill
              key={task.id}
              task={task}
              selected={task.id === selectedTaskId}
              onClick={onTaskClick}
            />
          ))}
        </AnimatePresence>
        {doneFooter}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sprint/PipelineStage.tsx src/renderer/src/components/sprint/__tests__/PipelineStage.test.tsx
git commit -m "feat(sprint): add PipelineStage component"
```

---

### Task 5: Create PipelineBacklog sidebar component

**Files:**

- Create: `src/renderer/src/components/sprint/PipelineBacklog.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/PipelineBacklog.test.tsx`

- [ ] **Step 1: Write failing tests**

Test that it renders backlog tasks, failed tasks, shows "→ Add to queue" on hover, and calls callbacks.

- [ ] **Step 2: Implement PipelineBacklog**

```tsx
/**
 * PipelineBacklog — Left sidebar showing Backlog tasks and Failed tasks.
 */
import type { SprintTask } from '../../../../shared/types'

interface PipelineBacklogProps {
  backlog: SprintTask[]
  failed: SprintTask[]
  onTaskClick: (id: string) => void
  onAddToQueue: (task: SprintTask) => void
  onRerun: (task: SprintTask) => void
}

export function PipelineBacklog({
  backlog,
  failed,
  onTaskClick,
  onAddToQueue,
  onRerun
}: PipelineBacklogProps) {
  return (
    <div className="pipeline-sidebar">
      <div className="pipeline-sidebar__section pipeline-sidebar__section--grow">
        <div className="pipeline-sidebar__label" style={{ color: 'var(--neon-blue)' }}>
          BACKLOG <span className="pipeline-sidebar__count">{backlog.length}</span>
        </div>
        {backlog.map((task) => (
          <div key={task.id} className="backlog-card" onClick={() => onTaskClick(task.id)}>
            <div className="backlog-card__title">{task.title}</div>
            <div className="backlog-card__meta">
              <span>{task.repo}</span>
              {task.priority <= 2 && <span>P{task.priority}</span>}
            </div>
            <button
              className="backlog-card__action"
              onClick={(e) => {
                e.stopPropagation()
                onAddToQueue(task)
              }}
            >
              → Add to queue
            </button>
          </div>
        ))}
        {backlog.length === 0 && (
          <div style={{ fontSize: '10px', color: 'var(--neon-text-dim)', padding: '8px 0' }}>
            No backlog tasks
          </div>
        )}
      </div>
      {failed.length > 0 && (
        <div className="pipeline-sidebar__section">
          <div className="pipeline-sidebar__label" style={{ color: 'var(--neon-red)' }}>
            FAILED <span className="pipeline-sidebar__count">{failed.length}</span>
          </div>
          {failed.map((task) => (
            <div key={task.id} className="failed-card" onClick={() => onTaskClick(task.id)}>
              <div className="failed-card__title">{task.title}</div>
              <div className="failed-card__meta">
                {task.notes ? task.notes.slice(0, 40) : 'No details'}
              </div>
              <button
                className="backlog-card__action"
                onClick={(e) => {
                  e.stopPropagation()
                  onRerun(task)
                }}
                style={{ color: 'var(--neon-red)' }}
              >
                ↻ Re-run
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add src/renderer/src/components/sprint/PipelineBacklog.tsx src/renderer/src/components/sprint/__tests__/PipelineBacklog.test.tsx
git commit -m "feat(sprint): add PipelineBacklog sidebar component"
```

---

### Task 6: Create TaskDetailDrawer component

**Files:**

- Create: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`

- [ ] **Step 1: Write failing tests**

Test: renders task title, shows prompt in monospace block, shows "View Spec →" link, shows correct action buttons per status (queued → Launch/Edit/Delete, active → View Logs/Edit/Stop, etc.), calls action callbacks.

- [ ] **Step 2: Implement TaskDetailDrawer**

Key sections:

- **Header**: title + status dot + elapsed time
- **Metadata fields**: repo, priority, dependencies, timestamps
- **Prompt block**: `<div className="task-drawer__prompt">{task.task}</div>` — shows `SprintTask.task` (the instruction string)
- **Spec link**: `<button className="task-drawer__spec-link">View Spec →</button>` — opens spec panel
- **Agent link**: if `agent_run_id`, show "Running — View in Agents →"
- **PR section**: if `pr_url`, show PR number + status
- **Actions bar**: context-aware buttons at bottom

The drawer receives callbacks for all actions (launch, stop, markDone, rerun, delete, openSpec, viewLogs) and the task object. **Important:** All action callbacks must come from `useSprintTaskActions()` hook (same as SprintCenter) — do NOT call store mutations directly. `launchTask` specifically spawns via IPC (`window.api.spawnLocalAgent`), not a direct status write. Reference `SprintCenter.tsx` lines 61-69 for the hook usage pattern.

- [ ] **Step 3: Run tests, commit**

```bash
git add src/renderer/src/components/sprint/TaskDetailDrawer.tsx src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx
git commit -m "feat(sprint): add TaskDetailDrawer component"
```

---

### Task 7: Create SpecPanel overlay component

**Files:**

- Create: `src/renderer/src/components/sprint/SpecPanel.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/SpecPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Test: renders spec content, closes on backdrop click, closes on X button, shows edit/save mode, calls onSave callback.

- [ ] **Step 2: Implement SpecPanel**

Wide overlay panel (600px) that slides in from right. Shows:

- Header with task title + close button
- Body with markdown-rendered spec content (reuse existing `renderContent` from `chat-markdown.ts` if suitable, or plain `<pre>` with `white-space: pre-wrap`)
- Edit mode: textarea replaces rendered view, Save/Cancel buttons
- Backdrop overlay (click to close)

Uses `AnimatePresence` + `motion.div` for slide-in animation.

- [ ] **Step 3: Run tests, commit**

```bash
git add src/renderer/src/components/sprint/SpecPanel.tsx src/renderer/src/components/sprint/__tests__/SpecPanel.test.tsx
git commit -m "feat(sprint): add SpecPanel overlay component"
```

---

### Task 8: Create DoneHistoryPanel modal

**Files:**

- Create: `src/renderer/src/components/sprint/DoneHistoryPanel.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/DoneHistoryPanel.test.tsx`

- [ ] **Step 1: Write tests, implement, commit**

Simple modal showing all completed tasks (full `done` partition, sorted by `completed_at` desc). Each row shows title, repo, completed time. Click selects task and opens detail drawer. Close button and backdrop close.

```bash
git add src/renderer/src/components/sprint/DoneHistoryPanel.tsx src/renderer/src/components/sprint/__tests__/DoneHistoryPanel.test.tsx
git commit -m "feat(sprint): add DoneHistoryPanel modal"
```

---

### Task 9: Create SprintPipeline shell and wire everything together

**Files:**

- Create: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx`

This is the main orchestrator component. It replaces `SprintCenter` as the primary Sprint view.

- [ ] **Step 1: Write failing tests**

Test: renders pipeline header with stats, renders 5 pipeline stages, renders backlog sidebar, renders detail drawer when task selected, shows spec panel when opened, shows done history when opened.

- [ ] **Step 2: Implement SprintPipeline**

The shell component:

- Imports CSS: `import '../../assets/sprint-pipeline-neon.css'`
- Uses same hooks as SprintCenter: `useSprintPolling`, `usePrStatusPolling`, `useSprintTaskActions`, `useSprintEvents`, `useTaskToasts`, `useSprintKeyboardShortcuts`, `useHealthCheck`
- Wraps pipeline stages in `<LayoutGroup>` from framer-motion for cross-stage `layoutId` animations
- Partitions tasks via `partitionSprintTasks()`
- Maps partitions to pipeline stages:
  - Queued = `partition.todo`, count = `${n} tasks`
  - Blocked = `partition.blocked`, count = `${n} task(s)`
  - Active = `partition.inProgress`, count = `${n} of 5` (WIP limit)
  - Review = `partition.awaitingReview`, count = `${n} task(s)`
  - Done = `partition.done.slice(0, 5)`, count = `${shown} of ${total}`
- Renders three zones: `PipelineBacklog` | pipeline stages | `TaskDetailDrawer` (conditional)
- Task selection: `useSprintUI` store's `selectedTaskId` + `setSelectedTaskId`
- Drawer: `useSprintUI` store's `drawerOpen`
- Spec panel: `useSprintUI` store's `specPanelOpen`
- Done history: `useSprintUI` store's `doneViewOpen`
- "Add to queue" callback: `updateTask(task.id, { status: 'queued' })`
- Header: stats computed from partition counts

**Key wiring** (copy patterns from SprintCenter lines 36-120):

- `initTaskOutputListener` effect
- `useTaskToasts` hook
- `useSprintPolling` + `usePrStatusPolling` hooks
- Auto-select first active/queued task on load
- `ConfirmModal` for status transitions

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/sprint/__tests__/SprintPipeline.test.tsx
git commit -m "feat(sprint): add SprintPipeline shell with full wiring"
```

---

### Task 10: Swap SprintView to use SprintPipeline

**Files:**

- Modify: `src/renderer/src/views/SprintView.tsx`

- [ ] **Step 1: Update SprintView import**

Change `SprintView.tsx` to import and render `SprintPipeline` instead of `SprintCenter`:

```tsx
import { SprintPipeline } from '../components/sprint/SprintPipeline'

export default function SprintView() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      style={{ height: '100%' }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <SprintPipeline />
    </motion.div>
  )
}
```

Do NOT delete SprintCenter or any old components — they remain as reference.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (old SprintCenter tests still pass since the component is not deleted)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/SprintView.tsx
git commit -m "feat(sprint): swap SprintView to render SprintPipeline"
```

---

### Task 11: Verify typecheck, coverage, and visual review

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 2: Run coverage**

Run: `npm run test:coverage`

- [ ] **Step 3: Visual verification**

Run: `npm run dev`
Navigate to Sprint view. Verify:

- Three-zone layout renders (backlog | pipeline | drawer)
- Pipeline shows 5 stages with connector line
- Task pills show in correct stages
- Clicking a pill opens the detail drawer
- Drawer shows prompt in monospace, "View Spec →" opens spec panel
- Active tasks show elapsed time and purple styling
- Done stage shows last 5 tasks with "View all →"
- Backlog cards show "→ Add to queue" on hover
- Stage transitions animate smoothly (change a task status to test)
- Reduced motion: disable animations

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(sprint): visual adjustments from pipeline review"
```

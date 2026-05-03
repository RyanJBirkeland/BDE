# UX Nits Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three UX fixes: quality score rubric tooltip in Code Review, split the `awaitingReview` partition into separate `pendingReview`/`openPrs` buckets, and add a manual drain-loop trigger button to the pipeline header.

**Architecture:** Task 1 is a one-line renderer change. Task 2 is a data-model rename (`awaitingReview` → `pendingReview` + `openPrs`) in `partitionSprintTasks.ts` that cascades to the filter hook, pipeline, and dashboard consumers — all mechanical replacements. Task 3 adds a new IPC channel (`agent-manager:triggerDrain`) wired from the agent manager through the preload bridge to a button in the pipeline header.

**Tech Stack:** React, TypeScript, Vitest, @testing-library/react, Electron IPC (`ipcMain.handle` via `safeHandle`), existing CSS design tokens.

---

## File Map

| File | Task | Change |
|---|---|---|
| `src/renderer/src/components/code-review/ReviewMetricsRow.tsx` | 1 | Add `title` to quality MetricCard |
| `src/renderer/src/lib/partitionSprintTasks.ts` | 2 | Replace `awaitingReview` with `pendingReview` + `openPrs` |
| `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts` | 2 | Update all references |
| `src/renderer/src/stores/sprintFilters.ts` | 2 | Add `'review'` + `'open-prs'` to StatusFilter; remove `'awaiting-review'` |
| `src/renderer/src/hooks/useFilteredTasks.ts` | 2 | Update switch cases |
| `src/renderer/src/components/sprint/SprintPipeline.tsx` | 2 | Two chips + two stages |
| `src/renderer/src/components/sprint/PipelineHeader.tsx` | 2 + 3 | Update filter type union; add ↻ button |
| `src/renderer/src/components/sprint/PipelineHeader.css` | 3 | Add trigger button styles |
| `src/renderer/src/components/dashboard/CenterColumn.tsx` | 2 | Update STAGE_TO_FILTER + partitions prop type |
| `src/renderer/src/hooks/useSprintPipelineCommands.ts` | 2 | Update `setStatusFilter('awaiting-review')` reference |
| `src/shared/ipc-channels/agent-channels.ts` | 3 | Add `agent-manager:triggerDrain` channel |
| `src/main/agent-manager/index.ts` | 3 | Add `triggerDrain()` to interface + impl |
| `src/main/handlers/agent-manager-handlers.ts` | 3 | Add handler |
| `src/preload/api-agents.ts` | 3 | Expose `agentManager.triggerDrain()` |

---

### Task 1: Quality score rubric tooltip

**Files:**
- Modify: `src/renderer/src/components/code-review/ReviewMetricsRow.tsx`

- [ ] **Step 1: Write the failing test**

Find the existing `ReviewMetricsRow` test file — it's in `src/renderer/src/components/code-review/__tests__/` or adjacent. If it doesn't exist, create it. Add:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewMetricsRow } from '../ReviewMetricsRow'

describe('ReviewMetricsRow quality score rubric', () => {
  it('shows threshold guidance in the quality card title for a low score', () => {
    render(<ReviewMetricsRow qualityScore={42} issuesCount={3} filesCount={5} />)
    const qualityCard = screen.getByRole('status', { name: /quality score 42/i })
    expect(qualityCard.getAttribute('title')).toContain('Significant issues')
  })

  it('shows threshold guidance in the quality card title for a high score', () => {
    render(<ReviewMetricsRow qualityScore={82} issuesCount={0} filesCount={2} />)
    const qualityCard = screen.getByRole('status', { name: /quality score 82/i })
    expect(qualityCard.getAttribute('title')).toContain('Good quality')
  })

  it('shows no title when qualityScore is undefined', () => {
    render(<ReviewMetricsRow issuesCount={0} filesCount={2} />)
    const qualityCard = screen.getByRole('status', { name: /quality score pending/i })
    expect(qualityCard.getAttribute('title')).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run to confirm the test fails**

```bash
npm test -- --run src/renderer/src/components/code-review/__tests__/ReviewMetricsRow.test.tsx 2>/dev/null || npm test -- --run --reporter=verbose 2>&1 | grep -A3 "ReviewMetricsRow quality"
```

Expected: tests fail — no `title` attribute on the quality card.

- [ ] **Step 3: Add the rubric title to `ReviewMetricsRow.tsx`**

In `src/renderer/src/components/code-review/ReviewMetricsRow.tsx`, add a helper above the component:

```typescript
function qualityScoreTitle(score: number): string {
  if (score < 50) return '0–49: Significant issues — recommend requesting revision'
  if (score < 75) return '50–74: Minor issues — review carefully before merging'
  return '75–100: Good quality — generally safe to merge'
}
```

Then find the quality `MetricCard` call (the one with `label="Quality"`) and add a `title` prop:

```typescript
      <MetricCard
        icon={<CheckCircle2 size={16} />}
        value={loading || qualityScore === undefined ? '—' : qualityScore}
        label="Quality"
        ariaLabel={
          qualityScore !== undefined
            ? `Quality score ${qualityScore} out of 100`
            : 'Quality score pending'
        }
        title={qualityScore !== undefined ? qualityScoreTitle(qualityScore) : undefined}
        variant="success"
      />
```

Then add `title?: string | undefined` to the `MetricCard` props interface and forward it to the outer `<div>`:

```typescript
function MetricCard({
  icon,
  value,
  label,
  ariaLabel,
  variant,
  title
}: {
  icon: ReactNode
  value: number | string
  label: string
  ariaLabel: string
  variant: 'success' | 'warning' | 'info'
  title?: string | undefined
}): JSX.Element {
  return (
    <div
      className={`cr-metric cr-metric--${variant}`}
      role="status"
      aria-label={ariaLabel}
      title={title}
    >
      <div className="cr-metric__icon">{icon}</div>
      <div className="cr-metric__value">{value}</div>
      <div className="cr-metric__label">{label}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --run src/renderer/src/components/code-review/__tests__/ReviewMetricsRow.test.tsx 2>/dev/null || npm test -- --run 2>&1 | grep -E "ReviewMetricsRow|PASS|FAIL" | head -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/code-review/ReviewMetricsRow.tsx
git commit -m "feat(code-review): add quality score rubric tooltip"
```

---

### Task 2: Split `awaitingReview` into `pendingReview` + `openPrs`

**Files:**
- Modify: `src/renderer/src/lib/partitionSprintTasks.ts`
- Modify: `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`
- Modify: `src/renderer/src/stores/sprintFilters.ts`
- Modify: `src/renderer/src/hooks/useFilteredTasks.ts`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineHeader.tsx`
- Modify: `src/renderer/src/components/dashboard/CenterColumn.tsx`
- Modify: `src/renderer/src/hooks/useSprintPipelineCommands.ts`

**Context:** `awaitingReview` currently merges `status:'review'` tasks (agent done → Code Review Station) with `active + pr_status:'open'` tasks (open GitHub PRs). These need separate buckets so users can distinguish them.

- [ ] **Step 1: Update `partitionSprintTasks.ts`**

Replace the `SprintPartition` interface and function in `src/renderer/src/lib/partitionSprintTasks.ts`:

```typescript
export interface SprintPartition {
  backlog: SprintTask[]
  todo: SprintTask[]
  blocked: SprintTask[]
  inProgress: SprintTask[]
  /** Tasks with status 'review' — agent done, awaiting human action in Code Review Station. */
  pendingReview: SprintTask[]
  /** Tasks with status 'active' and pr_status 'open'|'branch_only' — open GitHub PRs. */
  openPrs: SprintTask[]
  done: SprintTask[]
  failed: SprintTask[]
}

/**
 * Partition sprint tasks into 8 mutually exclusive buckets.
 * Every task lands in exactly one bucket — no overlap.
 *
 * Status mapping:
 *   backlog                               → backlog
 *   queued                                → todo
 *   blocked                               → blocked
 *   active                                → inProgress
 *   active + pr_status=open|branch_only   → openPrs (open GitHub PR)
 *   review                                → pendingReview (agent done, needs Code Review)
 *   done + pr_status=merged|closed|null   → done
 *   cancelled/failed/error                → failed
 */
export function partitionSprintTasks(tasks: SprintTask[]): SprintPartition {
  const backlog: SprintTask[] = []
  const todo: SprintTask[] = []
  const blocked: SprintTask[] = []
  const inProgress: SprintTask[] = []
  const pendingReview: SprintTask[] = []
  const openPrs: SprintTask[] = []
  const done: SprintTask[] = []
  const failed: SprintTask[] = []

  for (const task of tasks) {
    // active tasks with an open PR go to openPrs, not inProgress
    if (
      task.status === 'active' &&
      (task.pr_status === PR_STATUS.OPEN || task.pr_status === PR_STATUS.BRANCH_ONLY)
    ) {
      openPrs.push(task)
      continue
    }

    const bucketKey = STATUS_METADATA[task.status].bucketKey
    switch (bucketKey) {
      case 'backlog':
        backlog.push(task)
        break
      case 'todo':
        todo.push(task)
        break
      case 'blocked':
        blocked.push(task)
        break
      case 'inProgress':
        inProgress.push(task)
        break
      case 'awaitingReview':
        pendingReview.push(task)
        break
      case 'done':
        done.push(task)
        break
      case 'failed':
        failed.push(task)
        break
    }
  }

  done.sort((a, b) => {
    const ta = a.completed_at ?? a.updated_at ?? ''
    const tb = b.completed_at ?? b.updated_at ?? ''
    return tb.localeCompare(ta)
  })

  return { backlog, todo, blocked, inProgress, pendingReview, openPrs, done, failed }
}
```

- [ ] **Step 2: Run partition tests to see failures**

```bash
npm test -- --run src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts
```

Expected: many failures — tests still reference `awaitingReview`.

- [ ] **Step 3: Update `partitionSprintTasks.test.ts`**

Replace every `awaitingReview` reference in the test file with either `pendingReview` (for `status:'review'` tasks) or `openPrs` (for `active + pr_status:'open'` tasks).

Key changes:
- The "returns empty arrays" test: replace `awaitingReview: []` with `pendingReview: [], openPrs: []`
- Tests that check `result.awaitingReview` for `active + pr_status:'open'` tasks → change to `result.openPrs`
- Tests that check `result.awaitingReview` for `status:'review'` tasks → change to `result.pendingReview`
- The "every task lands in exactly one bucket" test: spread `result.pendingReview` and `result.openPrs` instead of `result.awaitingReview`
- The mixed-set test: update `awaitingReview: 0` to `pendingReview: 0, openPrs: 0`

Here is the full updated test file:

```typescript
import { describe, it, expect } from 'vitest'
import { partitionSprintTasks } from '../partitionSprintTasks'
import { TASK_STATUS, PR_STATUS } from '../../../../shared/constants'
import type { SprintTask } from '../../../../shared/types'
import { nowIso } from '../../../../shared/time'

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    repo: 'FLEET',
    prompt: null,
    priority: 1,
    status: 'backlog',
    notes: null,
    spec: null,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    retry_count: 0,
    fast_fail_count: 0,
    template_name: null,
    depends_on: null,
    updated_at: nowIso(),
    created_at: nowIso(),
    ...overrides
  }
}

describe('partitionSprintTasks', () => {
  it('returns empty arrays when given no tasks', () => {
    const result = partitionSprintTasks([])
    expect(result).toEqual({
      backlog: [],
      todo: [],
      blocked: [],
      inProgress: [],
      pendingReview: [],
      openPrs: [],
      done: [],
      failed: []
    })
  })

  it('puts backlog tasks in backlog', () => {
    const t = makeTask({ status: 'backlog' })
    const result = partitionSprintTasks([t])
    expect(result.backlog).toEqual([t])
    expect(result.todo).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
    expect(result.inProgress).toHaveLength(0)
    expect(result.pendingReview).toHaveLength(0)
    expect(result.openPrs).toHaveLength(0)
    expect(result.done).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it('puts queued tasks in todo', () => {
    const t = makeTask({ status: 'queued' })
    const result = partitionSprintTasks([t])
    expect(result.todo).toEqual([t])
  })

  it('puts active tasks in inProgress', () => {
    const t = makeTask({ status: 'active' })
    const result = partitionSprintTasks([t])
    expect(result.inProgress).toEqual([t])
  })

  it('puts done tasks with pr_status=open in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'open', pr_url: 'https://github.com/pr/1' })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
    expect(result.pendingReview).toHaveLength(0)
    expect(result.openPrs).toHaveLength(0)
  })

  it('puts done tasks with pr_status=merged in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'merged' })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
    expect(result.pendingReview).toHaveLength(0)
    expect(result.openPrs).toHaveLength(0)
  })

  it('puts done tasks with pr_status=closed in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'closed' })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
  })

  it('puts done tasks with pr_status=null in done', () => {
    const t = makeTask({ status: 'done', pr_status: null })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
  })

  it('puts done tasks with pr_status=draft in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'draft' })
    const result = partitionSprintTasks([t])
    expect(result.done).toEqual([t])
  })

  it('routes active task with pr_status=branch_only to openPrs', () => {
    const t = makeTask({ status: 'active', pr_status: 'branch_only' })
    const result = partitionSprintTasks([t])
    expect(result.openPrs).toHaveLength(1)
    expect(result.inProgress).toHaveLength(0)
    expect(result.pendingReview).toHaveLength(0)
  })

  it('puts done task with pr_status=branch_only in done', () => {
    const t = makeTask({ status: 'done', pr_status: 'branch_only' })
    const result = partitionSprintTasks([t])
    expect(result.done).toHaveLength(1)
    expect(result.openPrs).toHaveLength(0)
  })

  it('puts blocked tasks into blocked bucket', () => {
    const tasks = [makeTask({ status: 'blocked' })]
    const result = partitionSprintTasks(tasks)
    expect(result.blocked).toHaveLength(1)
    expect(result.todo).toHaveLength(0)
  })

  it('puts cancelled tasks in failed', () => {
    const t = makeTask({ status: TASK_STATUS.CANCELLED })
    const result = partitionSprintTasks([t])
    expect(result.failed).toEqual([t])
    expect(result.done).toHaveLength(0)
  })

  it('puts failed tasks in failed bucket', () => {
    const t = makeTask({ status: TASK_STATUS.FAILED })
    const result = partitionSprintTasks([t])
    expect(result.failed).toEqual([t])
  })

  it('puts error tasks in failed bucket', () => {
    const t = makeTask({ status: TASK_STATUS.ERROR })
    const result = partitionSprintTasks([t])
    expect(result.failed).toEqual([t])
  })

  it('routes active task with pr_status=open to openPrs', () => {
    const t = makeTask({ status: TASK_STATUS.ACTIVE, pr_status: PR_STATUS.OPEN })
    const result = partitionSprintTasks([t])
    expect(result.openPrs).toEqual([t])
    expect(result.inProgress).toHaveLength(0)
    expect(result.pendingReview).toHaveLength(0)
  })

  it('routes review status task to pendingReview', () => {
    const t = makeTask({ status: 'review' })
    const result = partitionSprintTasks([t])
    expect(result.pendingReview).toEqual([t])
    expect(result.openPrs).toHaveLength(0)
  })

  it('correctly partitions a mixed set of tasks', () => {
    const tasks = [
      makeTask({ title: 'B1', status: 'backlog' }),
      makeTask({ title: 'B2', status: 'backlog' }),
      makeTask({ title: 'Q1', status: 'queued' }),
      makeTask({ title: 'A1', status: 'active' }),
      makeTask({ title: 'A2', status: 'active' }),
      makeTask({ title: 'D1', status: 'done', pr_status: 'merged' }),
      makeTask({ title: 'D2', status: 'done', pr_status: null }),
      makeTask({ title: 'R1', status: 'done', pr_status: 'open' }),
      makeTask({ title: 'R2', status: 'done', pr_status: 'open' }),
      makeTask({ title: 'C1', status: 'cancelled' })
    ]

    const result = partitionSprintTasks(tasks)
    expect(result.backlog).toHaveLength(2)
    expect(result.todo).toHaveLength(1)
    expect(result.inProgress).toHaveLength(2)
    expect(result.done).toHaveLength(4)
    expect(result.pendingReview).toHaveLength(0)
    expect(result.openPrs).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
  })

  it('sorts done tasks by completed_at descending (most recent first)', () => {
    const tasks = [
      makeTask({ status: 'done', pr_status: 'merged', completed_at: '2026-03-20T00:00:00Z' }),
      makeTask({ status: 'done', pr_status: 'merged', completed_at: '2026-03-28T00:00:00Z' }),
      makeTask({ status: 'done', pr_status: 'merged', completed_at: '2026-03-24T00:00:00Z' })
    ]
    const result = partitionSprintTasks(tasks)
    expect(result.done.map((t) => t.completed_at)).toEqual([
      '2026-03-28T00:00:00Z',
      '2026-03-24T00:00:00Z',
      '2026-03-20T00:00:00Z'
    ])
  })

  it('every task lands in exactly one bucket (no duplicates)', () => {
    const tasks = [
      makeTask({ status: 'backlog' }),
      makeTask({ status: 'queued' }),
      makeTask({ status: 'active' }),
      makeTask({ status: 'review' }),
      makeTask({ status: 'active', pr_status: 'open' }),
      makeTask({ status: 'done', pr_status: 'merged' }),
      makeTask({ status: 'cancelled' })
    ]

    const result = partitionSprintTasks(tasks)
    const allPartitioned = [
      ...result.backlog,
      ...result.todo,
      ...result.blocked,
      ...result.inProgress,
      ...result.pendingReview,
      ...result.openPrs,
      ...result.done,
      ...result.failed
    ]

    expect(allPartitioned).toHaveLength(tasks.length)
    const ids = allPartitioned.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 4: Run partition tests to confirm they pass**

```bash
npm test -- --run src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Update `sprintFilters.ts`**

In `src/renderer/src/stores/sprintFilters.ts`, replace the `StatusFilter` type:

```typescript
export type StatusFilter =
  | 'all'
  | 'backlog'
  | 'todo'
  | 'blocked'
  | 'in-progress'
  | 'review'
  | 'open-prs'
  | 'done'
  | 'failed'
```

(Remove `'awaiting-review'`; add `'review'` and `'open-prs'`.)

- [ ] **Step 6: Update `useFilteredTasks.ts`**

In `src/renderer/src/hooks/useFilteredTasks.ts`, replace all `awaitingReview` references in the `filteredPartition` useMemo with `pendingReview: emptyBucket, openPrs: emptyBucket`. Then replace the `case 'awaiting-review':` branch with two new cases.

The full updated switch inside `filteredPartition`:

```typescript
  const filteredPartition = useMemo(() => {
    if (statusFilter === 'all') return partition

    const emptyBucket: SprintTask[] = []
    switch (statusFilter) {
      case 'backlog':
        return {
          ...partition,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          pendingReview: emptyBucket,
          openPrs: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'todo':
        return {
          ...partition,
          backlog: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          pendingReview: emptyBucket,
          openPrs: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'blocked':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          inProgress: emptyBucket,
          pendingReview: emptyBucket,
          openPrs: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'in-progress':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          pendingReview: emptyBucket,
          openPrs: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'review':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          openPrs: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'open-prs':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          pendingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'done':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          pendingReview: emptyBucket,
          openPrs: emptyBucket,
          failed: emptyBucket
        }
      case 'failed':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          pendingReview: emptyBucket,
          openPrs: emptyBucket,
          done: emptyBucket
        }
      default:
        return partition
    }
  }, [partition, statusFilter])
```

- [ ] **Step 7: Update `SprintPipeline.tsx`**

Find the `stats` useMemo (currently has a `review`/`awaiting-review` entry). Replace the single review chip entry with two:

```typescript
      { label: 'active', count: partition.inProgress.length, filter: 'in-progress' as const },
      { label: 'queued', count: partition.todo.length, filter: 'todo' as const },
      { label: 'blocked', count: partition.blocked.length, filter: 'blocked' as const },
      { label: 'review', count: partition.pendingReview.length, filter: 'review' as const },
      { label: 'PRs', count: partition.openPrs.length, filter: 'open-prs' as const },
      { label: 'failed', count: partition.failed.length, filter: 'failed' as const },
      { label: 'done', count: partition.done.length, filter: 'done' as const }
```

Find the single `<PipelineStage>` that renders `filteredPartition.awaitingReview`. Replace with two stages:

```typescript
              <PipelineStage
                name="review"
                label="Review"
                tasks={filteredPartition.pendingReview}
                count={`${filteredPartition.pendingReview.length}`}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="open-prs"
                label="PRs"
                tasks={filteredPartition.openPrs}
                count={`${filteredPartition.openPrs.length}`}
                onTaskClick={handleTaskClick}
              />
```

(Keep all other existing props on the stages intact — copy `pipelineDensity`, `selectedTaskId`, etc. from the surrounding stages.)

- [ ] **Step 8: Update `PipelineHeader.tsx` filter type**

In `src/renderer/src/components/sprint/PipelineHeader.tsx`, update the `StatBadge` filter type:

```typescript
interface StatBadge {
  label: string
  count: number
  filter: 'in-progress' | 'todo' | 'blocked' | 'review' | 'open-prs' | 'failed' | 'done'
}
```

(Replace `'awaiting-review'` with `'review' | 'open-prs'`.)

- [ ] **Step 9: Update `CenterColumn.tsx` (Dashboard)**

In `src/renderer/src/components/dashboard/CenterColumn.tsx`:

Change `STAGE_TO_FILTER`:
```typescript
const STAGE_TO_FILTER: Record<SankeyStageKey, StatusFilter> = {
  queued: 'todo',
  active: 'in-progress',
  review: 'review',
  done: 'done',
  blocked: 'blocked',
  failed: 'failed'
}
```

Update the `partitions` prop type — replace `awaitingReview` with `pendingReview`:
```typescript
  partitions: {
    todo: unknown[]
    inProgress: unknown[]
    pendingReview: unknown[]
    done: unknown[]
    blocked: unknown[]
    failed: unknown[]
  }
```

Update the `review` count in the component body — find `partitions.awaitingReview.length` and change to `partitions.pendingReview.length`.

- [ ] **Step 10: Update `useSprintPipelineCommands.ts`**

In `src/renderer/src/hooks/useSprintPipelineCommands.ts`, find line 117:
```typescript
action: () => setStatusFilter('awaiting-review')
```
Change to:
```typescript
action: () => setStatusFilter('review')
```

- [ ] **Step 11: Run the full renderer test suite**

```bash
npm test -- --run
```

Expected: all tests pass. Typecheck:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 12: Check how `CenterColumn` is called from the Dashboard**

```bash
grep -n "awaitingReview\|pendingReview" src/renderer/src/views/DashboardView.tsx | head -10
```

If `DashboardView.tsx` passes `awaitingReview` to `CenterColumn`, update it to pass `pendingReview` instead.

- [ ] **Step 13: Commit**

```bash
git add \
  src/renderer/src/lib/partitionSprintTasks.ts \
  src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts \
  src/renderer/src/stores/sprintFilters.ts \
  src/renderer/src/hooks/useFilteredTasks.ts \
  src/renderer/src/components/sprint/SprintPipeline.tsx \
  src/renderer/src/components/sprint/PipelineHeader.tsx \
  src/renderer/src/components/dashboard/CenterColumn.tsx \
  src/renderer/src/hooks/useSprintPipelineCommands.ts
git commit -m "feat(sprint): split awaitingReview into pendingReview and openPrs buckets"
```

---

### Task 3: Drain loop "Check now" button

**Files:**
- Modify: `src/shared/ipc-channels/agent-channels.ts`
- Modify: `src/main/agent-manager/index.ts`
- Modify: `src/main/handlers/agent-manager-handlers.ts`
- Modify: `src/preload/api-agents.ts`
- Modify: `src/renderer/src/components/sprint/PipelineHeader.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineHeader.css`

- [ ] **Step 1: Add the IPC channel type**

In `src/shared/ipc-channels/agent-channels.ts`, add after the `'agent-manager:checkpoint'` entry:

```typescript
  'agent-manager:triggerDrain': {
    args: []
    result: void
  }
```

- [ ] **Step 2: Add `triggerDrain()` to the `AgentManager` interface and implementation**

In `src/main/agent-manager/index.ts`:

Add to the `AgentManager` interface (after `reloadConfig`):

```typescript
  /** Immediately runs one drain tick. Used by the "Check now" pipeline button. */
  triggerDrain(): void
```

Add to `AgentManagerImpl` class (after `reloadConfig` implementation):

```typescript
  triggerDrain(): void {
    this.tickDrain()
  }
```

- [ ] **Step 3: Add the IPC handler**

In `src/main/handlers/agent-manager-handlers.ts`, add after the `agent-manager:reloadConfig` handler:

```typescript
  safeHandle('agent-manager:triggerDrain', async () => {
    am?.triggerDrain()
  })
```

- [ ] **Step 4: Write the handler test**

In `src/main/handlers/__tests__/agent-manager-handlers.test.ts`, add one assertion in the existing test that checks `safeHandle` registrations:

```typescript
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:triggerDrain', expect.any(Function))
```

Run:
```bash
npm test -- --run src/main/handlers/__tests__/agent-manager-handlers.test.ts
```

Expected: passes.

- [ ] **Step 5: Expose on the preload bridge**

In `src/preload/api-agents.ts`, add to the `agentManager` object (after `reloadConfig`):

```typescript
  triggerDrain: (): Promise<void> =>
    typedInvoke('agent-manager:triggerDrain'),
```

- [ ] **Step 6: Write the failing UI test**

In `src/renderer/src/components/sprint/__tests__/PipelineHeader.test.tsx` (or create it), add:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PipelineHeader } from '../PipelineHeader'

describe('PipelineHeader drain trigger', () => {
  beforeEach(() => {
    vi.mocked(window.api.agentManager.status).mockResolvedValue({
      running: false,
      shuttingDown: false,
      concurrency: { maxSlots: 2, capacityAfterBackpressure: 2, activeCount: 0, recoveryScheduledAt: null, consecutiveRateLimits: 0, atMinimumCapacity: false },
      activeAgents: []
    })
    vi.mocked(window.api.agentManager.triggerDrain).mockResolvedValue(undefined)
  })

  it('renders a check-now trigger button', () => {
    render(
      <PipelineHeader
        stats={[]}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument()
  })

  it('calls triggerDrain when check-now button is clicked', async () => {
    render(
      <PipelineHeader
        stats={[]}
        conflictingTasks={[]}
        visibleStuckTasks={[]}
        onFilterClick={vi.fn()}
        onConflictClick={vi.fn()}
        onHealthCheckClick={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /check now/i }))
    expect(window.api.agentManager.triggerDrain).toHaveBeenCalledOnce()
  })
})
```

Run:
```bash
npm test -- --run src/renderer/src/components/sprint/__tests__/PipelineHeader.test.tsx
```

Expected: fails — button not found.

- [ ] **Step 7: Add the ↻ button to `PipelineHeader.tsx`**

Add `RefreshCw` to the lucide-react import at the top of `PipelineHeader.tsx`:
```typescript
import { GitMerge, HeartPulse, LayoutGrid, List, Network, Download, RefreshCw } from 'lucide-react'
```

Add state for the spin animation:
```typescript
  const [triggering, setTriggering] = useState(false)
```

Add the handler inside the component:
```typescript
  const handleTriggerDrain = useCallback(async (): Promise<void> => {
    setTriggering(true)
    try {
      await window.api.agentManager.triggerDrain()
    } finally {
      setTimeout(() => setTriggering(false), 1500)
    }
  }, [])
```

Add the button in the JSX, after the existing `<h1>` and before `<div className="sprint-pipeline__stats">`:

```typescript
      <button
        className={`sprint-pipeline__badge pipeline-header__trigger-btn${triggering ? ' pipeline-header__trigger-btn--spinning' : ''}`}
        onClick={handleTriggerDrain}
        disabled={triggering}
        title="Trigger drain loop now — check for queued tasks immediately"
        aria-label="Check now"
      >
        <RefreshCw size={12} />
      </button>
```

- [ ] **Step 8: Add CSS to `PipelineHeader.css`**

Append to `src/renderer/src/components/sprint/PipelineHeader.css`:

```css
/* Drain trigger button */
.pipeline-header__trigger-btn {
  transition: opacity 150ms ease;
}

.pipeline-header__trigger-btn--spinning svg {
  animation: pipeline-header-spin 0.8s linear infinite;
}

@keyframes pipeline-header-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
```

- [ ] **Step 9: Run all tests and typecheck**

```bash
npm test -- --run src/renderer/src/components/sprint/__tests__/PipelineHeader.test.tsx
npm run typecheck
```

Expected: all pass, zero type errors.

- [ ] **Step 10: Run full suite**

```bash
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add \
  src/shared/ipc-channels/agent-channels.ts \
  src/main/agent-manager/index.ts \
  src/main/handlers/agent-manager-handlers.ts \
  src/main/handlers/__tests__/agent-manager-handlers.test.ts \
  src/preload/api-agents.ts \
  src/renderer/src/components/sprint/PipelineHeader.tsx \
  src/renderer/src/components/sprint/PipelineHeader.css \
  src/renderer/src/components/sprint/__tests__/PipelineHeader.test.tsx
git commit -m "feat(sprint): add drain-loop trigger button to pipeline header"
```

---

## Self-Review

**Spec coverage:**
- ✅ Fix 1: quality score rubric tooltip — `qualityScoreTitle()` helper + `title` prop on quality MetricCard (Task 1)
- ✅ Fix 2: `pendingReview` for `status:'review'` tasks (Task 2, Steps 1–13)
- ✅ Fix 2: `openPrs` for `active + pr_status:open|branch_only` (Task 2, Steps 1–13)
- ✅ Fix 2: `SprintPartition` interface updated (Task 2, Step 1)
- ✅ Fix 2: `StatusFilter` updated — `'review'` + `'open-prs'` replace `'awaiting-review'` (Task 2, Step 5)
- ✅ Fix 2: `useFilteredTasks` switch updated (Task 2, Step 6)
- ✅ Fix 2: two pipeline stages rendered (Task 2, Step 7)
- ✅ Fix 2: `PipelineHeader` filter type updated (Task 2, Step 8)
- ✅ Fix 2: Dashboard `CenterColumn` updated (Task 2, Step 9)
- ✅ Fix 2: `useSprintPipelineCommands` updated (Task 2, Step 10)
- ✅ Fix 3: `agent-manager:triggerDrain` IPC channel (Task 3, Step 1)
- ✅ Fix 3: `triggerDrain()` on `AgentManager` interface + `AgentManagerImpl` (Task 3, Step 2)
- ✅ Fix 3: handler in `agent-manager-handlers.ts` (Task 3, Step 3)
- ✅ Fix 3: preload bridge (Task 3, Step 5)
- ✅ Fix 3: ↻ button with spin animation (Task 3, Steps 7–8)

**Placeholder scan:** None found.

**Type consistency:** `SprintPartition` uses `pendingReview`/`openPrs` throughout all tasks. `StatusFilter` uses `'review'`/`'open-prs'` throughout. `triggerDrain(): void` consistent across interface, impl, handler, and preload.

# Task Pipeline UX Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 42 UX audit findings across the Task Pipeline — repairing broken features, adding operational UX for unattended monitoring, and aligning with the neon design system.

**Architecture:** Renderer-only changes for most tasks. One main-process change: `sprint:retry` IPC endpoint (Task 6). All CSS moves to `sprint-pipeline-neon.css`. Tests use vitest + React Testing Library.

**Tech Stack:** React, TypeScript, Zustand, Framer Motion, lucide-react, CSS custom properties, vitest

**Spec:** `docs/superpowers/specs/2026-04-02-task-pipeline-ux-audit-design.md`

---

## File Map

### New Files

| File                                                           | Responsibility               |
| -------------------------------------------------------------- | ---------------------------- |
| `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`  | Tests for partition logic    |
| `src/renderer/src/stores/__tests__/sprintTasks.test.ts`        | Tests for sprint tasks store |
| `src/renderer/src/components/sprint/PipelineFilterBar.tsx`     | Filter/search bar component  |
| `src/renderer/src/components/sprint/BulkActionBar.tsx`         | Multi-select bulk action bar |
| `src/renderer/src/components/sprint/PipelineErrorBoundary.tsx` | Error boundary for pipeline  |

### Modified Files

| File                                                       | Phase | Changes                                                                                             |
| ---------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sprint/SprintPipeline.tsx`    | 1,2,3 | Fix conflict filter, add header badges, filter bar, error boundary, entrance animation, empty state |
| `src/renderer/src/stores/sprintTasks.ts`                   | 1     | Fix createTask depends_on, fix SSE merge pending protection                                         |
| `src/renderer/src/stores/sprintUI.ts`                      | 1     | Add drawer toggle behavior                                                                          |
| `src/renderer/src/hooks/useSprintPolling.ts`               | 1     | Optimize selector                                                                                   |
| `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`     | 1,2   | Fix Escape, add arrow nav + action shortcuts                                                        |
| `src/renderer/src/hooks/useSprintTaskActions.ts`           | 1     | Remove dead DnD callbacks                                                                           |
| `src/renderer/src/components/sprint/TaskPill.tsx`          | 2,3   | Zombie indicator, failure badges, arrival animation, cost/duration, focus styles                    |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`  | 1,2,3 | Optimize re-renders, dependency chain, retry button, inline→CSS                                     |
| `src/renderer/src/components/sprint/PipelineStage.tsx`     | 2,3   | Review label, ARIA regions                                                                          |
| `src/renderer/src/components/sprint/PipelineBacklog.tsx`   | 3     | Inline→CSS                                                                                          |
| `src/renderer/src/components/sprint/SpecPanel.tsx`         | 2,3   | Markdown rendering, reduced motion, focus trap, inline→CSS                                          |
| `src/renderer/src/components/sprint/DoneHistoryPanel.tsx`  | 3     | Focus trap, ARIA list, inline→CSS                                                                   |
| `src/renderer/src/components/sprint/ConflictDrawer.tsx`    | 3     | ARIA expanded, neon token migration                                                                 |
| `src/renderer/src/components/sprint/HealthCheckDrawer.tsx` | 3     | Neon token migration                                                                                |
| `src/renderer/src/assets/sprint-pipeline-neon.css`         | 1,2,3 | All new CSS classes                                                                                 |
| `src/renderer/src/assets/sprint.css`                       | 3     | Remove legacy drawer styles                                                                         |
| `src/renderer/src/lib/partitionSprintTasks.ts`             | —     | (tested, not modified)                                                                              |
| `src/renderer/src/lib/task-format.ts`                      | 3     | Add review dot color                                                                                |
| `src/main/handlers/sprint-local.ts`                        | 2     | Add sprint:retry IPC handler                                                                        |
| `src/preload/index.ts`                                     | 2     | Add retry to preload bridge                                                                         |
| `src/preload/index.d.ts`                                   | 2     | Add retry type declaration                                                                          |
| `src/shared/ipc-channels.ts`                               | 2     | Add sprint:retry channel                                                                            |

---

## Phase 1: Fix What's Broken

### Task 1: Fix ConflictDrawer filter + add header badges (C1, C5)

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Fix the conflict filter to use actual DB statuses**

In `SprintPipeline.tsx`, find the `conflictingTasks` useMemo (around line 130-140). Replace:

```ts
;['awaiting-review', 'in-progress'].includes(t.status)
```

with:

```ts
t.status === 'active' || t.status === 'done'
```

- [ ] **Step 2: Add header indicator badges for ConflictDrawer and HealthCheckDrawer**

In the pipeline header (around line 203-215), add two icon badges after the stats:

```tsx
{
  conflictingTasks.length > 0 && (
    <button
      className="sprint-pipeline__badge sprint-pipeline__badge--danger"
      onClick={() => setConflictDrawerOpen(true)}
      title={`${conflictingTasks.length} PR conflict${conflictingTasks.length > 1 ? 's' : ''}`}
      aria-label={`${conflictingTasks.length} merge conflicts`}
    >
      <GitMerge size={12} />
      <span>{conflictingTasks.length}</span>
    </button>
  )
}
{
  stuckTasks.length > 0 && (
    <button
      className="sprint-pipeline__badge sprint-pipeline__badge--warning"
      onClick={() => setHealthCheckDrawerOpen(true)}
      title={`${stuckTasks.length} stuck task${stuckTasks.length > 1 ? 's' : ''}`}
      aria-label={`${stuckTasks.length} stuck tasks`}
    >
      <HeartPulse size={12} />
      <span>{stuckTasks.length}</span>
    </button>
  )
}
```

Add `GitMerge`, `HeartPulse` to lucide imports. Wire `stuckTasks` from the health check hook or compute inline (tasks active > 15min with no recent events).

- [ ] **Step 3: Add CSS for badges**

```css
.sprint-pipeline__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  font-family: var(--bde-font-code);
  border: 1px solid;
  background: transparent;
  cursor: pointer;
  transition: background 150ms ease;
}

.sprint-pipeline__badge--danger {
  color: var(--neon-red);
  border-color: var(--neon-red-border);
}

.sprint-pipeline__badge--danger:hover {
  background: var(--neon-red-surface);
}

.sprint-pipeline__badge--warning {
  color: var(--neon-orange);
  border-color: var(--neon-orange-border);
}

.sprint-pipeline__badge--warning:hover {
  background: var(--neon-orange-surface);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "fix: ConflictDrawer filter + header badges for conflict/health drawers (C1, C5)"
```

---

### Task 2: Fix createTask depends_on + SSE merge pending protection (C2, H10)

**Files:**

- Modify: `src/renderer/src/stores/sprintTasks.ts`

- [ ] **Step 1: Fix createTask to pass depends_on to IPC**

In `sprintTasks.ts`, find the `createTask` method. In the optimistic task object (around line 210), change:

```ts
depends_on: null,
```

to:

```ts
depends_on: data.depends_on ?? null,
```

In the `window.api.sprint.create()` call (around line 220-230), add `depends_on`:

```ts
const result = (await window.api.sprint.create({
  title: data.title,
  repo: repoEnum,
  prompt: data.prompt || data.title,
  notes: data.notes || undefined,
  spec: data.spec || undefined,
  priority: data.priority,
  status: TASK_STATUS.BACKLOG,
  template_name: data.template_name || undefined,
  playground_enabled: data.playground_enabled || undefined,
  depends_on: data.depends_on || undefined
})) as SprintTask
```

- [ ] **Step 2: Fix mergeSseUpdate to respect pending updates**

Find `mergeSseUpdate` (around line 326). Replace the implementation:

```ts
mergeSseUpdate: (update): void => {
  set((s) => ({
    tasks: s.tasks.map((t) => {
      if (t.id !== update.taskId) return t
      const merged = { ...t, ...update, depends_on: sanitizeDependsOn((update as any).depends_on ?? t.depends_on) } as SprintTask
      if (merged.status === TASK_STATUS.DONE && merged.pr_url && !merged.pr_status) {
        merged.pr_status = PR_STATUS.OPEN
      }
      // Protect pending optimistic fields (same logic as loadData)
      const pending = s.pendingUpdates[t.id]
      if (pending && Date.now() - pending.ts <= PENDING_UPDATE_TTL) {
        for (const field of pending.fields) {
          ;(merged as any)[field] = (t as any)[field]
        }
      }
      return merged
    })
  }))
},
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/src/stores/ --reporter=verbose`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/stores/sprintTasks.ts
git commit -m "fix: createTask passes depends_on to IPC + SSE merge respects pending updates (C2, H10)"
```

---

### Task 3: Performance fixes — polling selector, drawer re-renders (M10, M11)

**Files:**

- Modify: `src/renderer/src/hooks/useSprintPolling.ts`
- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`

- [ ] **Step 1: Optimize polling selector**

In `useSprintPolling.ts`, replace line 12:

```ts
const tasks = useSprintTasks((s) => s.tasks)
```

with:

```ts
const hasActiveTasks = useSprintTasks((s) => s.tasks.some((t) => t.status === TASK_STATUS.ACTIVE))
```

Remove `const hasActiveTasks = tasks.some(...)` on line 16. Use the selector value directly.

- [ ] **Step 2: Optimize TaskDetailDrawer dependency computation**

In `TaskDetailDrawer.tsx`, find where it subscribes to `s.tasks` for dependency stats. Replace with a memoized selector that only reads the specific dependency task statuses:

```ts
const depIds = useMemo(() => task?.depends_on?.map((d) => d.id) ?? [], [task?.depends_on])
const depsCompleted = useSprintTasks(
  useCallback(
    (s) =>
      depIds.length === 0
        ? 0
        : s.tasks.filter((t) => depIds.includes(t.id) && t.status === 'done').length,
    [depIds]
  )
)
```

Add `useCallback` to the react imports if not already present.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/ src/renderer/src/hooks/ --reporter=verbose`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useSprintPolling.ts src/renderer/src/components/sprint/TaskDetailDrawer.tsx
git commit -m "perf: optimize polling selector and drawer dependency re-renders (M10, M11)"
```

---

### Task 4: Interaction fixes — escape key, drawer toggle, dead code removal (L1, L2, L3, L5, M4)

**Files:**

- Modify: `src/renderer/src/stores/sprintUI.ts`
- Modify: `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`
- Modify: `src/renderer/src/hooks/useSprintTaskActions.ts`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/sprint/TaskPill.tsx`

- [ ] **Step 1: Add drawer toggle on re-click (L1)**

In `sprintUI.ts`, change `setSelectedTaskId` (line 62):

```ts
setSelectedTaskId: (id): void => {
  const current = get().selectedTaskId
  if (id === current) {
    set({ selectedTaskId: null, drawerOpen: false })
  } else {
    set({ selectedTaskId: id, drawerOpen: id !== null })
  }
},
```

- [ ] **Step 2: Fix Escape key progressive close (L2)**

In `useSprintKeyboardShortcuts.ts`, replace the Escape handler (lines 22-27):

```ts
if (e.key === 'Escape') {
  const { specPanelOpen, drawerOpen, selectedTaskId, logDrawerTaskId, healthCheckDrawerOpen } =
    useSprintUI.getState()
  // Let SpecPanel handle Escape if open
  if (specPanelOpen) return
  // Close drawer + deselect if open
  if (drawerOpen || selectedTaskId) {
    useSprintUI.getState().setSelectedTaskId(null)
    useSprintUI.getState().setDrawerOpen(false)
    return
  }
  // Close secondary drawers
  if (logDrawerTaskId) {
    setLogDrawerTaskId(null)
    return
  }
  if (healthCheckDrawerOpen) {
    useSprintUI.getState().setHealthCheckDrawerOpen(false)
    return
  }
  setConflictDrawerOpen(false)
  return
}
```

- [ ] **Step 3: Remove dead DnD callbacks (L3)**

In `useSprintTaskActions.ts`, remove `handleDragEnd` and `handleReorder` functions and their return entries. These are dead code — no component calls them.

- [ ] **Step 4: Fix empty state shortcut text (L5)**

In `SprintPipeline.tsx`, find the empty state text (around line 237-244). Change:

```
Open Task Workbench (Cmd+0)
```

to:

```
Press N to create your first task
```

- [ ] **Step 5: Wire up arrival animation (M4)**

In `TaskPill.tsx`, track the task's previous stage using a ref and apply `task-pill--arriving` class when it changes. Add a simple state flag:

```tsx
const [arriving, setArriving] = useState(false)
const prevStatusRef = useRef(task.status)

useEffect(() => {
  if (task.status !== prevStatusRef.current) {
    prevStatusRef.current = task.status
    setArriving(true)
    const timer = setTimeout(() => setArriving(false), 500)
    return () => clearTimeout(timer)
  }
}, [task.status])
```

Add `task-pill--arriving` to the className when `arriving` is true.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/renderer/src/ --reporter=verbose`

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/sprintUI.ts src/renderer/src/hooks/useSprintKeyboardShortcuts.ts src/renderer/src/hooks/useSprintTaskActions.ts src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/sprint/TaskPill.tsx
git commit -m "fix: escape key, drawer toggle, dead code removal, arrival animation (L1, L2, L3, L5, M4)"
```

---

### Task 5: Error boundary (M9)

**Files:**

- Create: `src/renderer/src/components/sprint/PipelineErrorBoundary.tsx`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`

- [ ] **Step 1: Create PipelineErrorBoundary**

```tsx
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackLabel?: string
}
interface State {
  hasError: boolean
  error: Error | null
}

export class PipelineErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleRetry = () => this.setState({ hasError: false, error: null })

  render() {
    if (this.state.hasError) {
      return (
        <div className="pipeline-error-boundary">
          <span className="pipeline-error-boundary__title">
            {this.props.fallbackLabel ?? 'Something went wrong'}
          </span>
          <span className="pipeline-error-boundary__message">{this.state.error?.message}</span>
          <button className="pipeline-error-boundary__retry" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: Wrap pipeline body in error boundary**

In `SprintPipeline.tsx`, wrap the 3-zone body (sidebar + center + drawer) in `<PipelineErrorBoundary>`.

- [ ] **Step 3: Add CSS**

```css
.pipeline-error-boundary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--neon-text-dim);
  font-family: var(--bde-font-code);
}

.pipeline-error-boundary__title {
  font-size: 14px;
  color: var(--neon-red);
}

.pipeline-error-boundary__message {
  font-size: 11px;
  max-width: 400px;
  text-align: center;
}

.pipeline-error-boundary__retry {
  padding: 4px 12px;
  border: 1px solid var(--neon-cyan-border);
  border-radius: 6px;
  background: transparent;
  color: var(--neon-cyan);
  font-size: 11px;
  cursor: pointer;
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose
git add src/renderer/src/components/sprint/PipelineErrorBoundary.tsx src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: error boundary for pipeline view (M9)"
```

---

## Phase 2: Operational UX

### Task 6: Retry action for errored tasks (C4)

This is the only task requiring main-process changes.

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/handlers/sprint-local.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- Modify: `src/renderer/src/hooks/useSprintTaskActions.ts`

- [ ] **Step 1: Add IPC channel**

In `src/shared/ipc-channels.ts`, add:

```ts
'sprint:retry': 'sprint:retry',
```

- [ ] **Step 2: Add handler in sprint-local.ts**

In `src/main/handlers/sprint-local.ts`, add a handler using `safeHandle`:

```ts
safeHandle('sprint:retry', async (_event, taskId: string) => {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'failed' && task.status !== 'error') {
    throw new Error(`Cannot retry task with status ${task.status}`)
  }

  // Resolve repo name to local path via repos setting
  const repos = getSettingJson('repos') as Array<{ name: string; localPath: string }> | null
  const repoConfig = repos?.find((r) => r.name === task.repo)
  const repoPath = repoConfig?.localPath
  if (!repoPath) throw new Error(`Unknown repo: ${task.repo}`)

  // Clean up stale worktree/branch if they exist
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
  const branchPattern = `agent/${slug}`
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath })
    const { stdout: branches } = await execFileAsync(
      'git',
      ['branch', '--list', `${branchPattern}*`],
      { cwd: repoPath }
    )
    for (const branch of branches
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean)) {
      await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath }).catch(() => {})
    }
  } catch {
    /* cleanup is best-effort */
  }

  // Reset task fields
  updateTask(taskId, {
    status: 'queued',
    claimed_by: null,
    notes: null,
    started_at: null,
    completed_at: null,
    fast_fail_count: 0,
    agent_run_id: null
  })

  return getTask(taskId)
})
```

**Note:** Update the handler count test for sprint-local if one exists.

- [ ] **Step 3: Add to preload bridge**

In `src/preload/index.ts`, add `retry` to the sprint namespace:

```ts
retry: (taskId: string) => ipcRenderer.invoke('sprint:retry', taskId),
```

In `src/preload/index.d.ts`, add the type:

```ts
retry: (taskId: string) => Promise<SprintTask>
```

- [ ] **Step 4: Add Retry button to TaskDetailDrawer ActionButtons**

In the `failed`/`error` case of `ActionButtons`, add a Retry button before "Clone & Queue":

```tsx
<button className="task-drawer__btn task-drawer__btn--primary" onClick={onRetry}>
  <RefreshCw size={12} /> Retry
</button>
```

Wire `onRetry` to call `window.api.sprint.retry(task.id)` with a confirm dialog and toast feedback.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose`
Run: `npm run test:main`

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/handlers/sprint-local.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/sprint/TaskDetailDrawer.tsx src/renderer/src/hooks/useSprintTaskActions.ts
git commit -m "feat: sprint:retry IPC endpoint + Retry button for errored tasks (C4)"
```

---

### Task 7: Zombie task indicator + failure mode badges (C3, H9)

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskPill.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Add zombie detection logic to TaskPill**

A task is a "zombie" if: `status === 'active'` AND (`pr_url` is set OR `pr_status` is set). Add to TaskPill:

```tsx
const isZombie = task.status === 'active' && (task.pr_url || task.pr_status)
const isStale =
  task.status === 'active' &&
  task.started_at &&
  Date.now() - new Date(task.started_at).getTime() > (task.max_runtime_ms ?? 3600000)
```

Show a warning icon on the pill when zombie or stale:

```tsx
{
  isZombie && <AlertTriangle size={12} className="task-pill__zombie-icon" />
}
{
  isStale && !isZombie && <Clock size={12} className="task-pill__stale-icon" />
}
```

- [ ] **Step 2: Add failure mode badges for failed tasks**

Determine failure mode and show appropriate icon:

```tsx
function getFailureIcon(task: SprintTask) {
  if (task.fast_fail_count >= 3)
    return { icon: Zap, label: 'Fast-fail', cls: 'task-pill__fail--fastfail' }
  if (task.pr_url || task.pr_status === 'branch_only')
    return { icon: GitBranch, label: 'Push failed', cls: 'task-pill__fail--push' }
  if (task.status === 'cancelled')
    return { icon: Slash, label: 'Cancelled', cls: 'task-pill__fail--cancelled' }
  return { icon: XCircle, label: 'Agent failed', cls: 'task-pill__fail--agent' }
}
```

Render next to the status dot for failed/error/cancelled tasks.

- [ ] **Step 3: Add CSS**

```css
.task-pill--zombie {
  border-color: var(--neon-orange-border);
  background: var(--neon-orange-surface);
}

.task-pill__zombie-icon {
  color: var(--neon-orange);
  flex-shrink: 0;
}

.task-pill__stale-icon {
  color: var(--neon-red);
  flex-shrink: 0;
  animation: pipeline-pulse 2s ease-in-out infinite;
}

.task-pill__fail--push {
  color: var(--neon-orange);
}
.task-pill__fail--agent {
  color: var(--neon-red);
}
.task-pill__fail--fastfail {
  color: var(--neon-red);
}
.task-pill__fail--cancelled {
  color: var(--neon-text-dim);
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose
git add src/renderer/src/components/sprint/TaskPill.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: zombie task indicator + failure mode badges on pills (C3, H9)"
```

---

### Task 8: Header stats + neon primitives + Review label + Done truncation (H4, H7, H12, L6)

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineStage.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Expand header stats to include blocked, failed, review**

In the header section of `SprintPipeline.tsx`, replace bespoke stat text with `StatCounter` neon primitives (import from `../components/neon`). Add counts for all 7 buckets. Color-code each:

```tsx
<span className="sprint-pipeline__stat sprint-pipeline__stat--active">
  <span className="sprint-pipeline__stat-count">{partition.inProgress.length}</span> active
</span>
<span className="sprint-pipeline__stat sprint-pipeline__stat--blocked">
  <span className="sprint-pipeline__stat-count">{partition.blocked.length}</span> blocked
</span>
<span className="sprint-pipeline__stat sprint-pipeline__stat--review">
  <span className="sprint-pipeline__stat-count">{partition.awaitingReview.length}</span> review
</span>
<span className="sprint-pipeline__stat sprint-pipeline__stat--failed">
  <span className="sprint-pipeline__stat-count">{partition.failed.length}</span> failed
</span>
```

Make each stat clickable → sets `statusFilter` to that bucket.

- [ ] **Step 2: Add "PRs awaiting merge" subtitle to Review stage**

In `PipelineStage.tsx`, when `label === 'Review'`, add a subtitle:

```tsx
{
  label === 'Review' && count > 0 && (
    <span className="pipeline-stage__subtitle">PRs awaiting merge</span>
  )
}
```

- [ ] **Step 3: Fix Done truncation — replace pills with summary**

Replace the done stage rendering (which shows 5 pills + "View all") with a compact summary:

```tsx
{
  stage === 'done' && partition.done.length > 0 && (
    <button className="pipeline-stage__done-summary" onClick={() => setDoneViewOpen(true)}>
      {partition.done.length} completed · View all
    </button>
  )
}
```

Show done pills only for the 3 most recent, instead of 5.

- [ ] **Step 4: Add CSS**

```css
.sprint-pipeline__stat--active .sprint-pipeline__stat-count {
  color: var(--neon-purple);
}
.sprint-pipeline__stat--blocked .sprint-pipeline__stat-count {
  color: var(--neon-orange);
}
.sprint-pipeline__stat--review .sprint-pipeline__stat-count {
  color: var(--neon-blue);
}
.sprint-pipeline__stat--failed .sprint-pipeline__stat-count {
  color: var(--neon-red);
}

.pipeline-stage__subtitle {
  font-size: 10px;
  color: var(--neon-text-dim);
  font-style: italic;
}

.pipeline-stage__done-summary {
  padding: 6px 12px;
  background: var(--neon-surface-dim);
  border: 1px solid var(--neon-pink-border);
  border-radius: 8px;
  color: var(--neon-pink);
  font-size: 11px;
  font-family: var(--bde-font-code);
  cursor: pointer;
}
```

- [ ] **Step 5: Run tests + commit**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose
git add src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/sprint/PipelineStage.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: expanded header stats, review subtitle, done summary (H7, H12, L6)"
```

---

### Task 9: Dependency chain visibility in TaskDetailDrawer (H8)

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Replace text summary with interactive dependency list**

In TaskDetailDrawer, where dependency stats are shown, replace the "N deps — M/N complete" text with an interactive list:

```tsx
{
  task.depends_on && task.depends_on.length > 0 && (
    <div className="task-drawer__deps">
      <div className="task-drawer__deps-label">
        {task.status === 'blocked' ? 'Blocked by' : 'Dependencies'}
      </div>
      {task.depends_on.map((dep) => {
        const depTask = allTasks.find((t) => t.id === dep.id)
        if (!depTask) return null
        return (
          <button
            key={dep.id}
            className={`task-drawer__dep task-drawer__dep--${depTask.status}`}
            onClick={() => setSelectedTaskId(dep.id)}
          >
            <span className="task-drawer__dep-dot" />
            <span className="task-drawer__dep-title">{depTask.title.slice(0, 50)}</span>
            <span className="task-drawer__dep-status">{depTask.status}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Add CSS for dependency list**

```css
.task-drawer__deps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
}

.task-drawer__deps-label {
  font-size: 10px;
  color: var(--neon-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.task-drawer__dep {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--neon-purple-border);
  background: var(--neon-surface-dim);
  cursor: pointer;
  font-size: 11px;
  font-family: var(--bde-font-code);
  color: var(--neon-text-muted);
  transition: background 150ms ease;
}

.task-drawer__dep:hover {
  background: var(--neon-purple-surface);
}

.task-drawer__dep-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.task-drawer__dep--done .task-drawer__dep-dot {
  background: var(--neon-cyan);
}
.task-drawer__dep--active .task-drawer__dep-dot {
  background: var(--neon-purple);
}
.task-drawer__dep--blocked .task-drawer__dep-dot {
  background: var(--neon-orange);
}
.task-drawer__dep--queued .task-drawer__dep-dot {
  background: var(--neon-cyan);
  opacity: 0.5;
}
.task-drawer__dep--failed .task-drawer__dep-dot,
.task-drawer__dep--error .task-drawer__dep-dot {
  background: var(--neon-red);
}

.task-drawer__dep-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-drawer__dep-status {
  font-size: 9px;
  color: var(--neon-text-dim);
}
```

- [ ] **Step 3: Run tests + commit**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose
git add src/renderer/src/components/sprint/TaskDetailDrawer.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: interactive dependency chain in task detail drawer (H8)"
```

---

### Task 10: Filter/search bar + resizable sidebar (H11, M1)

**Files:**

- Create: `src/renderer/src/components/sprint/PipelineFilterBar.tsx`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Create PipelineFilterBar component**

```tsx
import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { useSprintUI } from '../../stores/sprintUI'
import type { SprintTask } from '../../../../shared/types'

interface PipelineFilterBarProps {
  tasks: SprintTask[]
}

export function PipelineFilterBar({ tasks }: PipelineFilterBarProps) {
  const searchQuery = useSprintUI((s) => s.searchQuery)
  const setSearchQuery = useSprintUI((s) => s.setSearchQuery)
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)

  const repos = useMemo(() => {
    const set = new Set(tasks.map((t) => t.repo))
    return Array.from(set).sort()
  }, [tasks])

  if (repos.length <= 1 && !searchQuery) return null

  return (
    <div className="pipeline-filter-bar">
      <div className="pipeline-filter-bar__search">
        <Search size={12} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks…"
          className="pipeline-filter-bar__input"
          aria-label="Search tasks"
        />
      </div>
      {repos.length > 1 && (
        <div className="pipeline-filter-bar__chips">
          <button
            className={`pipeline-filter-bar__chip${!repoFilter ? ' pipeline-filter-bar__chip--active' : ''}`}
            onClick={() => setRepoFilter(null)}
          >
            All
          </button>
          {repos.map((repo) => (
            <button
              key={repo}
              className={`pipeline-filter-bar__chip${repoFilter === repo ? ' pipeline-filter-bar__chip--active' : ''}`}
              onClick={() => setRepoFilter(repoFilter === repo ? null : repo)}
            >
              {repo}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrate filter bar into SprintPipeline**

Add `<PipelineFilterBar tasks={tasks} />` below the header. Apply filters to the tasks before partitioning:

```tsx
const filteredTasks = useMemo(() => {
  let result = tasks
  if (repoFilter) result = result.filter((t) => t.repo === repoFilter)
  if (searchQuery) {
    const lower = searchQuery.toLowerCase()
    result = result.filter((t) => t.title.toLowerCase().includes(lower))
  }
  return result
}, [tasks, repoFilter, searchQuery])

const partition = useMemo(() => partitionSprintTasks(filteredTasks), [filteredTasks])
```

- [ ] **Step 3: Make sidebar resizable**

Add `resize: horizontal` to `.pipeline-sidebar` in CSS:

```css
.pipeline-sidebar {
  /* existing styles */
  resize: horizontal;
  overflow: hidden;
  max-width: 400px;
}
```

- [ ] **Step 4: Add filter bar CSS**

```css
.pipeline-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--neon-purple-border);
  flex-shrink: 0;
}

.pipeline-filter-bar__search {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--neon-text-dim);
}

.pipeline-filter-bar__input {
  background: transparent;
  border: none;
  color: var(--neon-text);
  font-family: var(--bde-font-code);
  font-size: 11px;
  outline: none;
  width: 120px;
}

.pipeline-filter-bar__input::placeholder {
  color: var(--neon-text-dim);
}

.pipeline-filter-bar__chips {
  display: flex;
  gap: 4px;
  overflow-x: auto;
}

.pipeline-filter-bar__chip {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--neon-purple-border);
  background: transparent;
  color: var(--neon-text-dim);
  font-size: 10px;
  font-family: var(--bde-font-code);
  cursor: pointer;
  white-space: nowrap;
}

.pipeline-filter-bar__chip:hover {
  background: var(--neon-purple-surface);
}

.pipeline-filter-bar__chip--active {
  background: var(--neon-purple-surface);
  border-color: var(--neon-purple);
  color: var(--neon-purple);
}
```

- [ ] **Step 5: Run tests + commit**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose
git add src/renderer/src/components/sprint/PipelineFilterBar.tsx src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: filter/search bar + resizable sidebar (H11, M1)"
```

---

### Task 11: Keyboard shortcuts + cost/duration + progress indicator + multi-select (M2, M3, M5, M6)

**Files:**

- Modify: `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts`
- Modify: `src/renderer/src/components/sprint/TaskPill.tsx`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Create: `src/renderer/src/components/sprint/BulkActionBar.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Add keyboard navigation shortcuts**

Expand `useSprintKeyboardShortcuts` to handle arrow keys and action keys:

- `ArrowDown` / `ArrowUp`: navigate between tasks in the current visible list
- `?`: toggle a shortcuts help overlay (set a local state in SprintPipeline)
- `r`: retry selected task if failed/error
- `d`: delete selected task with confirm

This requires maintaining a flat task list for arrow navigation. Use the partitioned tasks in display order.

- [ ] **Step 2: Add cost/duration to completed TaskPills**

In `TaskPill.tsx`, for done tasks show duration:

```tsx
{
  task.status === 'done' && task.started_at && task.completed_at && (
    <span className="task-pill__duration">
      {formatDuration(new Date(task.started_at).getTime(), new Date(task.completed_at).getTime())}
    </span>
  )
}
```

If cost data is available on the task (from `cost_events`), show it too. This may require a new store field or IPC call.

- [ ] **Step 3: Add activity dot to active TaskPills**

Show a pulsing dot that dims when no recent events. Check the agent events store for the task's `agent_run_id`:

```tsx
{
  task.status === 'active' && (
    <span className={`task-pill__activity${recentActivity ? '' : ' task-pill__activity--idle'}`} />
  )
}
```

- [ ] **Step 4: Wire up multi-select with BulkActionBar**

In TaskPill, add Shift+Click and Cmd+Click handlers:

```tsx
const handleClick = (e: React.MouseEvent) => {
  if (e.shiftKey) {
    selectRange(task.id)
  } else if (e.metaKey || e.ctrlKey) {
    toggleTaskSelection(task.id)
  } else {
    clearSelection()
    onSelect(task.id)
  }
}
```

Create `BulkActionBar.tsx` that renders when `selectedTaskIds.length > 1`:

```tsx
export function BulkActionBar() {
  const selectedTaskIds = useSprintUI((s) => s.selectedTaskIds)
  const clearSelection = useSprintUI((s) => s.clearSelection)
  if (selectedTaskIds.length < 2) return null
  return (
    <div className="bulk-action-bar">
      <span>{selectedTaskIds.length} selected</span>
      <button onClick={handleBulkRequeue}>Re-queue</button>
      <button onClick={handleBulkCancel}>Cancel</button>
      <button onClick={handleBulkDelete}>Delete</button>
      <button onClick={clearSelection}>Clear</button>
    </div>
  )
}
```

- [ ] **Step 5: Add CSS for new elements**

```css
.task-pill__duration {
  font-size: 10px;
  color: var(--neon-text-dim);
  font-family: var(--bde-font-code);
}

.task-pill__activity {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--neon-cyan);
  animation: pipeline-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}

.task-pill__activity--idle {
  background: var(--neon-text-dim);
  animation: none;
}

.bulk-action-bar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--neon-surface-deep);
  border: 1px solid var(--neon-purple-border);
  border-radius: 10px;
  backdrop-filter: var(--neon-glass-blur);
  box-shadow: var(--neon-glass-shadow);
  z-index: 20;
  font-family: var(--bde-font-code);
  font-size: 11px;
  color: var(--neon-text);
}
```

- [ ] **Step 6: Run tests + commit**

```bash
npx vitest run src/renderer/src/ --reporter=verbose
git add src/renderer/src/hooks/useSprintKeyboardShortcuts.ts src/renderer/src/components/sprint/TaskPill.tsx src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/sprint/BulkActionBar.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: keyboard nav, cost/duration, activity dot, multi-select bulk actions (M2, M3, M5, M6)"
```

---

### Task 12: Spec panel markdown rendering (M7)

**Files:**

- Modify: `src/renderer/src/components/sprint/SpecPanel.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Add markdown rendering in read mode**

In SpecPanel, import and use `renderAgentMarkdown` from `src/renderer/src/lib/render-agent-markdown.tsx` (already exists in the codebase). Replace the `<pre>` read mode with rendered markdown:

```tsx
{editing ? (
  <textarea className="spec-panel__textarea" value={editValue} onChange={...} />
) : (
  <div className="spec-panel__rendered">
    {renderAgentMarkdown(spec)}
  </div>
)}
```

If `renderAgentMarkdown` only supports inline markdown (bold, code, headings), it may need extension for full spec rendering. At minimum, headings and code blocks should render distinctly.

- [ ] **Step 2: Add CSS for rendered spec**

```css
.spec-panel__rendered {
  padding: 12px;
  font-family: var(--bde-font-code);
  font-size: 12px;
  color: var(--neon-text-muted);
  line-height: 1.6;
  overflow-y: auto;
  flex: 1;
}
```

- [ ] **Step 3: Run tests + commit**

```bash
npx vitest run src/renderer/src/components/sprint/__tests__/ --reporter=verbose
git add src/renderer/src/components/sprint/SpecPanel.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: markdown rendering in spec panel read mode (M7)"
```

---

## Phase 3: Design System + Accessibility

### Task 13: Font size minimums + done pill opacity (H1, L4)

**Files:**

- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Bump all 8-9px font sizes to 10px minimum**

Find and replace in `sprint-pipeline-neon.css`:

- `font-size: 9px` → `font-size: 10px` (sidebar labels, counts, expand, stage count, dot text, pill time)
- `font-size: 8px` → `font-size: 10px` (pill badge)

- [ ] **Step 2: Fix done pill opacity**

Change `.task-pill--done` from `opacity: 0.5` to `opacity: 0.7`.

- [ ] **Step 3: Run tests + commit**

```bash
npx vitest run src/renderer/src/ --reporter=verbose
git add src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "fix: bump minimum font sizes to 10px + adjust done pill opacity (H1, L4)"
```

---

### Task 14: Inline styles → CSS classes (H2)

**Files:**

- Modify: `src/renderer/src/components/sprint/PipelineBacklog.tsx`
- Modify: `src/renderer/src/components/sprint/TaskPill.tsx`
- Modify: `src/renderer/src/components/sprint/DoneHistoryPanel.tsx`
- Modify: `src/renderer/src/components/sprint/SpecPanel.tsx`
- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Extract PipelineBacklog inline styles**

Replace all `style={{}}` in PipelineBacklog.tsx with CSS classes. Add classes to CSS file:

- `.pipeline-sidebar__label--backlog` (color: neon-blue)
- `.pipeline-sidebar__label--failed` (color: neon-red)
- `.pipeline-sidebar__empty` (centered dim text)
- `.failed-card__notes` (truncated text)

- [ ] **Step 2: Extract SpecPanel inline styles**

Replace textarea and pre inline styles with `.spec-panel__textarea` and `.spec-panel__pre` CSS classes.

- [ ] **Step 3: Extract remaining inline styles**

- DoneHistoryPanel badge colors → `.done-history__badge`
- TaskDetailDrawer PR link margin → `.task-drawer__pr-link`
- SprintPipeline error hint → `.sprint-pipeline__error-hint`

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run src/renderer/src/ --reporter=verbose
git add src/renderer/src/components/sprint/*.tsx src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "refactor: extract all inline styles to CSS classes (H2)"
```

---

### Task 15: Migrate drawer CSS to neon tokens (H3)

**Files:**

- Modify: `src/renderer/src/assets/sprint.css`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Copy ConflictDrawer and HealthCheckDrawer styles from sprint.css to sprint-pipeline-neon.css**

Migrate the CSS blocks, replacing token references:

- `var(--glass-tint-dark)` → `var(--neon-surface-deep)`
- `var(--glass-tint-mid)` → `var(--neon-purple-surface)`
- `var(--glass-blur-lg)` / `var(--glass-blur-md)` → `var(--neon-glass-blur)`
- `var(--glass-saturate)` → remove (neon system doesn't use saturate)
- `var(--bde-text)` → `var(--neon-text)`
- `var(--bde-text-muted)` → `var(--neon-text-muted)`
- `var(--bde-text-dim)` → `var(--neon-text-dim)`
- `var(--bde-danger-gradient)` → `var(--neon-red-surface)` with red border
- `var(--bde-warning-gradient)` → `var(--neon-orange-surface)` with orange border

- [ ] **Step 2: Remove the old rules from sprint.css**

Delete the ConflictDrawer and HealthCheckDrawer blocks from `sprint.css` (approximately lines 1304-1640).

- [ ] **Step 3: Add reduced-motion rules for drawer transitions (M8)**

```css
@media (prefers-reduced-motion: reduce) {
  .conflict-drawer,
  .health-check-drawer {
    transition: none;
  }
}
```

- [ ] **Step 4: Run tests + verify visual appearance + commit**

```bash
npx vitest run src/renderer/src/ --reporter=verbose
git add src/renderer/src/assets/sprint.css src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "refactor: migrate drawer CSS from legacy glass tokens to neon (H3, M8)"
```

---

### Task 16: Accessibility — focus indicators, focus traps, ARIA (H5, H6, M12)

**Files:**

- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`
- Modify: `src/renderer/src/components/sprint/SpecPanel.tsx`
- Modify: `src/renderer/src/components/sprint/DoneHistoryPanel.tsx`
- Modify: `src/renderer/src/components/sprint/ConflictDrawer.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineStage.tsx`

- [ ] **Step 1: Add focus-visible styles (H5)**

```css
.task-pill:focus-visible,
.backlog-card:focus-visible,
.failed-card:focus-visible,
.task-drawer__btn:focus-visible,
.backlog-card__action:focus-visible,
.pipeline-filter-bar__chip:focus-visible,
.sprint-pipeline__badge:focus-visible {
  box-shadow: 0 0 0 2px var(--neon-cyan);
  outline: none;
}
```

- [ ] **Step 2: Add focus trapping to SpecPanel and DoneHistoryPanel (H6)**

In both components, add a focus trap effect that cycles between first and last focusable elements. Auto-focus close button on mount.

- [ ] **Step 3: Add ARIA attributes (M12)**

- ConflictDrawer accordion rows: add `role="button"`, `tabIndex={0}`, `aria-expanded={isExpanded}`, `onKeyDown` for Enter/Space
- PipelineStage: add `role="region"`, `aria-label={label}` to each stage root div
- DoneHistoryPanel: add `role="list"` on container, `role="listitem"` on items

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run src/renderer/src/ --reporter=verbose
git add src/renderer/src/assets/sprint-pipeline-neon.css src/renderer/src/components/sprint/SpecPanel.tsx src/renderer/src/components/sprint/DoneHistoryPanel.tsx src/renderer/src/components/sprint/ConflictDrawer.tsx src/renderer/src/components/sprint/PipelineStage.tsx
git commit -m "feat: focus indicators, focus traps, ARIA semantics (H5, H6, M12)"
```

---

### Task 17: Polish — entrance animation, empty state, loading skeleton, status color (L7, L8, L9, L10, M13)

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- Modify: `src/renderer/src/lib/task-format.ts`
- Modify: `src/renderer/src/assets/sprint-pipeline-neon.css`

- [ ] **Step 1: Add entrance animation (L7)**

Wrap pipeline root in `motion.div` with `VARIANTS.fadeIn`, gated by `useReducedMotion()`.

- [ ] **Step 2: Upgrade empty state to NeonCard (L8)**

Replace bare text with:

```tsx
<NeonCard accent="purple" title="No tasks yet">
  <p className="sprint-pipeline__empty-text">Create your first task to start the pipeline.</p>
  <button className="task-drawer__btn task-drawer__btn--primary" onClick={openWorkbench}>
    New Task
  </button>
</NeonCard>
```

- [ ] **Step 3: Add loading skeleton (M13)**

Replace the spinner-only loading state with a dim structural skeleton showing the sidebar and stage headers.

- [ ] **Step 4: Fix review dot color (L9)**

In `task-format.ts`, add a `review` case to `getDotColor()` returning `var(--neon-blue)`. Or handle the `awaitingReview` partition by checking `pr_status` in the color function.

- [ ] **Step 5: Add resize handle keyboard support (L10)**

In TaskDetailDrawer, add `onKeyDown` to the resize handle: Left/Right ±10px, Shift+Left/Right ±50px.

- [ ] **Step 6: Run tests + commit**

```bash
npx vitest run src/renderer/src/ --reporter=verbose
git add src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/sprint/TaskDetailDrawer.tsx src/renderer/src/lib/task-format.ts src/renderer/src/assets/sprint-pipeline-neon.css
git commit -m "feat: entrance animation, onboarding card, loading skeleton, polish (L7, L8, L9, L10, M13)"
```

---

### Task 18: Tests — partitionSprintTasks, sprintTasks store (C6, M14)

**Files:**

- Create: `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`
- Create: `src/renderer/src/stores/__tests__/sprintTasks.test.ts`

- [ ] **Step 1: Write partitionSprintTasks tests**

Pure function — no mocks needed. Cover:

- Each status → correct bucket
- `awaitingReview` override (active + pr_status=open)
- Done sorting (most recent first)
- Empty array
- Unknown/missing status

- [ ] **Step 2: Write sprintTasks store tests**

Mock `window.api` IPC calls. Cover:

- `createTask` passes `depends_on` to IPC
- `mergeSseUpdate` respects pending updates within TTL
- `mergeSseUpdate` overwrites after TTL expires
- `updateTask` sets pending fields and calls IPC
- `loadData` merge logic with pending field preservation

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts src/renderer/src/stores/__tests__/sprintTasks.test.ts --reporter=verbose
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts src/renderer/src/stores/__tests__/sprintTasks.test.ts
git commit -m "test: add tests for partitionSprintTasks + sprintTasks store (C6, M14)"
```

---

## PR Strategy

One PR per phase:

1. **PR: Pipeline Phase 1 — Fix broken features** (Tasks 1-5)
2. **PR: Pipeline Phase 2 — Operational UX** (Tasks 6-12)
3. **PR: Pipeline Phase 3 — Design system + accessibility** (Tasks 13-18)

Each PR: `npm run typecheck && npm test` must pass before opening.

---

## Finding → Task Cross-Reference

| Finding                        | Task | Phase |
| ------------------------------ | ---- | ----- |
| C1 ConflictDrawer filter       | 1    | 1     |
| C2 createTask drops depends_on | 2    | 1     |
| C4 Retry action                | 6    | 2     |
| C5 No drawer entry points      | 1    | 1     |
| C6 No store tests              | 18   | 3     |
| H1 Font sizes                  | 13   | 3     |
| H2 Inline styles               | 14   | 3     |
| H3 Legacy drawer CSS           | 15   | 3     |
| H4 Neon primitives             | 8    | 2     |
| H5 Focus indicators            | 16   | 3     |
| H6 Focus trapping              | 16   | 3     |
| H7 Review label                | 8    | 2     |
| H8 Dependency chain            | 9    | 2     |
| H9 Failure badges              | 7    | 2     |
| H10 SSE merge                  | 2    | 1     |
| H11 Filter/search              | 10   | 2     |
| H12 Header stats               | 8    | 2     |
| C3 Zombie indicator            | 7    | 2     |
| M1 Resizable sidebar           | 10   | 2     |
| M2 Cost/duration               | 11   | 2     |
| M3 Progress indicator          | 11   | 2     |
| M4 Arrival animation           | 4    | 1     |
| M5 Multi-select                | 11   | 2     |
| M6 Keyboard shortcuts          | 11   | 2     |
| M7 Spec markdown               | 12   | 2     |
| M8 Reduced motion              | 15   | 3     |
| M9 Error boundary              | 5    | 1     |
| M10 Polling selector           | 3    | 1     |
| M11 Drawer re-renders          | 3    | 1     |
| M12 ARIA semantics             | 16   | 3     |
| M13 Loading skeleton           | 17   | 3     |
| M14 Missing tests              | 18   | 3     |
| L1 Drawer toggle               | 4    | 1     |
| L2 Escape key                  | 4    | 1     |
| L3 Dead DnD                    | 4    | 1     |
| L4 Done opacity                | 13   | 3     |
| L5 Wrong shortcut              | 4    | 1     |
| L6 Done truncation             | 8    | 2     |
| L7 Entrance animation          | 17   | 3     |
| L8 Empty state                 | 17   | 3     |
| L9 Status color                | 17   | 3     |
| L10 Resize keyboard            | 17   | 3     |

---

## Dependency Chain for Pipeline Tasks

Tasks within each phase can be partially parallelized:

**Phase 1 (Tasks 1-5):** All independent — can run in parallel.

**Phase 2 (Tasks 6-12):**

- Task 6 (retry IPC) — independent, no renderer deps
- Task 7 (zombie/failure badges) — independent
- Task 8 (header stats) — independent
- Task 9 (dependency chain) — independent
- Task 10 (filter bar) — independent
- Task 11 (keyboard/multi-select/cost) — depends on Task 7 (TaskPill changes)
- Task 12 (spec markdown) — independent

**Phase 3 (Tasks 13-18):**

- Task 13 (font sizes) — independent
- Task 14 (inline→CSS) — depends on Task 13 (CSS file changes)
- Task 15 (drawer migration) — independent
- Task 16 (accessibility) — depends on Task 15 (drawer changes)
- Task 17 (polish) — depends on Task 14 (SprintPipeline changes)
- Task 18 (tests) — depends on Task 2 (store fixes to test)

# React Performance Engineer

**Lens scope:** React render cost, store subscription granularity, polling efficiency in the renderer.

**Summary:** The codebase demonstrates solid architectural decisions (useShallow for filtered subscriptions, useMemo for derivations, memoization of stage components), but suffers from 5 critical performance issues: fine-grained store selectors causing tree-wide re-renders when any UI state changes, expensive derivations inside render functions in polling hooks, unstable `now` timestamps triggering cascading updates across the dashboard every 10 seconds, excessive polling churn from multiple redundant hooks, and a missing memoization layer on child list items that re-render on every partition change. During baseline dashboard loads and sprint pipeline updates, these issues compound to cause 3-5 secondary render cycles per user interaction.

## Findings

## F-t2-react-1: Non-granular store subscription in SprintPipeline drives tree-wide cascading re-renders

**Severity:** Critical
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintPipeline.tsx:73-85`
**Evidence:**

```typescript
const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)
const setDrawerOpen = useSprintUI((s) => s.setDrawerOpen)
const setSpecPanelOpen = useSprintUI((s) => s.setSpecPanelOpen)
const setDoneViewOpen = useSprintUI((s) => s.setDoneViewOpen)
const setLogDrawerTaskId = useSprintUI((s) => s.setLogDrawerTaskId)
const setConflictDrawerOpen = useSprintUI((s) => s.setConflictDrawerOpen)
const setHealthCheckDrawerOpen = useSprintUI((s) => s.setHealthCheckDrawerOpen)
const setStatusFilter = useSprintUI((s) => s.setStatusFilter)
const clearMultiSelection = useSprintUI((s) => s.clearMultiSelection)
const statusFilter = useSprintUI((s) => s.statusFilter)
const repoFilter = useSprintUI((s) => s.repoFilter)
const tagFilter = useSprintUI((s) => s.tagFilter)
const searchQuery = useSprintUI((s) => s.searchQuery)
```

The component subscribes to individual setters and state fields without using useShallow. While it accesses several store slices individually, the underlying Zustand store updates the entire `SprintUIState` object on any action. When `conflictDrawerOpen` changes, all 13 of these subscriptions re-evaluate, and since setters are functions they don't have strict referential equality checks—React treats them as potential changes and marks the component dirty.
**Impact:** When user toggles any UI panel (conflict drawer, health check, spec panel, log drawer, done view), SprintPipeline re-renders unnecessarily. The ripple effect re-renders all memoized children (PipelineStage, PipelineBacklog, TaskDetailDrawer), forcing their dependency-array checks to re-run. Happens ~2-3× per minute during normal sprint use.
**Recommendation:** Group related subscriptions with useShallow at the store level. Instead of 13 individual subscriptions, use a single useShallow subscription for all UI state plus a separate subscription for filtering state:

```typescript
const { statusFilter, repoFilter, tagFilter, searchQuery, selectedTaskId, selectedTaskIds, drawerOpen, ... } = useSprintUI(
  useShallow((s) => ({
    statusFilter: s.statusFilter,
    repoFilter: s.repoFilter,
    tagFilter: s.tagFilter,
    searchQuery: s.searchQuery,
    selectedTaskId: s.selectedTaskId,
    selectedTaskIds: s.selectedTaskIds,
    drawerOpen: s.drawerOpen,
    // ... other UI state
  }))
)
// Keep setters in a separate non-memoized call if they must be subscribed (they never change)
```

This way, only changes to the actual values trigger re-renders, not changes to unrelated UI toggles.
**Effort:** S
**Confidence:** High

## F-t2-react-2: Expensive task filtering derivations recomputed on every `now` tick in useDashboardMetrics

**Severity:** High
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useDashboardMetrics.ts:82-197`
**Evidence:**

```typescript
// Line 80: updates every 60s
useVisibilityAwareInterval(() => setNow(Date.now()), 60_000)

// Lines 82-110: stats useMemo depends on [tasks] only, OK
// Lines 140-160: tokenTrendData, tokenAvg depend on [localAgents] only, OK

// Lines 190-197: stuckCount depends on [tasks, now]
const stuckCount = useMemo(() => {
  return tasks.filter((t) => {
    if (t.status !== 'active' || !t.started_at) return false
    const elapsed = now - new Date(t.started_at).getTime()
    const threshold = t.max_runtime_ms ?? DEFAULT_STUCK_MS
    return elapsed > threshold
  }).length
}, [tasks, now])
```

The `stuckCount` derivation includes `now` in its dependency array. Every 60 seconds, DashboardView calls `setNow(Date.now())` (line 104), which causes all 8 useMemos in useDashboardMetrics to re-run their dependencies. Even though most (stats, tokenTrendData, tokenAvg, recentCompletions) don't use `now`, the Zustand selector for `now` on line 79 is not memoized, so it re-evaluates on every render. This cascades to parent CenterColumn and ActivitySection, which receive new `stats`, `tokenTrendData`, `tokenAvg` props (unchanged values, but new object references), causing their child MiniCharts and status cards to re-render.
**Impact:** Every 60 seconds, the entire dashboard re-renders when `now` updates, even though only elapsed-time displays actually need updating. This blocks the main thread for ~50–150ms during chart re-renders.
**Recommendation:**

1. Extract `stuckCount` into a separate hook that depends only on `tasks` and computes the threshold check without `now`. Use a timer callback at the component level instead:

```typescript
// In useDashboardMetrics
const stuckCount = useMemo(() => {
  return tasks.filter((t) => {
    if (t.status !== 'active' || !t.started_at) return false
    const elapsed = Date.now() - new Date(t.started_at).getTime()
    const threshold = t.max_runtime_ms ?? DEFAULT_STUCK_MS
    return elapsed > threshold
  }).length
}, [tasks])
```

2. Move the `now` ticker into its own separate hook in DashboardView that updates a different piece of state (e.g., `freshness` only), and don't pass `now` to useDashboardMetrics at all:

```typescript
const [now, setNow] = useState(() => Date.now())
useVisibilityAwareInterval(() => setNow(Date.now()), 10_000)
// Then in a separate hook, only compute freshness:
const freshness = useMemo(() => {
  /* uses now */
}, [lastFetchedAt, now])
```

**Effort:** M
**Confidence:** High

## F-t2-react-3: Unstable `now` timestamp in DashboardView triggers cascading re-renders every 10 seconds

**Severity:** High
**Category:** CPU | Latency
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/views/DashboardView.tsx:103-104, 131-136`
**Evidence:**

```typescript
// Line 103-104: Ticker that updates every 10 seconds
const [now, setNow] = useState(() => Date.now())
useVisibilityAwareInterval(() => setNow(Date.now()), 10_000)

// Line 131-136: Freshness computation
const freshness = useMemo(() => {
  if (!lastFetchedAt) return { text: '', stale: false }
  const ago = Math.floor((now - lastFetchedAt) / 1000)
  const text = ago < 10 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`
  return { text, stale: ago > 120 }
}, [lastFetchedAt, now])
```

Every 10 seconds, `now` updates, which re-computes `freshness`. While `freshness` is memoized, this is passed down to child components (StatusBar, etc.) and triggers their re-renders. This compounds with the `now` ticker in useDashboardMetrics (60s), which is independent, causing up to 2 secondary render cycles per minute.
**Impact:** Every 10 seconds, the dashboard status bar and timestamp displays re-render. If polling causes a data fetch to complete during this window, the entire dashboard re-renders twice in quick succession, blocking user interactions for 100–200ms.
**Recommendation:** Decouple the timestamp display update from the polling cycle. Instead of a fixed 10-second ticker, update `now` only when data arrives:

```typescript
const [now, setNow] = useState(() => Date.now())
const lastFetchedAt = useDashboardDataStore((s) => s.lastFetchedAt)

useEffect(() => {
  if (lastFetchedAt) {
    setNow(Date.now())
  }
}, [lastFetchedAt])

// Remove the 10-second ticker entirely
// useVisibilityAwareInterval(() => setNow(Date.now()), 10_000)
```

Alternatively, only update `now` when the freshness value actually changes (e.g., from "10s ago" to "11s ago"), not on every tick.
**Effort:** S
**Confidence:** High

## F-t2-react-4: Coarse-grained store subscription in useSprintPolling causes redundant re-runs on every task update

**Severity:** Medium
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useSprintPolling.ts:12-13`
**Evidence:**

```typescript
const hasActiveTasks = useSprintTasks((s) => s.tasks.some((t) => t.status === TASK_STATUS.ACTIVE))
const loadData = useSprintTasks((s) => s.loadData)
```

The `hasActiveTasks` selector uses `.some()` without memoization. Every time the `tasks` array changes (even if only one task's priority changed), the entire array is re-scanned with `.some()`. While the polling interval correctly adapts based on `hasActiveTasks`, the selector is evaluated on every store update, and the `loadData` function reference may change if it's not properly memoized in the store.
**Impact:** When a task status changes (e.g., queued → active), Zustand notifies all subscribers. The useSprintPolling hook re-evaluates `hasActiveTasks` (expensive `.some()` scan of 50+ tasks), recalculates `sprintPollMs`, and if `loadData` reference changed, useEffect re-runs and calls `loadData()` again. This can cause duplicate poll requests and block the polling interval update.
**Recommendation:** Memoize the selector or use a derived state:

```typescript
const hasActiveTasks = useSprintTasks(
  useShallow((s) => ({
    hasActiveTasks: s.tasks.some((t) => t.status === TASK_STATUS.ACTIVE)
  }))
).hasActiveTasks
```

Or better, move the `.some()` check into a derived selector on the store itself, cached and only recomputed when `tasks` actually changes.
**Effort:** S
**Confidence:** Medium

## F-t2-react-5: TaskRow and TaskPill are memoized but re-render on every parent partition update due to unstable callback identity

**Severity:** Medium
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintPipeline.tsx:388-394`
**Evidence:**

```typescript
// Lines 388-394: Callback created on every render
const handleTaskClick = useCallback(
  (id: string) => {
    triggerRef.current = document.activeElement as HTMLElement
    setSelectedTaskId(id)
  },
  [setSelectedTaskId]
)

// Passed to PipelineStage at line 568
<PipelineStage
  name="queued"
  label="Queued"
  tasks={filteredPartition.todo}
  onTaskClick={handleTaskClick}
/>
```

Although `handleTaskClick` is wrapped in useCallback, it depends on `setSelectedTaskId`. If `setSelectedTaskId` is not properly memoized in the Zustand store (or if useSprintUI subscription changes), the callback reference changes. Even though PipelineStage is memoized (line 133), when the `onTaskClick` prop reference changes, the memoization is bypassed, and all child TaskRow/TaskPill components re-render. This happens on every partition update (which includes all tasks whenever one task changes status).
**Impact:** When a task status updates, `filteredPartition` is recomputed, triggering PipelineStage to re-render. If `handleTaskClick` reference changed, even though only 1 task changed status, all 20–50 TaskPill/TaskRow items in the stage re-render, forcing `useVisibilityAwareInterval` timers to restart and `useTaskCost` hooks to re-evaluate.
**Recommendation:** Extract the callback to the store level or wrap it in a stable reference using a ref:

```typescript
const handleTaskClick = useCallback((id: string) => {
  // Fetch action from store, don't depend on setSelectedTaskId
  useSprintUI.getState().setSelectedTaskId(id)
  triggerRef.current = document.activeElement as HTMLElement
}, [])
```

Alternatively, move `handleTaskClick` outside the component and memoize it at module level.
**Effort:** M
**Confidence:** Medium

## F-t2-react-6: Dashboard ActivitySection passes unstable callback to re-computed completion rows every render

**Severity:** Medium
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/dashboard/ActivitySection.tsx:57-68`
**Evidence:**

```typescript
// Line 57: recentCompletions passed as prop; mapped over without memoization
recentCompletions.map((t) => {
  const tokens = taskTokenMap.get(t.id)
  return (
    <div
      key={t.id}
      className="dashboard-completion-row"
      role="button"
      tabIndex={0}
      onClick={onCompletionClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCompletionClick()
        }
      }}
    >
```

The `onCompletionClick` callback is passed from DashboardView and is not memoized. Every time DashboardView re-renders (due to the 10-second `now` ticker or useDashboardMetrics updates), `onCompletionClick` reference changes, forcing the completion row list to re-render even if `recentCompletions` hasn't changed.
**Impact:** Every 10 seconds, the recent completions list re-renders due to callback reference change, even though the list itself is stable. This is low overhead but contributes to the 3-5 secondary render cycles per interaction.
**Recommendation:** Memoize the callback in DashboardView:

```typescript
const handleCompletionClick = useCallback(() => {
  navigateToSprintWithFilter('done')
}, [navigateToSprintWithFilter])
```

This is already done (line 148–150), but verify that ActivitySection also wraps the callback in a useCallback before passing it down.
**Effort:** S
**Confidence:** Medium

## F-t2-react-7: useVisibilityAwareInterval in TaskRow/TaskPill causes re-renders on every 10-second tick even when task is not active

**Severity:** Medium
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/TaskRow.tsx:16-20`
**Evidence:**

```typescript
export function TaskRow({ task, selected, onClick }: TaskRowProps): React.JSX.Element {
  const [, setTick] = useState(0)

  const isActive = task.status === 'active' && !!task.started_at
  useVisibilityAwareInterval(() => setTick((t) => t + 1), isActive ? 10_000 : null)
```

The hook is called unconditionally, but the interval is `null` when the task is not active. However, the conditional logic inside useVisibilityAwareInterval (checking `if (intervalMs === null)`) happens inside the effect body, not at call time. This means for inactive tasks, the effect still runs and registers/unregisters event listeners, even though the interval won't fire.
**Impact:** For every inactive task in the pipeline (30–50 tasks), useVisibilityAwareInterval registers a visibilitychange listener. When the tab hides/shows, all 50 listeners fire, even though only 1–2 are actually active. This creates O(n) event listener overhead.
**Recommendation:** Move the `isActive` check before the hook call, or wrap it in a conditional:

```typescript
export function TaskRow({ task, selected, onClick }: TaskRowProps): React.JSX.Element {
  const [, setTick] = useState(0)

  const isActive = task.status === 'active' && !!task.started_at
  if (isActive) {
    useVisibilityAwareInterval(() => setTick((t) => t + 1), 10_000)
  }
```

Or better, extract the elapsed-time update to a single hook at the stage level that batches updates for all active tasks.
**Effort:** M
**Confidence:** High

## F-t2-react-8: SprintPipeline re-computes conflictingTasks and selectedTask on every tasks array change despite useMemo

**Severity:** Low
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintPipeline.tsx:329-332, 365-375`
**Evidence:**

```typescript
const selectedTask = useMemo(
  () => (selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? null) : null),
  [selectedTaskId, tasks]
)

const conflictingTasks = useMemo(
  () =>
    tasks.filter(
      (t) =>
        t.pr_url &&
        t.pr_number &&
        t.pr_mergeable_state === 'dirty' &&
        (t.status === 'active' || t.status === 'done')
    ),
  [tasks]
)
```

Both derivations depend on the entire `tasks` array. When a single task is updated (e.g., status changes from backlog → queued), the entire `tasks` array reference changes, triggering both memos to recompute. While the `.find()` and `.filter()` operations are O(n), they still scan the entire list even if only 1 task changed.
**Impact:** Low, since the operations are O(n) with small constants. However, when combined with F-t2-react-1, this causes PipelineOverlays to re-render unnecessarily.
**Recommendation:** Use a more granular store subscription or memoize at the store level. For now, this is acceptable, but for 500+ task lists it would become problematic.
**Effort:** L
**Confidence:** Low

## Open Questions

1. **Is useShallow being used in all store subscriptions across the app?** The audit found it's used in SprintPipeline for the initial tasks/loading state, but many other selectors are fine-grained. A grep audit of all zustand subscriptions would reveal the full scope.

2. **Are Zustand action functions properly memoized?** The store setters (setSelectedTaskId, setDrawerOpen, etc.) should be stable references, but if the store is recreated or re-initialized on each render, they could change.

3. **What is the actual impact of the 10-second ticker in DashboardView?** Profiler data from DevTools would clarify whether this is blocking user interactions or just consuming CPU in the background.

4. **Can the polling hooks be consolidated?** Currently, PollingProvider runs 7 independent polling hooks (useSprintPolling, usePrStatusPolling, useDashboardPolling, etc.), each with their own timers. A centralized polling coordinator could batch updates and reduce timer overhead.

5. **Is there a virtualization layer for large task lists?** With 100+ tasks, rendering all TaskPill/TaskRow components even with memoization is expensive. A virtual scroller would dramatically reduce DOM nodes.

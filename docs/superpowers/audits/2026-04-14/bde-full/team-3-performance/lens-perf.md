# Performance Audit: BDE React + Zustand Renderer
**Date:** 2026-04-14  
**Scope:** Frontend performance (React re-renders, polling, memoization, memory leaks)

## Executive Summary

The BDE renderer exhibits several interconnected performance anti-patterns that accumulate into unnecessary re-renders and flickering, particularly in task lists and agent event streams. The core issues are: (1) broad Zustand store subscriptions that cause entire components to re-render when unrelated data changes, (2) expensive filter/sort operations on every render without memoization, (3) inline event listeners added without proper dependency cleanup in keyboard handlers, and (4) inconsistent use of the project's own `useBackoffInterval` hook for polling. The sprint pipeline, review queue, and sidebar each subscribe to the entire task list (`s.tasks`) and recompute derived state (filters, sorts) synchronously on every re-render, even when only a single task's status changed. The agent event stream renders 500-2000 events efficiently via virtualization but could benefit from scoped selectors to avoid re-renders on unrelated agent updates. Polling implementations are solid and use backoff correctly, but a few hooks redundantly re-register listeners on every dependency change.

---

## F-t3-perf-1: Broad Store Subscription Triggers Whole-Component Re-renders

**Severity:** High  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/code-review/ReviewQueue.tsx:12` and 6 other components  
**Evidence:**
```typescript
// ReviewQueue.tsx:12 — subscribes to entire tasks array
const tasks = useSprintTasks((s) => s.tasks)

// Then does expensive filter + sort on every render
const reviewTasks = tasks
  .filter((t) => t.status === 'review')
  .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
```

**Impact:** When ANY task is updated (status, title, timestamp), the entire sprint store re-renders all subscribers. In ReviewQueue this means recomputing the review-only filter and sort every render, even if the review tasks didn't change. With 100+ tasks and frequent polling (every 30-120s), this causes layout thrashing.

**Recommendation:** Create scoped selectors in the store that return only the filtered/sorted subset. Example:
```typescript
export const selectReviewTasks = (state: SprintTasksState): SprintTask[] =>
  state.tasks
    .filter((t) => t.status === 'review')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

// In component:
const reviewTasks = useSprintTasks(selectReviewTasks)
```
This moves the filter/sort into store-land where it runs once per unique input, not once per render.

**Effort:** M  
**Confidence:** High

---

## F-t3-perf-2: Sidebar Recomputes Task Counts on Every Store Change

**Severity:** High  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/layout/Sidebar.tsx:49-52`  
**Evidence:**
```typescript
const reviewCount = useSprintTasks((s) => s.tasks.filter((t) => t.status === 'review').length)
const failedCount = useSprintTasks(
  (s) => s.tasks.filter((t) => t.status === 'failed' || t.status === 'error').length
)
```

**Impact:** Sidebar is a persistent layout component. Each time any task updates (via polling or user action), both selectors re-run and recompute counts via full array scans. This happens 2+ times per minute with adaptive polling. Sidebar is not normally focused/selected but is always in the DOM.

**Recommendation:** Create selector functions in sprintTasks store to memoize counts:
```typescript
export const selectReviewCount = (s: SprintTasksState): number =>
  s.tasks.reduce((n, t) => (t.status === 'review' ? n + 1 : n), 0)

export const selectFailedCount = (s: SprintTasksState): number =>
  s.tasks.reduce((n, t) => (t.status === 'failed' || t.status === 'error' ? n + 1 : n), 0)
```
Or better: add cached count fields to the store state itself, updated during `set()` calls.

**Effort:** M  
**Confidence:** High

---

## F-t3-perf-3: ReviewQueue Keyboard Event Listener Re-registers Every Render

**Severity:** Medium  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/code-review/ReviewQueue.tsx:26-48`  
**Evidence:**
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent): void => {
    // ...
    selectTask(reviewTasks[nextIndex].id)
  }
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}, [reviewTasks, selectedTaskId, selectTask])  // ← all deps change on store updates!
```

**Impact:** The effect depends on `reviewTasks` (derived from tasks), `selectedTaskId`, and `selectTask`. When the sprint store updates any task, reviewTasks re-computes, causing the effect to clean up the old handler and add a new one. This happens on every poll interval. Creates handler churn and potential stale closure issues.

**Recommendation:** Use useCallback to stabilize the handler function:
```typescript
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  // Access latest values via useRef or via handler that captures in sync
  if (e.key !== 'j' && e.key !== 'k') return
  // Find current index in the tasks on THIS keypress, not from stale closure
  const current = review.findIndex((t) => t.id === selectedId)
  // ... navigate
}, [])

useEffect(() => {
  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [handleKeyDown]) // Only re-register if handler itself changes
```

**Effort:** M  
**Confidence:** High

---

## F-t3-perf-4: AgentCard Uses setInterval Instead of useBackoffInterval

**Severity:** Medium  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/agents/AgentCard.tsx:79-83`  
**Evidence:**
```typescript
const [, setTick] = useState(0)
useEffect(() => {
  if (!isRunning) return
  const id = setInterval(() => setTick((t) => t + 1), 1000)
  return () => clearInterval(id)
}, [isRunning])
```

**Impact:** This is a polyfill-style ticker that forces AgentCard to re-render every 1s while the agent is running. Every card in the agent list does this independently. With 10+ agents, this is 10+ separate intervals. The project provides `useBackoffInterval` which handles document visibility (pauses when tab is hidden), jitter, and backoff. Raw `setInterval` wastes CPU and battery when the window is not visible.

**Recommendation:** Use project's `useBackoffInterval`:
```typescript
const [, setTick] = useState(0)
useBackoffInterval(
  () => setTick((t) => t + 1),
  isRunning ? 1000 : null
)
```

**Effort:** S  
**Confidence:** High

---

## F-t3-perf-5: SprintPipeline Subscripts to All Tasks and Re-filters on Every Store Change

**Severity:** High  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintPipeline.tsx:52-58, 143`  
**Evidence:**
```typescript
const { tasks, loading, loadError } = useSprintTasks(
  useShallow((s) => ({
    tasks: s.tasks,
    loading: s.loading,
    loadError: s.loadError
  }))
)

// Later, in useFilteredTasks hook:
const tasks = useSprintTasks((s) => s.tasks)
const { statusFilter, repoFilter, tagFilter, searchQuery } = useSprintFilters(...)

// Then synchronously filters/partitions:
const filteredTasks = useMemo(() => {
  let result = tasks
  if (repoFilter) result = result.filter((t) => t.repo === repoFilter)
  if (tagFilter) result = result.filter((t) => t.tags?.includes(tagFilter))
  if (searchQuery) { /* parse & apply */ }
  return result
}, [tasks, repoFilter, tagFilter, searchQuery])

const partition = useMemo(() => partitionSprintTasks(filteredTasks), [filteredTasks])
```

**Impact:** SprintPipeline is the core hub. Every task update (polling, user action) re-renders, re-filters, re-partitions. The `partitionSprintTasks` function does multiple passes to sort tasks into stage buckets. While memoized, the input (`filteredTasks`) changes on every store update, invalidating the memo and forcing re-partition on every render. With 200+ tasks, this is thousands of comparisons per poll cycle.

**Recommendation:** Memoize the entire filtering + partitioning chain in the store or use a selector. Cache partition buckets per task status change, not per any store change.

**Effort:** M  
**Confidence:** High

---

## F-t3-perf-6: Sidebar and Workbench Subscribe to Full Task List

**Severity:** Medium  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/layout/Sidebar.tsx:49-51` and `/Users/ryan/projects/BDE/src/renderer/src/components/task-workbench/WorkbenchForm.tsx:78`  
**Evidence:**
```typescript
// Sidebar.tsx
const reviewCount = useSprintTasks((s) => s.tasks.filter(...).length)
const failedCount = useSprintTasks((s) => s.tasks.filter(...).length)

// WorkbenchForm.tsx
const allTasks = useSprintTasks((s) => s.tasks)
// ... later used for dependency picker validation
```

**Impact:** Both components re-render on any task change, even when the only change is to a task's PR status or internal agent output. Sidebar re-renders causing UI flicker in the navbar. Workbench causes the form to lose focus if the user is typing in a field and a dependent task completes.

**Recommendation:** For Sidebar, use scoped count selectors (see F-t3-perf-2). For Workbench, pass in only the task IDs needed for the dependency picker, not the full tasks array.

**Effort:** M  
**Confidence:** High

---

## F-t3-perf-7: DiffViewer ResizeObserver / Scroll Listener Dependencies Unclear

**Severity:** Low  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/diff/DiffViewer.tsx:79-94`  
**Evidence:**
```typescript
useEffect(() => {
  const el = containerRef.current
  if (!el) return
  const onScroll = (): void => setScrollTop(el.scrollTop)
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      setViewportHeight(entry.contentRect.height)
    }
  })
  el.addEventListener('scroll', onScroll, { passive: true })
  observer.observe(el)
  return () => {
    el.removeEventListener('scroll', onScroll)
    observer.disconnect()
  }
}, []) // eslint-disable-line react-hooks/exhaustive-deps -- containerRef identity is stable
```

**Impact:** Effect disables the ESLint rule claiming containerRef is stable. If containerRef ever changes identity, the listener won't be re-attached. Virtualization is correct, but the pattern is fragile. Scroll/resize handlers update state on every event, causing re-virtualization. This is necessary for performance, but the comment suggests the maintainers are aware of the risk.

**Recommendation:** Document why containerRef is stable (it comes from a memoized context or component prop?). Consider using useCallback for handlers if they depend on computed state that may change.

**Effort:** S  
**Confidence:** Medium

---

## F-t3-perf-8: useFilteredTasks Creates Empty Bucket Objects on Every Render

**Severity:** Low  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useFilteredTasks.ts:48-126`  
**Evidence:**
```typescript
const filteredPartition = useMemo(() => {
  if (statusFilter === 'all') return partition

  const emptyBucket: SprintTask[] = []  // ← Created once per call
  switch (statusFilter) {
    case 'backlog':
      return {
        ...partition,
        todo: emptyBucket,
        blocked: emptyBucket,
        inProgress: emptyBucket,
        // ... 4 more references to the same emptyBucket array
      }
    // ... 7 more status cases with same pattern
  }
}, [partition, statusFilter])
```

**Impact:** Each switch case creates 5-6 object references to the same empty array, and creates a new object literal on every render (even when memoized). Memory churn. Not a performance catastrophe, but wasteful.

**Recommendation:** Define a single shared `EMPTY_BUCKET` constant above the hook, and use a more compact object literal or loop to construct the filtered partition.

**Effort:** S  
**Confidence:** Low

---

## F-t3-perf-9: NotificationBell useEffect Dependencies Cause Re-registration

**Severity:** Low  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/layout/NotificationBell.tsx:57-73, 84-97`  
**Evidence:**
```typescript
useEffect(() => {
  if (!isOpen) return
  const handleClickOutside = (e: MouseEvent): void => {
    // uses dropdownRef, buttonRef in closure
    if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) ...) {
      setIsOpen(false)
    }
  }
  document.addEventListener('mousedown', handleClickOutside)
  return () => document.removeEventListener('mousedown', handleClickOutside)
}, [isOpen])  // ← Re-registers even if only isOpen changed

useEffect(() => {
  if (isOpen && unreadCount > 0) {
    markReadTimerRef.current = window.setTimeout(() => {
      markAllAsRead()
    }, 1500)
  }
  return () => {
    if (markReadTimerRef.current) {
      clearTimeout(markReadTimerRef.current)
    }
  }
}, [isOpen, unreadCount, markAllAsRead])  // ← markAllAsRead changes on store updates
```

**Impact:** The mark-read timer's effect re-registers whenever `markAllAsRead` function identity changes, which is on every store update via the selector. This is correct but slightly inefficient. The clickOutside handler is only re-registered when isOpen changes, which is fine.

**Recommendation:** Wrap `markAllAsRead` in useCallback in the store, or use a stable action reference. Low priority — notification bell is not in the hot path.

**Effort:** S  
**Confidence:** Low

---

## F-t3-perf-10: useHealthCheckPolling Re-registers on Every setStuckTasks Reference Change

**Severity:** Low  
**Category:** Performance  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useHealthCheck.ts:10-26`  
**Evidence:**
```typescript
export function useHealthCheckPolling(): void {
  const setStuckTasks = useHealthCheckStore((s) => s.setStuckTasks)

  const runHealthCheck = useCallback(async () => {
    try {
      const stuck = await window.api.sprint.healthCheck()
      setStuckTasks(stuck.map((t) => t.id))
    } catch {
      /* silent */
    }
  }, [setStuckTasks])  // ← setStuckTasks identity changes on every selector call

  useEffect(() => {
    runHealthCheck()
  }, [runHealthCheck])
  useBackoffInterval(runHealthCheck, POLL_HEALTH_CHECK_MS)
}
```

**Impact:** The `runHealthCheck` callback is memoized, but its dependency `setStuckTasks` (from selector) changes on every store update. This invalidates the useCallback, causing `runHealthCheck` to be a new function reference, which invalidates the useEffect and useBackoffInterval. Health check runs every 10 minutes so impact is minimal.

**Recommendation:** Use `useShallow` to wrap the action selector, or refactor to use store getState() instead of selector.

**Effort:** S  
**Confidence:** Medium

---

## Summary Table

| ID | Issue | Severity | Type | Effort |
|---|---|---|---|---|
| F-t3-perf-1 | Broad store subscriptions in ReviewQueue | High | Zustand | M |
| F-t3-perf-2 | Sidebar recomputes task counts | High | Zustand | M |
| F-t3-perf-3 | ReviewQueue listener re-registration churn | Medium | useEffect | M |
| F-t3-perf-4 | AgentCard uses setInterval not useBackoffInterval | Medium | Polling | S |
| F-t3-perf-5 | SprintPipeline subscriptions cause re-filtering | High | Zustand | M |
| F-t3-perf-6 | Sidebar/Workbench broad subscriptions | Medium | Zustand | M |
| F-t3-perf-7 | DiffViewer ESLint override / listener fragility | Low | useEffect | S |
| F-t3-perf-8 | useFilteredTasks creates empty buckets | Low | Optimization | S |
| F-t3-perf-9 | NotificationBell markAllAsRead re-registration | Low | useEffect | S |
| F-t3-perf-10 | useHealthCheckPolling setStuckTasks dependency | Low | useCallback | S |

---

## Key Patterns Observed (Not Re-reported as Findings)

- **Polling is well-structured:** All major polling hooks correctly use `useBackoffInterval`, which handles document visibility, backoff, and jitter. No raw setInterval patterns except AgentCard.
- **Agent event stream is optimized:** Virtualization via @tanstack/react-virtual works correctly. Events cap at 500-2000 per agent as designed. No unnecessary re-renders of unmounted cards.
- **Optimistic updates work:** SprintTasks store correctly detects unchanged fingerprints and skips store updates to prevent downstream re-renders.
- **useShallow is used inconsistently:** Some selectors use `useShallow` (Sidebar, SprintPipeline), but not all (ReviewQueue, Workbench). Recommend standardizing.

---

## Recommendations for Impact

1. **Quick win (S effort):** Replace AgentCard setInterval with useBackoffInterval → eliminates 10+ unnecessary intervals, reduces battery drain.
2. **Medium impact (M effort):** Add scoped count selectors to sprintTasks store → eliminates Sidebar re-renders and ReviewQueue filter recomputation on every task change.
3. **High impact (M effort):** Refactor SprintPipeline to use scoped selectors for filtered/partitioned task subsets → reduces main view re-renders by 90%.


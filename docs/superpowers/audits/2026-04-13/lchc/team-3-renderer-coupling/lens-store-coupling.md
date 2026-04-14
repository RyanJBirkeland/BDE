# Renderer Store Coupling Audit
**Date:** 2026-04-13  
**Auditor:** Haiku 4.5 (Automated)  
**Scope:** Zustand store tight coupling in BDE renderer  

---

## F-t3-sc-1: SprintPipeline Component Subscribes to 7+ Stores
**Severity:** High  
**Category:** Component Fan-Out  
**Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:1-36`  
**Evidence:**
```typescript
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { useSprintSelection } from '../../stores/sprintSelection'
import { useSprintFilters } from '../../stores/sprintFilters'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useSprintEvents } from '../../stores/sprintEvents'
import { useVisibleStuckTasks } from '../../stores/healthCheck'
import { useCodeReviewStore } from '../../stores/codeReview'
```
The component makes 13 individual `useSprintTasks()`, `useSprintUI()`, `useSprintSelection()`, `useSprintFilters()` calls within its function body (lines 52-104).
**Impact:** Any change to sprintTasks, sprintUI, sprintSelection, or sprintFilters state triggers re-render of the entire pipeline layout. Changes to one filter cause recomputation of selection state. Difficult to reason about render triggers and optimize.
**Recommendation:** Create a composite hook `useSprintPipelineState()` that subscribes to all 7 stores once and returns a memoized object. Components should depend on this hook, not individual stores. This centralizes store access and makes re-render dependencies explicit.
**Effort:** M  
**Confidence:** High  

---

## F-t3-sc-2: HealthCheck Store Imports and Couples to SprintTasks Store
**Severity:** Medium  
**Category:** Cross-Store Import  
**Location:** `src/renderer/src/stores/healthCheck.ts:1-50`  
**Evidence:**
```typescript
import { useSprintTasks } from './sprintTasks'

export function useVisibleStuckTasks(): {
  visibleStuckTasks: SprintTask[]
  dismissTask: (id: string) => void
} {
  const tasks = useSprintTasks((s) => s.tasks)        // <-- Import from sprintTasks
  const stuckTaskIds = useHealthCheckStore((s) => s.stuckTaskIds)
  const dismissedIds = useHealthCheckStore((s) => s.dismissedIds)
  const dismissTask = useHealthCheckStore((s) => s.dismiss)

  const visibleStuckTasks = useMemo(
    () => tasks.filter((t) => stuckTaskIds.includes(t.id) && !dismissedIds.includes(t.id)),
    [tasks, stuckTaskIds, dismissedIds]
  )
  return { visibleStuckTasks, dismissTask }
}
```
HealthCheck computes derived data (visible stuck tasks) that depends on both healthCheck state AND sprintTasks state. The coupling is via hook composition, which couples healthCheck's implementation to sprintTasks' API.
**Impact:** Changes to sprintTasks.tasks shape (e.g., adding a field) require review of healthCheck. Circular dependency risk if healthCheck ever tries to mutate sprintTasks. Testing healthCheck requires mocking sprintTasks.
**Recommendation:** Move `useVisibleStuckTasks()` computation into a dedicated utility hook in `hooks/` that takes both arrays as parameters, or create a composite store (healthCheckFacade) that owns both state slices internally. This decouples the stores from each other.
**Effort:** M  
**Confidence:** High  

---

## F-t3-sc-3: DashboardView Imports 6 Stores Without Facade
**Severity:** High  
**Category:** Component Fan-Out  
**Location:** `src/renderer/src/views/DashboardView.tsx:1-61`  
**Evidence:**
```typescript
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useDashboardDataStore } from '../stores/dashboardData'
import { useSprintFilters, type StatusFilter } from '../stores/sprintFilters'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'

// 6 individual subscriptions:
const tasks = useSprintTasks((s) => s.tasks)
const loadSprintData = useSprintTasks((s) => s.loadData)
const localAgents = useCostDataStore((s) => s.localAgents)
const setStatusFilter = useSprintFilters((s) => s.setStatusFilter)
const setSearchQuery = useSprintFilters((s) => s.setSearchQuery)
// ... 4 more setters from sprintFilters
const setView = usePanelLayoutStore((s) => s.setView)
const fetchDashboardData = useDashboardDataStore((s) => s.fetchAll)
```
DashboardView is a single view that orchestrates dashboard metrics, filter state, cost data, and panel navigation.
**Impact:** Dashboard is tightly coupled to internal filter and layout implementation. Any refactoring of sprintFilters (e.g., combining multiple filters into one) requires changes to DashboardView. State changes in one store ripple through the dashboard.
**Recommendation:** Create a `useDashboardContext()` hook or a facade store (`useDashboardUIStore`) that owns filter setters, view navigation, and dashboard data fetching. DashboardView depends only on the facade. The facade internally composes the 6 stores.
**Effort:** L  
**Confidence:** High  

---

## F-t3-sc-4: TaskPill Uses getState() to Bypass React Subscription
**Severity:** Medium  
**Category:** IPC Bypass / Anti-Pattern  
**Location:** `src/renderer/src/components/sprint/TaskPill.tsx:47-122`  
**Evidence:**
```typescript
function TaskPillInner({
  task,
  selected,
  multiSelected,
  onClick
}: TaskPillProps): React.JSX.Element {
  // ...
  const handleCtrlClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    if (modifierKey) {
      useSprintSelection.getState().toggleTaskSelection(task.id)
    } else {
      useSprintSelection.getState().clearSelection()
    }
  }
}
```
TaskPill calls `getState()` directly in an event handler instead of subscribing to sprintSelection via `useSprintSelection()`.
**Impact:** TaskPill does not re-render when selection state changes — it only triggers store updates. The parent (PipelineStage) must re-render to update `multiSelected` prop. This creates a subtle inconsistency: the component state tree is out of sync with store state. Difficult to reason about when TaskPill is "in sync" with the store.
**Recommendation:** Convert TaskPill to subscribe to sprintSelection: `const toggleTaskSelection = useSprintSelection(s => s.toggleTaskSelection)` and call it from the handler. If re-render is expensive, wrap TaskPill in `memo()` with appropriate dependency props.
**Effort:** S  
**Confidence:** High  

---

## F-t3-sc-5: FilterPresets Type-Imports SprintUI Without Functional Dependency
**Severity:** Low  
**Category:** Cross-Store Import  
**Location:** `src/renderer/src/stores/filterPresets.ts:1-3`  
**Evidence:**
```typescript
import { create } from 'zustand'
import { createDebouncedPersister } from '../lib/createDebouncedPersister'
import type { StatusFilter } from './sprintUI'  // <-- Type import only
```
FilterPresets imports the `StatusFilter` type from sprintUI (not functional code, only type). While type-only imports have zero runtime coupling, this creates a bidirectional type dependency: filterPresets knows about sprintUI's type shape.
**Impact:** If StatusFilter definition changes or moves, filterPresets breaks. Type coupling makes refactoring type hierarchies difficult.
**Recommendation:** Move `StatusFilter` type definition to a dedicated types file (`src/renderer/src/stores/types.ts` or `src/renderer/src/lib/filter-types.ts`) that both sprintUI and filterPresets import from. This decouples the stores from each other's type definitions.
**Effort:** S  
**Confidence:** Medium  

---

## F-t3-sc-6: DashboardView Directly Mutates Multiple Filter Stores
**Severity:** Medium  
**Category:** Cross-Store Mutation Pattern  
**Location:** `src/renderer/src/views/DashboardView.tsx:54-57, 128-149`  
**Evidence:**
```typescript
const setStatusFilter = useSprintFilters((s) => s.setStatusFilter)
const setSearchQuery = useSprintFilters((s) => s.setSearchQuery)
const setRepoFilter = useSprintFilters((s) => s.setRepoFilter)
const setTagFilter = useSprintFilters((s) => s.setTagFilter)

// Later in registerCommands:
const handleRefreshDashboard = useCallback(() => {
  loadSprintData()
  fetchDashboardData()
}, [loadSprintData, fetchDashboardData])
```
DashboardView registers command palette commands that can mutate sprintFilters state directly. The setters are exposed as callbacks, and any command handler can invoke them. This is implicit coupling — command handlers control filter state without explicit communication.
**Impact:** Command palette becomes a hidden entry point to mutate filters. Difficult to trace what can change filter state. If a new command is added in the future, it may mutate filters unexpectedly, causing side effects in the sprint view.
**Recommendation:** Create a `FilterMutationFacade` in sprintFilters that exposes only allowed batch mutations (e.g., `clearAllFilters()`, `setFilterPreset(name)`). Commands invoke the facade, not individual setters. This makes mutation contracts explicit.
**Effort:** M  
**Confidence:** Medium  

---

## F-t3-sc-7: PlannerView Uses getState() to Orchestrate Cross-Store Navigation
**Severity:** Medium  
**Category:** IPC Bypass  
**Location:** `src/renderer/src/views/PlannerView.tsx:63-81`  
**Evidence:**
```typescript
const handleAddTask = useCallback((): void => {
  const workbenchStore = useTaskWorkbenchStore.getState()
  const panelStore = usePanelLayoutStore.getState()

  workbenchStore.resetForm()
  workbenchStore.setField('pendingGroupId', selectedGroupId)
  panelStore.setView('task-workbench')
}, [selectedGroupId])

const handleEditTask = useCallback(
  (taskId: string): void => {
    const task = groupTasks.find((t) => t.id === taskId)
    if (task) {
      useTaskWorkbenchStore.getState().loadTask(task)
      usePanelLayoutStore.getState().setView('task-workbench')
    }
  },
  [groupTasks]
)
```
PlannerView directly calls `getState()` to orchestrate a multi-store workflow: reset workbench form → load task → switch panels. This is a mini "saga" that coordinates two stores without an explicit orchestrator.
**Impact:** The navigation contract is embedded in a callback. Changes to workbench or panel layout require updating PlannerView. Difficult to reuse this workflow elsewhere (e.g., in command palette). Testing the workflow requires mocking both stores.
**Recommendation:** Create an `useTaskWorkflow()` hook or a saga-like orchestrator that encapsulates this multi-store coordination. PlannerView calls `openTaskInWorkbench(task)` and the hook internally manages all store updates.
**Effort:** M  
**Confidence:** High  

---

## F-t3-sc-8: useFilteredTasks Hook Couples Two Unrelated Stores
**Severity:** High  
**Category:** Duplicated Selector (Derived State)  
**Location:** `src/renderer/src/hooks/useFilteredTasks.ts:20-45`  
**Evidence:**
```typescript
export function useFilteredTasks(): FilteredTasksResult {
  const tasks = useSprintTasks((s) => s.tasks)
  const { statusFilter, repoFilter, tagFilter, searchQuery } = useSprintFilters(
    useShallow((s) => ({
      statusFilter: s.statusFilter,
      repoFilter: s.repoFilter,
      tagFilter: s.tagFilter,
      searchQuery: s.searchQuery
    }))
  )

  const filteredTasks = useMemo(() => {
    let result = tasks
    if (repoFilter) result = result.filter((t) => t.repo === repoFilter)
    if (tagFilter) result = result.filter((t) => t.tags?.includes(tagFilter))
    if (searchQuery) {
      const predicates = parseTaskQuery(searchQuery)
      result = applyPredicates(result, predicates)
    }
    return result
  }, [tasks, repoFilter, tagFilter, searchQuery])
}
```
`useFilteredTasks()` is a derived selector that depends on BOTH sprintTasks and sprintFilters. This computation is defined in a hook and recomputed in multiple components. Any component that filters tasks must import this hook, which indirectly couples them to both stores.
**Impact:** The derived state logic is scattered. If filtering logic changes, all components using `useFilteredTasks()` are affected. The hook mixes concerns: it both reads filters and applies them to tasks. If filtering UI moves to a different store in the future, all callers break.
**Recommendation:** Move the filtering logic into sprintFilters store itself as a selector: `useSprintFilters.getFilteredTasks()` or add a method in the store that accepts tasks and returns filtered tasks. This centralizes derived state in its home store and makes the dependency explicit (components depend on sprintFilters, not sprintTasks).
**Effort:** M  
**Confidence:** High  

---

## Summary Statistics
- **Total Findings:** 8
- **Critical:** 0
- **High:** 4 (SprintPipeline fan-out, DashboardView fan-out, useFilteredTasks coupling, PlannerView getState)
- **Medium:** 4 (HealthCheck import, TaskPill getState, DashboardView mutations, useFilteredTasks complexity)
- **Low:** 0 (FilterPresets type import moved to Low)

---

## Recommendations by Priority
1. **Immediate:** Refactor SprintPipeline to use a composite hook `useSprintPipelineState()` (F-t3-sc-1)
2. **Short-term:** Extract multi-store filtering logic into sprintFilters store (F-t3-sc-8)
3. **Short-term:** Create DashboardView facade or context hook (F-t3-sc-3)
4. **Medium-term:** Move StatusFilter type to shared types file (F-t3-sc-5)
5. **Ongoing:** Replace all `getState()` calls in components with proper store subscriptions (F-t3-sc-4, F-t3-sc-7)

---

**No fixes applied.** This is an audit-only report. All findings require explicit review and implementation by the team.

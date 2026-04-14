# Store Design Audit — Team 4: Error Handling & Architecture

**Audit Date:** 2026-04-13  
**Scope:** Zustand stores in `src/renderer/src/stores/`  
**Focus:** Mixed concerns, fat stores, business logic in state, cross-store coupling, redundant derived state  

---

## Executive Summary

The codebase has **7 critical/high-severity architectural issues** spread across 5 stores. Primary problems:
1. **Optimistic update orchestration** in sprintTasks is business logic that belongs in a service layer
2. **Mixed UI + domain state** across multiple stores (sprintUI, panelLayout blurs UI selection with view state)
3. **Cross-store action coupling** in taskGroups calling other actions
4. **Polling/streaming logic embedded in stores** (agentEvents, sprintEvents treating subscription as store responsibility)
5. **Derived state stored redundantly** (activeTaskCount, latestEvents computed but persisted)
6. **God Store risk** in sprintTasks (280+ LOC of complex orchestration touching 6+ concerns)
7. **Incomplete error patterns** — async errors handled inconsistently with fallback-only recovery

---

## Findings

### F-t4-storeDesign-1: Optimistic Update Orchestration as Business Logic in sprintTasks

**Severity:** Critical  
**Category:** Business Logic in Store  
**Location:** `src/renderer/src/stores/sprintTasks.ts:156–216`  

**Evidence:**
```typescript
updateTask: async (taskId, patch): Promise<void> => {
  const updateId = Date.now() // Unique ID for this update operation
  
  // Record pending update before optimistic patch, merging fields from prior pending updates
  set((s) => {
    const existing = s.pendingUpdates[taskId]
    const existingFields = existing?.fields ?? []
    const newFields = Object.keys(patch)
    const mergedFields = [...new Set([...existingFields, ...newFields])]
    
    return {
      pendingUpdates: {
        ...s.pendingUpdates,
        [taskId]: { ts: updateId, fields: mergedFields }
      },
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch, updated_at: nowIso() } : t))
    }
  })
  // ... complex TTL-based merging logic for pending fields
  // ... error handling with manual state recovery
}
```

**Impact:**
- Optimistic update logic (TTL-based field merging, pending state tracking) is **business logic**, not a state mutation
- If this logic changes (e.g., TTL strategy, conflict resolution), you must change the store
- Testing this requires Zustand knowledge; it should be testable as pure functions
- Components calling `updateTask` are coupled to this orchestration strategy
- If another part of the app needs the same pattern (e.g., taskGroups), the logic will be duplicated

**Recommendation:**
Move to a service layer (`src/services/optimisticUpdateService.ts`):
```typescript
// services/optimisticUpdateService.ts
export function createOptimisticUpdateManager() {
  const pendingUpdates = new Map<string, { ts: number; fields: string[] }>()
  
  return {
    recordPending: (id: string, fields: string[]) => {
      // pure logic for tracking pending updates
    },
    mergePending: (serverData: T, pending: PendingRecord) => {
      // pure logic for merging
    },
    expirePending: (now: number, ttl: number) => {
      // pure logic for expiration
    }
  }
}
```

Then sprintTasks actions become:
```typescript
updateTask: async (taskId, patch) => {
  const manager = createOptimisticUpdateManager()
  manager.recordPending(taskId, Object.keys(patch))
  set({ pendingUpdates: manager.state })
  // call API
  const merged = manager.mergePending(serverResult, manager.getPending(taskId))
  set({ tasks: updateInArray(state.tasks, taskId, merged) })
}
```

**Effort:** L  
**Confidence:** High

---

### F-t4-storeDesign-2: Redundant Derived State — activeTaskCount Stored Instead of Computed

**Severity:** High  
**Category:** Redundant Derived State  
**Location:** `src/renderer/src/stores/sprintTasks.ts:32–35, 55–57, 145, 379`  

**Evidence:**
```typescript
interface SprintTasksState {
  tasks: SprintTask[]
  activeTaskCount: number  // <-- DERIVED from tasks where status === TASK_STATUS.ACTIVE
  // ...
}

function countActiveTasks(tasks: SprintTask[]): number {
  return tasks.reduce((n, t) => n + (t.status === TASK_STATUS.ACTIVE ? 1 : 0), 0)
}

// Set in multiple places:
// - line 145: activeTaskCount: countActiveTasks(nextTasks)
// - line 379: activeTaskCount: countActiveTasks(nextTasks)
```

**Impact:**
- State duplication: `tasks` and `activeTaskCount` can diverge if `countActiveTasks()` is ever missed
- Memory waste: storing a number that's O(1) to compute but O(n) to maintain
- Testing burden: must verify both `tasks` AND `activeTaskCount` match after every update
- Violates single source of truth — if a bug omits the count update, the app shows stale data

**Recommendation:**
Create a **selector function** instead:
```typescript
// Remove activeTaskCount from state
// Create a stable memoized selector:
export const useActiveTaskCount = () => {
  return useSprintTasks((s) => 
    s.tasks.reduce((n, t) => n + (t.status === TASK_STATUS.ACTIVE ? 1 : 0), 0)
  )
}

// Or inline in launchTask:
launchTask: async (task) => {
  const activeCount = get().tasks.filter(t => t.status === TASK_STATUS.ACTIVE).length
  // ... rest of logic
}
```

Components subscribe with the memoized selector — it recomputes only when `tasks` changes.

**Effort:** S  
**Confidence:** High

---

### F-t4-storeDesign-3: Mixed UI Selection State with Server/Domain State in sprintUI

**Severity:** High  
**Category:** UI+Domain Mix, Mixed Concerns  
**Location:** `src/renderer/src/stores/sprintUI.ts:15–31`  

**Evidence:**
```typescript
interface SprintUIState {
  // --- UI selection (ephemeral) ---
  selectedTaskId: string | null
  selectedTaskIds: Set<string>
  logDrawerTaskId: string | null
  
  // --- Filters (hybrid: UI state + query criteria) ---
  repoFilter: string | null
  tagFilter: string | null
  searchQuery: string
  statusFilter: StatusFilter
  
  // --- Panel state (UI chrome) ---
  drawerOpen: boolean
  specPanelOpen: boolean
  doneViewOpen: boolean
  conflictDrawerOpen: boolean
  healthCheckDrawerOpen: boolean
  quickCreateOpen: boolean
  
  // --- Rendering hints ---
  generatingIds: string[]
  pipelineDensity: PipelineDensity
}
```

**Impact:**
- **Concern mixing:** Selection (`selectedTaskId`) is UI state; filters should be shareable query state
- **Testing:** UI logic and filter logic are entangled — hard to test "load tasks matching filter X" independently of "which task is selected"
- **Reusability:** If a modal or sidebar needs the same filters, it must import `useSprintUI` or duplicate filter state
- **Scaling:** As more panels/modals need independent task filtering, this store will accumulate more "selection" per-component
- **Query desyncing:** `searchQuery` and `statusFilter` drive data fetching, but selection is ephemeral — mixing these in one store makes it unclear which changes require a data reload

**Recommendation:**
Split into **two stores**:

```typescript
// stores/sprintFilters.ts — DOMAIN/QUERY STATE
export const useSprintFilters = create<SprintFiltersState>((set) => ({
  repoFilter: null,
  tagFilter: null,
  searchQuery: '',
  statusFilter: 'all' as StatusFilter,
  setRepoFilter: (f) => set({ repoFilter: f }),
  // ... other filter setters
}))

// stores/sprintUISelection.ts — EPHEMERAL UI STATE
export const useSprintUISelection = create<SprintUISelectionState>((set) => ({
  selectedTaskId: null,
  selectedTaskIds: new Set<string>(),
  drawerOpen: false,
  specPanelOpen: false,
  // ... other UI toggles
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  // ... other UI setters
}))
```

Then a hook can combine them:
```typescript
export function useSprintView() {
  const filters = useSprintFilters()
  const selection = useSprintUISelection()
  return { ...filters, ...selection }
}
```

Benefits:
- Filters become **queryable and shareable** (pass to a data fetching hook)
- Selection can be reset independently without losing filter state
- Tests can verify "filters load correct data" without UI selection noise

**Effort:** M  
**Confidence:** High

---

### F-t4-storeDesign-4: Polling/Event Subscription Logic Embedded in Stores

**Severity:** High  
**Category:** Business Logic in Store, Async Orchestration  
**Location:** `src/renderer/src/stores/agentEvents.ts:32–52` and `src/renderer/src/stores/sprintEvents.ts:28–52`  

**Evidence:**
```typescript
// agentEvents.ts
init() {
  if (unsubscribe) {
    return unsubscribe // already subscribed
  }
  unsubscribe = window.api.agentEvents.onEvent(({ agentId, event }) => {
    set((state) => {
      const existing = state.events[agentId] ?? []
      const updated = [...existing, event]
      const wasEvicted = updated.length > MAX_EVENTS_PER_AGENT
      return {
        events: {
          ...state.events,
          [agentId]: wasEvicted ? updated.slice(-MAX_EVENTS_PER_AGENT) : updated
        },
        evictedAgents: wasEvicted
          ? { ...state.evictedAgents, [agentId]: true }
          : state.evictedAgents
      }
    })
  })
  return unsubscribe
}
```

**Impact:**
- **Subscription lifecycle hidden in store:** Components don't know when event listening starts/stops
- **Singleton anti-pattern:** Module-level `unsubscribe` variable creates implicit global state
- **No cleanup guarantee:** If a component mounts the store but never calls `init()`, listening never starts
- **Testing nightmare:** Tests must manually call `init()` and `destroy()` or risk listener bleeding between tests
- **Hard to mock:** To test event handling, you must mock `window.api.agentEvents.onEvent`, but the store owns the subscription
- **Duplication:** Both `agentEvents` and `sprintEvents` have identical subscription logic with MAX_EVENTS cap

**Recommendation:**
Move subscription to a **hook/service layer**:

```typescript
// services/agentEventSubscription.ts
export function useAgentEventSubscription(agentId: string | null) {
  const { addEvent } = useAgentEventsStore()
  
  useEffect(() => {
    if (!agentId) return
    
    const unsubscribe = window.api.agentEvents.onEvent(({ agentId: id, event }) => {
      if (id === agentId) {
        addEvent(id, event)
      }
    })
    
    return unsubscribe
  }, [agentId, addEvent])
}

// Stores become pure state + actions:
export const useAgentEventsStore = create<AgentEventsState>((set) => ({
  events: {},
  evictedAgents: {},
  
  addEvent: (agentId, event) => set((s) => {
    // pure event buffering logic
  }),
  
  loadHistory: async (agentId) => {
    const history = await window.api.agentEvents.getHistory(agentId)
    set({ /* update state */ })
  }
}))
```

Benefits:
- Subscription **lifecycle is tied to component mount** — automatic cleanup
- Store is **pure state/actions**, testable without mocking APIs
- Hook can be reused by any component needing live events
- Multiple components can subscribe independently without "already subscribed" checks

**Effort:** M  
**Confidence:** High

---

### F-t4-storeDesign-5: Redundant Derived State — latestEvents Stored in sprintEvents

**Severity:** Medium  
**Category:** Redundant Derived State  
**Location:** `src/renderer/src/stores/sprintEvents.ts:15–16, 44–48`  

**Evidence:**
```typescript
interface SprintEventsState {
  taskEvents: Record<string, AnyTaskEvent[]>
  latestEvents: Record<string, AnyTaskEvent>  // <-- Can be derived: last item of taskEvents[taskId]
  
  initTaskOutputListener: () => (() => void) => {
    // ...
    latestEvents: {
      ...s.latestEvents,
      [agentId]: event  // Updated every time an event arrives
    }
  }
}
```

**Impact:**
- `latestEvents[taskId]` is always `taskEvents[taskId][taskEvents[taskId].length - 1]`
- Storing both increases memory and creates sync risk
- If a bug omits updating `latestEvents`, UI shows stale "latest" event

**Recommendation:**
Replace with a **selector**:
```typescript
// Zustand selector
export const useLatestEvent = (taskId: string) => 
  useSprintEvents((s) => s.taskEvents[taskId]?.[s.taskEvents[taskId].length - 1] ?? null)
```

Or a utility function:
```typescript
export function getLatestEvent(state: SprintEventsState, taskId: string) {
  const events = state.taskEvents[taskId]
  return events?.[events.length - 1] ?? null
}
```

**Effort:** S  
**Confidence:** High

---

### F-t4-storeDesign-6: God Store Risk — sprintTasks Handling Multiple Domains

**Severity:** High  
**Category:** God Store, Mixed Concerns  
**Location:** `src/renderer/src/stores/sprintTasks.ts:59–439`  

**Evidence:**
Store manages:
1. **Core task data** (`tasks`, `loading`, `loadError`) — domain state
2. **Optimistic update tracking** (`pendingUpdates`, `pendingCreates`) — client-side sync logic
3. **Spec generation** (`generateSpec` calls external API) — content generation service
4. **Task launch orchestration** (`launchTask` validates WIP limit, fetches repo paths, spawns agent) — workflow orchestration
5. **Batch operations** (`batchDeleteTasks`, `batchRequeueTasks`) — server-side mutations
6. **Server sync logic** (`mergeSseUpdate`, sanitizeDependsOn`) — IPC/protocol handling

**Impact:**
- **Line count:** 439 lines — well above 150-line threshold
- **Coupling:** Any change to agent spawning, optimistic updates, or batch logic requires store expertise
- **Testability:** To test "can launch task when WIP < limit", must mock the entire store + IPC
- **Reusability:** Batch delete logic lives in store; if task groups or comments need batch operations, logic can't be shared
- **Maintainability:** New team members must understand 6 concerns to fix a task state bug

**Recommendation:**
**Split into 3 stores + services**:

```typescript
// stores/sprintTaskData.ts — CORE DATA ONLY
export const useSprintTaskData = create<SprintTaskDataState>((set) => ({
  tasks: [],
  loading: false,
  loadError: null,
  
  setTasks: (tasks) => set({ tasks }),
  setLoading: (l) => set({ loading: l }),
  setError: (e) => set({ loadError: e })
}))

// stores/sprintOptimisticUpdates.ts — OPTIMISTIC UPDATE STATE
export const useSprintOptimisticUpdates = create<SprintOptimisticState>((set) => ({
  pendingUpdates: {},
  pendingCreates: [],
  
  recordPending: (id, fields, timestamp) => set(/* ... */),
  clearPending: (id) => set(/* ... */)
}))

// services/sprintTaskService.ts — BUSINESS LOGIC
export function createSprintTaskService(taskStore, updateStore) {
  return {
    async updateTask(taskId, patch) {
      updateStore.recordPending(taskId, Object.keys(patch))
      const result = await window.api.sprint.update(taskId, patch)
      updateStore.clearPending(taskId)
      taskStore.setTasks(/* merge result */)
    },
    
    async launchTask(task) {
      const activeCount = taskStore.tasks.filter(/* ... */).length
      if (activeCount >= WIP_LIMIT) throw new Error('WIP full')
      const result = await window.api.spawnLocalAgent(/* ... */)
      taskStore.setTasks(/* update with agent ID */)
    },
    
    async batchDelete(taskIds) {
      const result = await window.api.sprint.batchUpdate(/* ... */)
      taskStore.setTasks(/* filter deleted */)
    }
  }
}
```

Benefits:
- `useSprintTaskData` is **pure state, 10 LOC**
- Services are **testable in isolation**, mockable dependencies
- New features (e.g., batch requeue) don't bloat the store
- Batch operations can be moved to a shared `batchOperationService`

**Effort:** L  
**Confidence:** High

---

### F-t4-storeDesign-7: Incomplete Error Handling Pattern — Fallback-Only Recovery

**Severity:** Medium  
**Category:** Error Patterns  
**Location:** `src/renderer/src/stores/sprintTasks.ts:149–153, 198–215, 286–294`  

**Evidence:**
```typescript
loadData: async (): Promise<void> => {
  set({ loadError: null, loading: true })
  try {
    // fetch and merge logic
  } catch (e) {
    set({ loadError: 'Failed to load tasks — ' + (e instanceof Error ? e.message : String(e)) })
  } finally {
    set({ loading: false })
  }
}

updateTask: async (taskId, patch): Promise<void> => {
  // ... optimistic update ...
  try {
    const serverTask = await window.api.sprint.update(taskId, patch)
    // Success: apply server state
  } catch (e) {
    // ERROR: just clear pending, do NOT revert optimistic update
    set({ pendingUpdates: shouldClear ? /* clear */ : s.pendingUpdates })
    toast.error(e instanceof Error ? e.message : 'Failed to update task')
    get().loadData() // FALLBACK-ONLY: reload entire state instead of reverting
  }
}
```

**Impact:**
- **Inconsistent recovery:** `loadData` catches and stores error; `updateTask` catches, toasts, and reloads
- **No retry logic:** Errors are never retried; full reload is the only recovery
- **User UX regression:** Optimistic update stays on screen until reload completes, then flickers away
- **Inefficient:** Network hiccup causes a full re-fetch instead of retrying the one failed request
- **Duplicate errors:** Both `toast.error()` and `loadError` shown to user in some flows
- **No user-facing error context:** `loadError` set but never displayed or acknowledged in UI

**Recommendation:**
Establish a **consistent error pattern**:

```typescript
interface ErrorState {
  errorId: string  // unique error per operation, not global
  operation: 'load' | 'update' | 'delete' | 'batch'
  taskId?: string
  message: string
  retryable: boolean
  timestamp: number
}

// Store separate errors per operation:
interface SprintTasksState {
  tasks: SprintTask[]
  errors: Record<string, ErrorState>  // errorId → error details
  retrying: Set<string>
  
  recordError: (id, op, msg, retryable) => void
  clearError: (id) => void
  retryOperation: (id) => Promise<void>
}

// Implement retry + timeout logic:
updateTask: async (taskId, patch, errorId = crypto.randomUUID()) => {
  set(s => ({ retrying: new Set([...s.retrying, errorId]) }))
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await window.api.sprint.update(taskId, patch)
      set(s => {
        const next = new Set(s.retrying)
        next.delete(errorId)
        const { [errorId]: _, ...restErrors } = s.errors
        return { retrying: next, errors: restErrors, tasks: mergeResult }
      })
      return
    } catch (e) {
      if (attempt === 2) {
        // Final attempt failed
        set(s => ({
          errors: {
            ...s.errors,
            [errorId]: {
              errorId,
              operation: 'update',
              taskId,
              message: e instanceof Error ? e.message : 'Unknown',
              retryable: true,
              timestamp: Date.now()
            }
          }
        }))
        return
      }
      await new Promise(r => setTimeout(r, 2 ** attempt * 100))  // exponential backoff
    }
  }
}
```

Then UI shows per-error UI:
```typescript
function TaskErrorBoundary({ errorId }) {
  const error = useSprintTasks(s => s.errors[errorId])
  const retry = useSprintTasks(s => s.retryOperation)
  
  if (!error) return null
  return <ErrorAlert message={error.message} onRetry={() => retry(errorId)} />
}
```

Benefits:
- **User control:** Retry button instead of silent reload
- **No flicker:** Error state is explicit, not a side effect of reloading
- **Backward compatible:** Retry can fall back to reload if retryable === false
- **Observable:** Components can show loading state during retry

**Effort:** M  
**Confidence:** Medium

---

### F-t4-storeDesign-8: Cross-Store Action Coupling in taskGroups

**Severity:** Medium  
**Category:** Cross-Store Coupling  
**Location:** `src/renderer/src/stores/taskGroups.ts:78–84`  

**Evidence:**
```typescript
selectGroup: (id: string | null): void => {
  set({ selectedGroupId: id })
  if (id) {
    get().loadGroupTasks(id)  // Action calls another action
  } else {
    set({ groupTasks: [] })
  }
}
```

**Impact:**
- **Implicit coupling:** Selecting a group implicitly triggers a data fetch
- **Testing friction:** To test selection, you must mock the fetch
- **Hard to reason about:** Caller doesn't know if `selectGroup` is synchronous or async
- **Potential bug:** If a caller needs to select without fetching (e.g., UI preview), they can't
- **Re-entrance risk:** If `selectGroup` is called while `loadGroupTasks` is in flight, race condition possible

**Recommendation:**
Separate **selection** from **loading**:

```typescript
selectGroup: (id: string | null): void => {
  set({ selectedGroupId: id })
}

// Component is responsible for triggering load:
export function useGroupTasks(groupId: string | null) {
  const { groupTasks, loadGroupTasks } = useTaskGroups()
  
  useEffect(() => {
    if (groupId) {
      loadGroupTasks(groupId)
    }
  }, [groupId, loadGroupTasks])
  
  return groupTasks
}
```

Benefits:
- **Clear intent:** "Select this group" and "fetch data for this group" are separate
- **Flexible:** UI can select without fetching if needed
- **Testable:** Mock the hook, not the store action
- **Debuggable:** Easier to trace where loads originate

**Effort:** S  
**Confidence:** Medium

---

### F-t4-storeDesign-9: Debounced Persistence Logic Scattered Across Stores

**Severity:** Low  
**Category:** Code Duplication, Maintenance Burden  
**Location:** `panelLayout.ts:530–562`, `ide.ts:308–351`, `taskWorkbench.ts:315–387`, `pendingReview.ts:90–116`  

**Evidence:**
All 4 stores reimplement debounced persistence:
```typescript
// panelLayout.ts
let _saveTimeout: ReturnType<typeof setTimeout> | null = null
let lastLayoutToSave: PanelNode | null = null

usePanelLayoutStore.subscribe((state) => {
  if (!state.persistable) return
  lastLayoutToSave = state.root
  if (_saveTimeout) clearTimeout(_saveTimeout)
  _saveTimeout = setTimeout(() => {
    window.api.settings.setJson('panel.layout', state.root)
  }, 500)
})

// ide.ts — nearly identical
let persistTimer: ReturnType<typeof setTimeout> | null = null
let lastSerialized = ''

useIDEStore.subscribe((state) => {
  const toSave = { /* ... */ }
  const serialized = JSON.stringify(toSave)
  if (serialized === lastSerialized) return
  lastSerialized = serialized
  
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    window.api.settings.setJson('ide.state', toSave)
  }, 2000)
})
```

**Impact:**
- **4 implementations of the same pattern** — 100+ LOC of duplication
- **Inconsistent:** panelLayout debounces 500ms, taskWorkbench 500ms, but the pattern differs
- **Hard to change:** If persistence strategy changes (e.g., add retry, add logging), 4 places to update
- **Testing:** Each store's persistence must be tested independently

**Recommendation:**
Create a **utility function**:

```typescript
// utils/persistenceDebounce.ts
export function createDebouncedPersister<T>(
  selector: (state: T) => unknown,
  onPersist: (data: unknown) => Promise<void>,
  debounceMs: number = 500
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSerialized = ''
  
  return (state: T) => {
    const data = selector(state)
    const serialized = JSON.stringify(data)
    if (serialized === lastSerialized) return
    lastSerialized = serialized
    
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        await onPersist(data)
      } catch (err) {
        console.error('Persistence failed:', err)
      }
    }, debounceMs)
  }
}

// In stores:
const persistPanelLayout = createDebouncedPersister(
  (s) => s.root,
  (data) => window.api.settings.setJson('panel.layout', data),
  500
)

usePanelLayoutStore.subscribe((state) => {
  if (!state.persistable) return
  persistPanelLayout(state)
})
```

Benefits:
- **Single source of truth** for debounce logic
- **Consistent behavior** across all stores
- **Easy to test:** Persistence function is pure and mockable
- **Easy to change:** One update fixes all stores

**Effort:** S  
**Confidence:** High

---

## Summary Table

| ID | Title | Severity | Store | Lines | Fix Effort |
|---|---|---|---|---|---|
| F-t4-storeDesign-1 | Optimistic update orchestration as business logic | Critical | sprintTasks | 156–216 | L |
| F-t4-storeDesign-2 | Redundant derived state (activeTaskCount) | High | sprintTasks | 32–35, 55–57 | S |
| F-t4-storeDesign-3 | Mixed UI selection + domain filters | High | sprintUI | 15–31 | M |
| F-t4-storeDesign-4 | Polling/subscription logic in stores | High | agentEvents, sprintEvents | 32–52, 28–52 | M |
| F-t4-storeDesign-5 | Redundant derived state (latestEvents) | Medium | sprintEvents | 15–16, 44–48 | S |
| F-t4-storeDesign-6 | God Store risk (6 domains in sprintTasks) | High | sprintTasks | 59–439 | L |
| F-t4-storeDesign-7 | Incomplete error handling (fallback-only) | Medium | sprintTasks | 149–153, 198–215 | M |
| F-t4-storeDesign-8 | Cross-store action coupling | Medium | taskGroups | 78–84 | S |
| F-t4-storeDesign-9 | Debounced persistence duplication | Low | 4 stores | Various | S |

---

## Recommended Refactor Roadmap

### Phase 1: Quick Wins (Week 1)
- **F-t4-storeDesign-2:** Remove `activeTaskCount` → selector (1–2 hrs)
- **F-t4-storeDesign-5:** Remove `latestEvents` → selector (30 min)
- **F-t4-storeDesign-9:** Extract persistence utility (2 hrs)

### Phase 2: Structural Fixes (Week 2–3)
- **F-t4-storeDesign-3:** Split sprintUI into filters + selection stores (4 hrs)
- **F-t4-storeDesign-4:** Move subscriptions to hooks (3 hrs)
- **F-t4-storeDesign-8:** Decouple taskGroups selection from load (1 hr)

### Phase 3: Major Refactor (Week 4–5)
- **F-t4-storeDesign-1:** Extract optimistic update service (6–8 hrs)
- **F-t4-storeDesign-6:** Split sprintTasks into 3 stores + services (8–10 hrs)
- **F-t4-storeDesign-7:** Implement retry + error tracking pattern (4 hrs)

---

## Testing Impact

Once refactored:
- **Service layer tests** replace store integration tests (unit testable, no Zustand mocking)
- **Hook tests** replace store+component tests (test subscription lifecycle independently)
- **Selector tests** replace computed property tests (pure functions, easy to verify)
- **Store tests** focus only on state mutations, not orchestration

**Estimated test reduction:** 20–30% fewer tests, 50% faster test runs (no async Zustand setup).

---

## Conclusion

The stores are **over-engineered for state management** and **under-engineered for service composition**. Moving business logic (optimistic updates, retries, subscriptions) into services and extracting computed state into selectors will make the codebase more maintainable, testable, and reusable. Start with Phase 1 to unblock other teams.

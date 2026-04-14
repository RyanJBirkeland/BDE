# Zustand Store Architecture Audit

## Executive Summary

The Zustand store layer demonstrates **generally sound domain separation** with intentional splits between data (`sprintTasks`), UI state (`sprintUI`, `sprintSelection`, `sprintFilters`), and specialized concerns (events, cost tracking, git state). However, the audit identified **critical cross-store coupling** in the `healthCheck` store that violates architectural boundaries, **missing memoized selectors** that force unnecessary re-renders across multiple stores, and **computed state stored as mutable action methods** that escape Zustand's reactivity guarantees. The pattern of stores calling `window.api` directly for mutations alongside reactive updates creates scattered responsibility. Score: **6.5/10** — strong baseline, medium-priority fixes needed for scale.

---

## Findings

### F-t3-stores-1: Cross-Store Coupling in healthCheck Store
**Severity:** High  
**Category:** State Design  
**Location:** `src/renderer/src/stores/healthCheck.ts:3, 39-50`  
**Evidence:**  
The `healthCheck` store directly imports and reads from `useSprintTasks`:
```typescript
import { useSprintTasks } from './sprintTasks'
// ...
const tasks = useSprintTasks((s) => s.tasks)
```
The custom hook `useVisibleStuckTasks()` calls **both stores' selectors**, merging their results. This is a **reactive component** masquerading as a store helper.

**Impact:**  
- Tight coupling: if `sprintTasks` changes shape, `healthCheck` breaks silently
- Violates single responsibility: health check state can only be understood by reading two stores
- Makes unit testing harder (must mock both stores)
- The logic belongs in a component hook, not exported from the store layer
- Any caller of `useVisibleStuckTasks()` re-renders whenever either store changes

**Recommendation:**  
Move `useVisibleStuckTasks()` from `healthCheck.ts` to a custom hook file (e.g., `hooks/useVisibleStuckTasks.ts`). Keep `healthCheck` as a **pure UI state store** (stuckTaskIds, dismissedIds only). The filtering logic lives in the component layer where it belongs.

**Effort:** S  
**Confidence:** High  

---

### F-t3-stores-2: Missing Memoized Selectors Cause Over-Subscription
**Severity:** High  
**Category:** State Design  
**Location:** `src/renderer/src/stores/sprintUI.ts`, `sprintSelection.ts`, `sprintFilters.ts`  
**Evidence:**  
`sprintUI.ts` exports a scoped selector only for `selectIsGenerating()`:
```typescript
export const selectIsGenerating =
  (taskId: string) =>
  (s: SprintUIState): boolean =>
    s.generatingIds.includes(taskId)
```
But `sprintSelection.ts` and `sprintFilters.ts` have **no exported selectors at all**. Components must use raw state subscriptions like:
```typescript
const { selectedTaskId, selectedTaskIds, drawerOpen, specPanelOpen, logDrawerTaskId } =
  useSprintSelection(useShallow((s) => ({ ... 5 fields ... })))
```
This pattern pulls 5 fields on every subscription, even when only one changes. The `useShallow` wrapper masks the problem but doesn't solve it.

**Impact:**  
- Every field change triggers re-render of **any component** subscribed to the store, even if unrelated
- `useShallow` works at the Zustand hook level but doesn't prevent the underlying mutation
- Components can't isolate to a single field subscription without custom selectors
- In `sprintFilters`, if `searchQuery` changes, components waiting only for `statusFilter` still re-render
- Scalability risk: as these stores grow, the re-render cost compounds

**Recommendation:**  
Create memoized selector functions for each field or logical grouping. Export them from the store:
```typescript
export const selectSelectedTaskId = (s: SprintSelectionState) => s.selectedTaskId
export const selectSelectedTaskIds = (s: SprintSelectionState) => s.selectedTaskIds
export const selectDrawerOpen = (s: SprintSelectionState) => s.drawerOpen
// ...
```
Zustand's selector memoization will prevent re-renders on unrelated mutations.

**Effort:** M  
**Confidence:** High  

---

### F-t3-stores-3: Computed State Stored as Action Method in Notifications
**Severity:** Medium  
**Category:** State Design  
**Location:** `src/renderer/src/stores/notifications.ts:42, 109-111`  
**Evidence:**  
The `getUnreadCount()` method is stored as an **action** but performs **pure computation**:
```typescript
interface NotificationsStore {
  // ...
  getUnreadCount: () => number  // <- Action, not state
}

getUnreadCount: (): number => {
  return get().notifications.filter((n) => !n.read).length
}
```
This is a hidden derived value. Components calling `getUnreadCount()` don't trigger reactivity — the count is **computed on-demand** and could stale if a component caches the result.

**Impact:**  
- The method is called imperatively, not declaratively — components can't subscribe to unread count changes
- Creates a second source of truth: components may compute their own count instead, risking inconsistency
- If a component memoizes `getUnreadCount()`, it won't update when notifications change
- The pattern violates Zustand's reactive model where **selectors are the primary interface**

**Recommendation:**  
Export a memoized selector instead:
```typescript
export const selectUnreadCount = (s: NotificationsStore): number =>
  s.notifications.filter((n) => !n.read).length
```
Remove `getUnreadCount` from the store interface. Components that need the count subscribe via the selector:
```typescript
const unreadCount = useNotificationsStore(selectUnreadCount)
```

**Effort:** S  
**Confidence:** High  

---

### F-t3-stores-4: Scattered API Mutation Responsibility
**Severity:** Medium  
**Category:** State Design  
**Location:** `src/renderer/src/stores/sprintTasks.ts:48-56` (and throughout most action methods)  
**Evidence:**  
Every action in `sprintTasks` directly calls `window.api.*`:
```typescript
updateTask: async (taskId, patch): Promise<void> => {
  set((state) => ({
    pendingUpdates: trackPendingOperation(...),
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...patch, ... } : t))
  }))
  try {
    const serverTask = (await window.api.sprint.update(taskId, patch)) as SprintTask | null
    // Apply server response...
  }
}
```
Similar pattern in `gitTree.ts` (`fetchStatus`, `commit`, `push`), `costData.ts` (`fetchLocalAgents`), `agentHistory.ts` (`fetchAgents`). The store owns **both state mutation AND IPC orchestration**.

**Impact:**  
- Makes stores harder to test (must mock window.api)
- Couples Zustand logic to transport layer — if you switch from IPC to WebSocket/REST, refactor all stores
- Stores become "fat service objects" instead of pure state managers
- The optimistic update machinery in `sprintTasks` is opaque because mutation logic is embedded
- New developers must understand both store mutation AND API contract simultaneously

**Recommendation:**  
Extract API calls into service/adapter layer:
```typescript
// New: src/renderer/src/lib/sprintService.ts
export async function updateTaskAPI(taskId: string, patch: Partial<SprintTask>) {
  return (await window.api.sprint.update(taskId, patch)) as SprintTask | null
}

// Store stays clean:
updateTask: async (taskId, patch): Promise<void> => {
  set((state) => ({
    pendingUpdates: trackPendingOperation(...),
    tasks: state.tasks.map(...)
  }))
  try {
    const serverTask = await updateTaskAPI(taskId, patch)
    // Apply...
  }
}
```

**Effort:** L  
**Confidence:** High  

---

### F-t3-stores-5: Missing Selector in sprintTasks for activeCount
**Severity:** Low  
**Category:** State Design  
**Location:** `src/renderer/src/stores/sprintTasks.ts:59-66`  
**Evidence:**  
The store exports computed selectors correctly:
```typescript
export const selectActiveTaskCount = (state: SprintTasksState): number =>
  state.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
```
BUT the `launchTask()` action **recomputes activeCount inline** instead of reusing the selector:
```typescript
launchTask: async (task): Promise<void> => {
  const { tasks, updateTask } = get()
  if (task.status !== TASK_STATUS.ACTIVE) {
    const activeCount = tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
    if (!canLaunchTask(activeCount, WIP_LIMIT_IN_PROGRESS)) { ... }
  }
}
```
This is minor inconsistency — the selector exists but isn't used internally.

**Impact:**  
- Duplication of filter logic in two places
- If the definition of "active" changes, both places must be updated
- Marginal: the pattern works, but violates DRY

**Recommendation:**  
Define a private helper or use the selector logic:
```typescript
const getActiveCount = (state: SprintTasksState): number =>
  state.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length

launchTask: async (task): Promise<void> => {
  const state = get()
  const activeCount = getActiveCount(state)
  if (!canLaunchTask(activeCount, WIP_LIMIT_IN_PROGRESS)) { ... }
}
```

**Effort:** S  
**Confidence:** Medium  

---

### F-t3-stores-6: Over-Aggregated UI State in panelLayout
**Severity:** Low  
**Category:** State Design  
**Location:** `src/renderer/src/stores/panelLayout.ts:45-68`  
**Evidence:**  
`panelLayout` stores both **structural layout** (`root: PanelNode`) and **transient interaction state** (`focusedPanelId`, `activeView`):
```typescript
interface PanelLayoutState {
  root: PanelNode          // Persistent layout tree
  focusedPanelId: string | null  // Current focus
  activeView: View         // Currently visible tab
  persistable: boolean     // Persistence toggle
  // ... 8 actions
}
```
The store has a **persistence subscriber** that saves `root` to localStorage but ignores the transient fields.

**Impact:**  
- `focusedPanelId` and `activeView` are ephemeral but stored in persistent state (confusing)
- Components subscribe to the whole store when they only care about focus or active view
- If someone tries to hydrate `focusedPanelId` from localStorage, it will persist incorrectly (stale panel IDs across sessions)
- The `persistable` flag feels like a control signal rather than state

**Recommendation:**  
Split into two stores or mark transient fields clearly:
```typescript
// Option 1: Split
export const usePanelLayoutStore = create<{ root: PanelNode; ... }>
export const usePanelInteractionStore = create<{ focusedPanelId; activeView; persistable }>

// Option 2: Comment + explicit hydration logic
interface PanelLayoutState {
  root: PanelNode  // Persisted
  
  // Transient (not persisted; reset on hydration)
  focusedPanelId: string | null
  activeView: View
  persistable: boolean
}
```

**Effort:** M  
**Confidence:** Medium  

---

### F-t3-stores-7: taskWorkbenchValidation Not Exported, Only Imported
**Severity:** Low  
**Category:** State Design  
**Location:** `src/renderer/src/stores/taskWorkbench.ts:288, 294-296`  
**Evidence:**  
`taskWorkbench.ts` imports and mutates `useTaskWorkbenchValidation` directly:
```typescript
import { useTaskWorkbenchValidation } from './taskWorkbenchValidation'

// Inside store actions:
useTaskWorkbenchValidation.setState({ semanticChecks: [], operationalChecks: [] })
// ...
useTaskWorkbenchValidation.getState().setStructuralChecks(checks)
```
The validation store is **tightly coupled** to the workbench store. There's no documented contract or selector for the relationship.

**Impact:**  
- Undocumented coupling: a reader might not realize taskWorkbench depends on validation state
- The deprecated comments on `setStructuralChecks`, etc., suggest this wasn't always the design
- If validation store changes, workbench breaks silently
- No single source of truth for form validation state

**Recommendation:**  
Formalize the dependency:
1. Document at the top of both stores that they form a logical unit
2. Or merge them if validation state is **never used without workbench state**
3. Export documented selectors from validation store so workbench can't directly mutate it

```typescript
// taskWorkbenchValidation.ts — only allow reads + public actions
export const selectSemanticChecks = (s: TaskWorkbenchValidationState) => s.semanticChecks
export const useTaskWorkbenchValidation.setState is NOT exported
```

**Effort:** S  
**Confidence:** Medium  

---

### F-t3-stores-8: Inconsistent Error State Modeling
**Severity:** Low  
**Category:** State Design  
**Location:** `src/renderer/src/stores/gitTree.ts:22-23` vs. `sprintTasks.ts:40`  
**Evidence:**  
`gitTree` models **error with context**:
```typescript
lastError: string | null
lastErrorOp: 'push' | 'commit' | null
```
Whereas `sprintTasks` models error **without context**:
```typescript
loadError: string | null
```
And `agentHistory` uses a different pattern:
```typescript
fetchError: string | null
```

**Impact:**  
- Components don't know **which operation** failed in gitTree (user must infer from UI state)
- Inconsistent naming (`lastError`, `loadError`, `fetchError`) makes searching and refactoring harder
- New developers must learn each store's error convention separately
- Error recovery logic varies by store

**Recommendation:**  
Standardize on a single error shape across all stores. Example:
```typescript
interface ErrorState {
  error: string | null
  errorOp: string | null  // 'load', 'create', 'update', 'delete', etc.
}
```
Export helpers:
```typescript
export const selectHasError = (s) => s.error !== null
export const selectErrorMessage = (s) => s.error
export const selectErrorOperation = (s) => s.errorOp
```

**Effort:** M  
**Confidence:** Medium  

---

## Positive Patterns (Worth Preserving)

1. **Intentional Store Splits:** `sprintUI`, `sprintSelection`, `sprintFilters` are correctly separated from the data store. The split is justified by the baseline — excellent domain fidelity.

2. **Optimistic Update Machinery:** The `pendingUpdates` field-level tracking in `sprintTasks` is sophisticated and correct. It protects UI state from being overwritten by polling data, a hard problem solved well.

3. **Memoized Selectors (where used):** The `selectActiveTaskCount`, `selectIsGenerating`, and `selectLatestEvent` patterns are correct and prevent unnecessary re-renders.

4. **Persistence Layer Separation:** Stores that persist state (IDE, sidebar, panel layout) use **external persistence subscribers** rather than storing serialization logic in actions. This is clean.

5. **Event-Driven State:** `agentEvents` and `sprintEvents` correctly use Zustand's `init()` pattern to subscribe to external event streams, avoiding tight coupling to components.

---

## Summary Table

| Finding | Store(s) | Severity | Quick Fix? |
|---------|----------|----------|-----------|
| Cross-store coupling | healthCheck | High | Move hook to component layer |
| Missing selectors | sprintUI, selection, filters | High | Export field selectors |
| Computed as action | notifications | Medium | Export selector for unreadCount |
| Scattered API calls | sprintTasks, gitTree, costData | Medium | Extract service layer |
| Unused selector | sprintTasks | Low | Reuse selectActiveTaskCount inline |
| Over-aggregated state | panelLayout | Low | Document or split transient fields |
| Undocumented coupling | taskWorkbench + validation | Low | Formalize dependency |
| Error state inconsistency | gitTree, agentHistory, tasks | Low | Standardize error shapes |


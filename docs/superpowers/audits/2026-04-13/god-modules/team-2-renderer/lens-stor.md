# Store Cohesion Audit: Renderer Zustand Stores
**Audit Date:** 2026-04-13  
**Scope:** All 32 Zustand stores in `/src/renderer/src/stores/`  
**Auditor:** Store Cohesion Analyst  

---

## F-t2-stor-1: sprintTasks — God Store with Optimistic Update Complexity
**Severity:** High  
**Category:** God Store, Business Logic in Store, Optimization Logic Bloat  
**Location:** `/src/renderer/src/stores/sprintTasks.ts:1–441` (433 lines)  
**Evidence:**
- Manages: domain state (tasks[], loading, loadError), optimistic update tracking (pendingUpdates, pendingCreates), TTL-based state coherency
- Embeds: WIP limit checking (launchTask lines 317–326), dependency validation (sanitizeDependsOn), spec generation, task dependency management
- Coordination logic: Fingerprint-based diff detection (lines 73–91), pending field merging (lines 107–142), selective TTL expiry (lines 94–102)

**Impact:**
- Single point of change for two concerns: domain mutations AND client-side optimism
- 200+ lines of optimistic update logic (lines 62–142) makes mutation testing harder
- launchTask violates SRP — embeds WIP policy that should be validated elsewhere
- Any change to pending-update TTL or merging strategy risks task consistency

**Recommendation:**
- Extract `OptimisticUpdateManager` class for pending tracking, TTL, field merge logic
- Move WIP limit check to a composable policy object outside store
- Keep sprintTasks focused on: load, update, delete, create — pure domain mutations
- Store can call the OptimisticUpdateManager but shouldn't own its implementation

**Effort:** L  
**Confidence:** High

---

## F-t2-stor-2: sprintUI — Mixed Domain and UI State in Single Store
**Severity:** High  
**Category:** Mixed Domain/UI State, Improper Separation  
**Location:** `/src/renderer/src/stores/sprintUI.ts:15–56` (42 state fields)  
**Evidence:**
- **Domain state:** selectedTaskId, selectedTaskIds (multi-select semantics)
- **UI state:** drawerOpen, specPanelOpen, doneViewOpen, conflictDrawerOpen, healthCheckDrawerOpen, quickCreateOpen, logDrawerTaskId
- **Filter state:** statusFilter, repoFilter, tagFilter, searchQuery (query layer concern)
- **Display state:** pipelineDensity (card vs compact view)
- **Ephemeral state:** generatingIds (transient operation tracking)

**Impact:**
- Components can't know which actions mutate presentation vs. which filter the task list
- Testing: hard to test selection logic apart from drawer side-effects (line 80: set both selectedTaskId and drawerOpen)
- Caching/persistence: unclear which fields should survive reload (now mixed)
- Reuse: another panel wanting multi-select must import this store for selection logic only

**Recommendation:**
- **selectionStore:** selectedTaskId, selectedTaskIds, clearSelection, toggleTaskSelection
- **filterStore:** statusFilter, repoFilter, tagFilter, searchQuery, clearAllFilters
- **drawerStore:** drawerOpen, specPanelOpen, logDrawerTaskId, etc. (all UI chrome)
- sprintUI.setSelectedTaskId should NOT close/open drawer — let component call both actions

**Effort:** M  
**Confidence:** High

---

## F-t2-stor-3: taskGroups — Domain Logic Embedded in Store Actions
**Severity:** Medium  
**Category:** Business Logic in Store  
**Location:** `/src/renderer/src/stores/taskGroups.ts:188–209, 271–313` (queueAllTasks, createGroupFromTemplate)  
**Evidence:**
- `queueAllTasks`: calls updateGroup AND reloads groupTasks in same action (lines 193–201) — orchestrates multiple domain operations
- `createGroupFromTemplate`: creates group, loops through tasks creating each, adds to group, handles partial failures (lines 283–301) — complex transaction-like logic
- Stores also own error toasts (lines 71, 107, 123, etc.) — UI notification is domain responsibility

**Impact:**
- Template creation spans 40+ lines with try/catch per task — if task loop needs to batch later, store logic gets harder to refactor
- Toast injection couples store to UI layer — can't reuse logic in headless contexts
- Partial failure handling buried in store — harder to test, audit, or change retry policy

**Recommendation:**
- Extract `createGroupFromTemplate(template, repo)` → service/factory that returns {group, createdTasks, failedTasks}
- Store calls service, handles result, dispatches its own toasts
- Keep queueAllTasks as-is but move status-update logic to updateGroup (already does it)
- Pass error handler or emit event for toast rather than calling toast.error directly

**Effort:** M  
**Confidence:** Medium

---

## F-t2-stor-4: sprintUI — Missing Selectors Force Consumer Computation
**Severity:** Medium  
**Category:** Missing Selector, Anti-pattern  
**Location:** `/src/renderer/src/stores/sprintUI.ts:52–136` (no derived state accessors)  
**Evidence:**
- Store exports `selectActiveTaskCount` from sprintTasks but NOT from sprintUI
- Components must call `useSprintUI((s) => s.generatingIds.includes(taskId))` repeatedly instead of `useSprintUI(selectIsGenerating(taskId))`
- No selectors for common queries: isTaskSelected(id), areAllTasksSelected(), getOpenDrawers(), hasActiveFilters()
- Components repeat filter logic: `tasks.filter((t) => filterState.statusFilter === 'all' || t.status === filterState.statusFilter)`

**Impact:**
- Renders increase when unrelated state changes (e.g., drawerOpen changes re-render generation-check component)
- Repeated filter logic in components is source of inconsistency
- Memoization via useMemo(…, [deps]) in components instead of store-level memoization

**Recommendation:**
- Add scoped selectors to sprintUI:
  ```ts
  export const selectIsGenerating = (taskId: string) => 
    (s: SprintUIState) => s.generatingIds.includes(taskId)
  export const selectOpenDrawers = (s: SprintUIState) => 
    ({ drawerOpen: s.drawerOpen, specPanelOpen: s.specPanelOpen, ... })
  ```
- Create filter selector factory that returns a comparator function
- Update components to use selectors via `useSprintUI(selectIsGenerating(id))`

**Effort:** S  
**Confidence:** High

---

## F-t2-stor-5: taskWorkbench — Validation State Mixed with Form State
**Severity:** Medium  
**Category:** Mixed Domain/UI State, Validation Logic  
**Location:** `/src/renderer/src/stores/taskWorkbench.ts:24–63` (validation state: lines 45–51)  
**Evidence:**
- Form fields: title, repo, priority, spec, dependsOn, etc. (lines 28–40)
- **Validation state:** structuralChecks, semanticChecks, operationalChecks, semanticLoading, operationalLoading (lines 47–51)
- isDirty() method compares form to original snapshot (lines 308–340) — derived state stored as state

**Impact:**
- Validation results are NOT state but computed/fetched — storing them creates staleness risk
- loading flags (semanticLoading, operationalLoading) suggest async operations that should be separate from form state
- isDirty() is a pure function of form fields — shouldn't require .getState() call, should be exposed as selector

**Recommendation:**
- Move validation-related fields to separate `validationStore`
- Keep form fields + dirty-tracking in taskWorkbench
- Extract isDirty as an exported selector function, not a method
- validationStore owns: checksExpanded, structuralChecks, semanticChecks, operationalChecks, semantic/operationalLoading
- On formChange → call selector isDirty(workbench, validation) from component

**Effort:** M  
**Confidence:** Medium

---

## F-t2-stor-6: gitTree — Mixed Git Domain with UI Selection State
**Severity:** Medium  
**Category:** Mixed Domain/UI State  
**Location:** `/src/renderer/src/stores/gitTree.ts:13–47` (state breakdown)  
**Evidence:**
- **Domain state:** branch, staged, unstaged, untracked, diffContent, commitMessage
- **UI state:** selectedFile, selectedStaged (selection persistence)
- **Metadata:** repoPaths, activeRepo (repo context — belongs to app shell or nav)
- **Loading:** commitLoading, pushLoading, loading (three flags for different ops — can consolidate)

**Impact:**
- activeRepo belongs in panelLayout or app shell (which panel/view is active), not gitTree
- Multiple loading flags: could use single op state { commitLoading: boolean; pushLoading: boolean; statusLoading: boolean }
- Selecting a file auto-fetches diff (selectFile action, lines 99–115) — side effect in store action

**Recommendation:**
- Keep gitTree for: branch, staged, unstaged, untracked, commitMessage, diffContent, and the fetch/push/commit/stage actions
- Move activeRepo to app-shell store or panelLayout (context for which repo the current panel targets)
- Move selectedFile, selectedStaged to separate UI/selection store (might be part of code-review or git-ui store)
- Create consolidated loading state: `interface GitOp { loading: boolean; op: 'commit' | 'push' | 'status' | null; error: string | null }`

**Effort:** M  
**Confidence:** Medium

---

## F-t2-stor-7: sprintTasks.launchTask — Business Rule Embedding (WIP Limit)
**Severity:** Medium  
**Category:** Business Logic in Store  
**Location:** `/src/renderer/src/stores/sprintTasks.ts:315–350` (launchTask)  
**Evidence:**
- Lines 317–326: WIP limit check is hardcoded domain rule
- Rule: "don't launch if activeCount >= WIP_LIMIT_IN_PROGRESS (unless already ACTIVE)"
- Toast emitted from store, return early if limit reached

**Impact:**
- Policy is buried in action — not obvious this store enforces a business rule
- To change WIP policy (e.g., per-repo limits, soft warnings), must modify this store
- Rules should be testable independently of Zustand plumbing
- Other stores can't reuse the policy

**Recommendation:**
- Create `src/renderer/src/lib/wip-policy.ts`:
  ```ts
  export function canLaunchTask(task: SprintTask, activeCount: number): 
    { allowed: boolean; reason?: string } {
    if (task.status === TASK_STATUS.ACTIVE) return { allowed: true }
    if (activeCount >= WIP_LIMIT_IN_PROGRESS) 
      return { allowed: false, reason: `In Progress is full (${activeCount}/${WIP_LIMIT_IN_PROGRESS})` }
    return { allowed: true }
  }
  ```
- Store calls: `const check = canLaunchTask(task, activeCount); if (!check.allowed) { toast.error(check.reason); return; }`

**Effort:** S  
**Confidence:** High

---

## F-t2-stor-8: healthCheck — Cross-Store Coupling via Hook Wrapper
**Severity:** Low  
**Category:** Cross-Store Coupling, Hook Pattern  
**Location:** `/src/renderer/src/stores/healthCheck.ts:35–50`  
**Evidence:**
- `useVisibleStuckTasks()` hook manually subscribes to both useSprintTasks and useHealthCheckStore
- Memoizes filtering logic (tasks, stuckTaskIds, dismissedIds)
- Couples two stores at hook level — not a store problem, but suggests compute should live in store

**Impact:**
- Every component using this hook re-runs the filter logic if ANY of the three dependencies change
- If healthCheck or sprintTasks changes, hook subscribers are notified even if their visible set didn't change
- Can't cache per-task visibility elsewhere

**Recommendation:**
- Add selector to healthCheckStore: `selectVisibleStuckTasks(tasks) => (s) => tasks.filter(...)`
- Or move visibility compute INTO healthCheckStore as a cached derived field
- Minor — keep as-is if performance is acceptable, but note for future refactoring

**Effort:** S  
**Confidence:** Low

---

## F-t2-stor-9: taskGroups.updateGroup — Revert-on-Failure Pattern Risk
**Severity:** Low  
**Category:** Optimistic Update, Error Handling  
**Location:** `/src/renderer/src/stores/taskGroups.ts:112–128`  
**Evidence:**
- Lines 114–116: optimistic update before API call
- Lines 125–127: on error, reloads entire groups list (full refetch)
- Discards the optimistic update but doesn't restore the previous state

**Impact:**
- If error occurs, user sees flash of reversion (groups list flickers)
- Not ideal UX vs. sprintTasks approach which preserves pending update TTL

**Recommendation:**
- Cache the previous state before optimistic update: `const prev = get().groups`
- On error, restore: `set({ groups: prev })` instead of full reload
- Less network, cleaner UX

**Effort:** S  
**Confidence:** Medium

---

## F-t2-stor-10: ide.ts — File Content State Should Be Ephemeral or Cached Separately
**Severity:** Low  
**Category:** State Granularity, Store Growth Risk  
**Location:** `/src/renderer/src/stores/ide.ts:86–116` (file management)  
**Evidence:**
- fileContents, fileLoadingStates grow unbounded as tabs open
- Eviction logic in closeTab (lines 221–241) removes content only if no tab has that path
- But fileContents is never persisted (unlike openTabs which is saved)
- Could fill memory with large files

**Impact:**
- No per-file eviction policy — accumulates all opened files in RAM
- Not a showstopper for typical use (few tabs), but scales poorly
- Mixed responsibility: store owns both tab metadata (persisted) and transient file cache (not persisted)

**Recommendation:**
- Keep fileContents and fileLoadingStates but add eviction:
  ```ts
  const MAX_FILES_IN_MEMORY = 10
  // In setFileContent, check size before adding
  if (Object.keys(s.fileContents).length > MAX_FILES_IN_MEMORY) {
    // evict oldest
  }
  ```
- Or move fileContents to a separate in-memory cache (not Zustand)
- Low priority — unlikely to hit limits in practice

**Effort:** S  
**Confidence:** Low

---

## Summary

**Critical Findings (Fix Now):**
1. **sprintTasks** — Extract optimistic update manager to reduce complexity (F-t2-stor-1)
2. **sprintUI** — Split into 3 stores: selection, filter, drawer (F-t2-stor-2)

**High-Priority (Next Sprint):**
3. **sprintUI** — Add memoized selectors (F-t2-stor-4)
4. **sprintTasks.launchTask** — Extract WIP policy (F-t2-stor-7)
5. **taskGroups** — Extract template creation service (F-t2-stor-3)

**Medium-Priority (Refactor When Touching):**
6. **taskWorkbench** — Separate validation state (F-t2-stor-5)
7. **gitTree** — Separate UI selection from domain state (F-t2-stor-6)
8. **taskGroups.updateGroup** — Improve error handling UX (F-t2-stor-9)

**Low-Priority (Nice to Have):**
9. **healthCheck** — Consider moving compute into store (F-t2-stor-8)
10. **ide.ts** — Add file eviction policy (F-t2-stor-10)

**Overall Store Health:**
- 32 stores is expected given the app scope (dashboard, workbench, git, agent runners, code review)
- Most stores are well-focused (agentEvents, sprintEvents, terminal, codeReview)
- Main issue is **conflation of domains within a few large stores** (sprintUI, sprintTasks, taskGroups)
- No stores are unmaintainably large, but sprintUI and sprintTasks are approaching that threshold


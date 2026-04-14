# God Modules Audit: Team 2 Renderer Hooks & Utilities

**Date:** 2026-04-13  
**Scope:** Renderer hooks and utility libraries  
**Auditor:** Hook & Utility Sprawl Detector

---

## Summary

Identified **7 critical/high-severity findings** across hooks and utilities:
- 2 God Hooks (useReviewActions, useDesktopNotifications)
- 1 Kitchen-Sink Hook (useAppInitialization)
- 2 Utility Sprawl issues (format.ts duplication, lib/ organization)
- 2 Mixed Concern patterns (keyboard shortcuts spanning scope creep, notification multiplexing)

Positive signal: useSprintTaskActions (380 lines) is actually well-scoped. Small, focused polling hooks are properly designed. Most hooks follow SRP once extracted.

---

## Finding: Detailed Audit

### F-t2-hook-1: useReviewActions — God Hook Owns All Review Mutations

**Severity:** Critical  
**Category:** God Hook  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useReviewActions.ts:1-393`

**Evidence:**
- **393 lines** containing 6 single-action methods (shipIt, mergeLocally, createPr, requestRevision, rebase, discard) plus **4 batch variants**
- Owns: IPC coordination (`window.api.review.*`), modal state (confirm, prompt), task selection, freshness checking, merge strategy state, action-in-flight tracking, and error/success toasting
- Each action method: IPC call → confirm modal → state update → task selection → loadData → toast notification
- Batch methods: loop-then-aggregate pattern with identical error handling
- Freshness effect: runs checkFreshness IPC call independently (lines 77-84)

**Pattern Violation:**
```typescript
// Line 61-117: shipIt owns confirm + IPC + state + selection + loadData + toast
const shipIt = async (): Promise<void> => {
  if (!task) return
  const ok = await confirm({ ... })        // Modal concern
  if (!ok) return
  setActionInFlight('shipIt')               // Local state
  try {
    const result = await window.api.review.shipIt({...}) // IPC
    if (result.success) {
      toast.success('Merged & pushed!')     // Toast notification
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)                // Task selection
      loadData()                            // Data refresh
    } else {
      toast.error(...)
    }
  } catch (e) {
    toast.error(...)
  } finally {
    setActionInFlight(null)
  }
}
```

**Impact:**
- **Maintainability:** Changing merge strategy logic requires understanding all 6 single + 4 batch methods (2700+ LOC if extracted)
- **Testing:** Unit testing any one action requires mocking: confirm modal, 3 Zustand stores, window.api.review (6 methods), toast, and task selection
- **Change Risk:** High. A fix to "handle merge conflicts" must be applied in 10 separate places (shipIt, mergeLocally, createPr, requestRevision, rebase, discard, + batch variants)
- **Reusability:** Batch methods cannot be reused without pulling in all other actions

**Recommendation:**
Extract into separate custom hooks by concern:
- `useReviewShipIt()` - shipIt + batch variant
- `useReviewMerge()` - mergeLocally + batch variant
- `useReviewPR()` - createPr + batch variant
- `useReviewFreshness()` - checkFreshness effect + state
- `useReviewMergeStrategy()` - shared merge strategy + state

Create a shared error handler: `useReviewErrorHandling()` to unify all IPC error paths (confirm, toast, retry logic).

**Effort:** L (3-4 hours; high test coverage payoff)  
**Confidence:** High

---

### F-t2-hook-2: useDesktopNotifications — Multiplexing Task + PR State with Multiple Concerns

**Severity:** High  
**Category:** Mixed Concerns: State Change Detection + Notification Delivery + Preference Management  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useDesktopNotifications.ts:1-315`

**Evidence:**
- **315 lines** handling 4 independent notification types (agent_completed, agent_failed, pr_merged, pr_closed, merge_conflict) in a single hook
- Owns: notification preferences loading (IPC), desktop/in-app delivery routing, task state change detection, PR merge detection, duplicate suppression, window focus detection, and per-event-type rules
- Two separate effects detecting different state types (tasks, prMergedMap), each with 4+ status transitions, each with delivery routing logic
- Preference logic: useEffect loads from IPC (lines 92-123), then stateful switch in 5 places (lines 162-260)

**Pattern Violation:**
```typescript
// Lines 149-260: Single effect handles 4 task status transitions x 2 delivery modes
for (const task of tasks) {
  const prev = prevMap.get(task.id)
  if (!prev) continue
  
  // Transition 1: active → review
  if (prev.status === TASK_STATUS.ACTIVE && task.status === TASK_STATUS.REVIEW) {
    const delivery = shouldDeliverNotification('agent_completed', prefs)
    if (!delivery.desktop && !delivery.inApp) continue
    // ... notification firing logic (desktop + in-app)
  }
  
  // Transition 2: active → done
  if (prev.status === TASK_STATUS.ACTIVE && task.status === TASK_STATUS.DONE) {
    const delivery = shouldDeliverNotification('agent_completed', prefs)
    // ... (lines 186-208, ~20 LOC)
  }
  
  // Transition 3: active → failed
  // Transition 4: active → error
  // ... (lines 212-260)
}

// Lines 266-314: Separate effect for PR merged events (duplicate delivery logic)
for (const [taskId, merged] of Object.entries(prMergedMap)) {
  // ... identical preference checking + notification firing
}
```

**Constraints & Gotchas:**
- Multiple refs maintain state outside Zustand: `prevTasksRef`, `prevPrMergedRef`, `initializedRef`, `notifiedTasksRef`
- Initialization guard on lines 138-142 and preferences guard on line 132 make dependency tracing difficult
- Preference loading is async (lines 94-120) but hook doesn't wait; prefs default to hardcoded values that may differ from persisted settings

**Impact:**
- **Testability:** Testing "should notify on agent_completed with desktop preference" requires:
  - Mock entire task transition (prev → current)
  - Mock prefs state loading
  - Track 3 refs (prevTasksRef, initializedRef, notifiedTasksRef)
  - Mock fireDesktopNotification and addNotification independently
  - Verify side effects in correct order
- **Change Risk:** Adding a new notification type (e.g., "agent_resumed") requires:
  - New pref key in NotificationPreferences interface
  - New effect or extend existing effect with new status transition
  - Update shouldDeliverNotification switch statement
  - Update preference loading loop
  - Update useDesktopNotifications signature if new store dependency needed
- **Preference Drift:** Async IPC load means first render uses hardcoded defaults; notification preferences may not match user settings for ~1 second on mount

**Recommendation:**
Split into focused hooks:
- `useNotificationPreferences()` - load & persist preferences (with pre-cache to avoid drift)
- `useTaskStatusNotifications()` - only handle task status changes (agent_completed, agent_failed)
- `usePrMergedNotifications()` - only handle PR merged events
- `useNotificationDelivery(type, prefs)` - shared delivery routing (desktop + in-app)

Move notification preference loading into store initialization (main App mount) to avoid drift.

**Effort:** M (2-3 hours; preference cache adds store complexity)  
**Confidence:** High

---

### F-t2-hook-3: useAppInitialization — Kitchen Sink Init Hook

**Severity:** Medium  
**Category:** Kitchen Sink Pattern (Multiple Unrelated Concerns)  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useAppInitialization.ts:1-39`

**Evidence:**
- **39 lines** but 5 independent initialization operations in 5 separate useEffect blocks:
  1. Cost data loading (fetchLocalAgents)
  2. Keybindings initialization
  3. Panel layout restoration
  4. Pending review restoration
  5. Filter presets restoration

Each useEffect is independent and has no data flow between them. All could be inlined into App.tsx or split into focused hooks.

**Pattern Violation:**
```typescript
// Lines 20-22
useEffect(() => {
  fetchLocalAgents()
}, [fetchLocalAgents])

// Lines 24-26
useEffect(() => {
  initKeybindings()
}, [initKeybindings])

// Lines 28-30 ... (3 more identical blocks)
```

**Impact:**
- **Clarity:** Maintainers reading App.tsx don't know what initialization happens without jumping into useAppInitialization
- **Testability:** To test "cost data loads on mount," must mock all 5 store operations
- **Reusability:** Cannot reuse one part without importing the whole hook
- **Dead Code Risk:** Removing one concern (e.g., no longer restore filter presets) requires editing this hook

**Recommendation:**
- Inline all 5 useEffect blocks into App.tsx root with explanatory comments
- OR split into: `useCostDataInitialization()`, `useKeyBindingsInitialization()`, `useLayoutInitialization()`, `useReviewStateInitialization()`, `useFilterPresetsInitialization()`
- Prefer inlining; each effect is 3 LOC and the init sequence is part of App bootstrap logic

**Effort:** S (30 min; mostly refactoring)  
**Confidence:** High

---

### F-t2-hook-4: useIDEKeyboard — Keyboard Handler Owns Terminal, Editor, & Sidebar State

**Severity:** High  
**Category:** Mixed Concerns: View-Level Shortcuts + Terminal State + Editor State  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useIDEKeyboard.ts:1-193`

**Evidence:**
- **193 lines** handling 20+ keyboard shortcuts across 3 panels (editor, terminal, sidebar) with state mutations in 4 different stores
- Lines 34-41: Extract 8 terminal store methods (addTab, closeTab, setActiveTab, toggleSplit, setShowFind, zoomIn, zoomOut, resetZoom)
- Lines 47-150: Single handler function covers:
  - Sidebar toggle (line 50)
  - Terminal toggle (line 56)
  - Open folder dialog (line 62)
  - Save file (line 75)
  - Close editor tab with dirty check (lines 78-85)
  - Terminal-specific shortcuts only when focusedPanel === 'terminal' (lines 94-149) — includes tab, split, find, zoom
  - Clear terminal (line 166)

**Pattern Violation:**
```typescript
// Lines 78-85: Branch on focus state — mixing editor + terminal concerns
if (e.key === 'w') {
  if (focusedPanel === 'editor' && activeTabId) {
    // editor logic
    void handleCloseTab(activeTabId, tab?.isDirty ?? false)
  }
  if (focusedPanel === 'terminal') {
    // terminal logic
    const { activeTabId: tid } = useTerminalStore.getState()
    if (tid) termCloseTab(tid)
  }
}

// Lines 94-149: 60 LOC of terminal-only shortcuts hidden in nested condition
if (focusedPanel === 'terminal') {
  if (e.key === 't') { /* addTab */ }
  if (e.key === 'f') { /* find */ }
  // ... (8 more terminal shortcuts)
}
```

**Dependency Injection Smell:**
- **11 parameters** in UseIDEKeyboardParams interface — callback hell makes testing hard
- Must pass: toggleSidebar, toggleTerminal, handleOpenFolder, handleSave, handleCloseTab, setShowShortcuts, setShowQuickOpen (7 callbacks)
- Plus state: activeView, focusedPanel, activeTabId, openTabs, showShortcuts (5 state props)

**Impact:**
- **Testability:** To test "Cmd+T opens new terminal tab," must:
  - Mock focusedPanel = 'terminal'
  - Provide 7 callback props
  - Verify termAddTab was called (requires mocking useTerminalStore)
  - Verify no editor callbacks were invoked
- **Change Risk:** Adding "Cmd+E opens find" requires finding the right nested `if (focusedPanel === 'editor')` block and understanding 7 other conditional branches
- **Scope Creep:** Hook owns global IDE keybindings AND editor panel state AND terminal state — violates SRP

**Recommendation:**
Split into 2-3 focused hooks:
- `useEditorKeyboard(activeView, focused, activeTabId, openTabs, handlers)` — Cmd+B, Cmd+J, Cmd+O, Cmd+P, Cmd+S, Cmd+W
- `useTerminalKeyboard(focusedPanel)` — Cmd+T, Cmd+F, Cmd+D, Cmd+[, Cmd+], Cmd+=, Cmd+-, Cmd+0, Ctrl+L

Create a parent hook `useIDEKeyboard()` that composes both and handles top-level shortcuts (Cmd+/).

**Effort:** M (2 hours; requires prop drilling cleanup)  
**Confidence:** High

---

### F-t2-hook-5: useAppShortcuts — Global Shortcuts in App Scope (Borderline)

**Severity:** Medium  
**Category:** Mixed Concerns: View Navigation + Panel Management + Palette + Quick Create  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useAppShortcuts.ts:1-220`

**Evidence:**
- **219 lines** handling 20+ global shortcuts across 3 categories:
  1. View navigation: 9 shortcuts (dashboard, agents, ide, sprint, code-review, git, settings, task-workbench, planner)
  2. Panel management: 3 shortcuts (split right, close tab, next/prev tab)
  3. UI toggles: 3 shortcuts (palette toggle, refresh, quick create, ? for help)
- Lines 68-112: Simple view routing logic (9 nearly-identical branches checking keybindings store)
- Lines 121-150: Complex panel manipulation with `findLeaf()` utility and Zustand getState() calls

**Pattern Violation:**
```typescript
// Lines 68-112: Repetitive view switching (9x nearly identical)
if (combo === bindings['view.dashboard']) {
  e.preventDefault()
  setView('dashboard')
  return
}
if (combo === bindings['view.agents']) {
  e.preventDefault()
  setView('agents')
  return
}
// ... (7 more identical blocks)

// Lines 121-150: Imperative panel manipulation with deep tree traversal
if (combo === bindings['panel.splitRight']) {
  e.preventDefault()
  const { focusedPanelId, splitPanel } = usePanelLayoutStore.getState()
  if (focusedPanelId) splitPanel(focusedPanelId, 'horizontal', 'agents')
  return
}
```

**Why It's Less Critical:**
- Hook correctly extracted from App.tsx (reducing file complexity)
- Keybindings abstraction makes shortcuts configurable (users can rebind)
- No IPC calls or modal state ownership
- Concerns are co-located in the "app shell" level (view navigation is inherently coupled)

**Minor Improvement:**
```typescript
// Avoid repetition with a lookup table
const viewMap: Record<string, keyof PanelLayoutStoreState> = {
  'view.dashboard': 'dashboard',
  'view.agents': 'agents',
  // ...
}
// Then: for (const [binding, view] of Object.entries(viewMap)) { if (combo === bindings[binding]) setView(view) }
```

**Recommendation:**
This hook is **acceptable as-is** for app-shell shortcuts. If refactoring, extract panel management:
- `usePanelShortcuts()` — only panel split/close/tab navigation
- `useViewNavigationShortcuts()` — only view switching (with lookup table)

**Effort:** S (1 hour; optional refactor)  
**Confidence:** Medium (borderline acceptable)

---

### F-t2-lib-1: format.ts + task-format.ts — Duplicate formatElapsed Functions

**Severity:** Medium  
**Category:** Utility Sprawl / Dead Code  
**Location:**  
- `/Users/ryan/projects/BDE/src/renderer/src/lib/format.ts:23-29` (formatElapsed)
- `/Users/ryan/projects/BDE/src/renderer/src/lib/task-format.ts:5-11` (formatElapsed, duplicate)

**Evidence:**
- `format.ts:formatElapsed(startedAtMs: number)` — accepts epoch milliseconds, returns "12s", "3m 12s", "1h 02m"
- `task-format.ts:formatElapsed(startedAt: string)` — accepts ISO string, performs same calculation, returns same format
- Two implementations differ only in input handling:
  ```typescript
  // format.ts (line 24)
  const seconds = Math.floor((Date.now() - startedAtMs) / 1000)
  
  // task-format.ts (line 6)
  const ms = Date.now() - new Date(startedAt).getTime()
  const min = Math.floor(ms / 60000)
  ```
- Both live in /lib and are both exported; consumers might use either by accident

**Search Results:**
- format.ts also has `formatDuration()` and `formatDurationMs()` — not duplicated in task-format.ts
- task-format.ts also has `getDotColor(status, prStatus)` — not in format.ts
- Unclear which is the source of truth; both seem actively maintained

**Impact:**
- **Confusion:** Maintainers might fix a bug in format.ts and forget task-format.ts (or vice versa)
- **Code Review:** New code might use wrong variant without noticing duplication
- **Bundle Size:** Minimal (both are small), but indicates lack of organization

**Recommendation:**
Choose one canonical location. Likely `format.ts` (already has 142 LOC, is named "format"). Add overload:
```typescript
export function formatElapsed(startedAt: number | string): string {
  const startedAtMs = typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt
  const seconds = Math.floor((Date.now() - startedAtMs) / 1000)
  // ... rest of logic
}
```

Remove `task-format.ts:formatElapsed()`. Update imports in task-format.ts to re-export from format.ts if needed.

**Effort:** S (30 min)  
**Confidence:** High

---

### F-t2-lib-2: /lib/ Directory Lacks Clear Organization

**Severity:** Medium  
**Category:** Utility Sprawl  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/lib/` (35+ files)

**Evidence:**
- **35+ utility files** with no clear naming pattern:
  - Time/format utilities: format.ts, task-format.ts, task-status-ui.ts
  - Data structures/types: launchpad-types.ts, dashboard-types.ts, view-types.ts, constants.ts
  - Data transformation: agent-messages.ts, tool-summaries.ts, prompt-assembly.ts, pair-events.ts
  - Parsing: diff-parser.ts, stream-parser.ts, extract-test-runs.ts
  - UI helpers: motion.ts, render-markdown.ts, terminal-theme.ts, monaco-theme.ts
  - Layout/display: dag-layout.ts, task-query.ts
  - Configuration: feature-guide-data.ts, default-templates.ts, shortcuts-data.ts
  - Adapters: logPoller.ts, createDebouncedPersister.ts

No README or grouping; files are flat in a single directory.

**Line Count Distribution:**
- Largest: default-templates.ts (309), stream-parser.ts (257), monaco-theme.ts (225)
- Medium: format.ts (142), task-query.ts (210), diff-parser.ts (189)
- Small: utils.ts (13), constants.ts (67), view-registry.ts (111)

**Pattern Violation:**
- No clear distinction between "pure transforms" (agent-messages, tool-summaries) and "UI helpers" (motion, terminal-theme)
- Constants sprinkled across files: POLL_* in constants.ts, DEFAULT_STUCK_MS in useDashboardMetrics.ts, MAX_SEEN_IDS in useTaskNotifications.ts

**Impact:**
- **Discoverability:** New contributor looking for "how to format a duration" must check both format.ts and task-format.ts
- **Maintenance:** Hard to understand lib/ scope; unclear where to add new utility
- **Testing:** 35 separate test files (likely) makes it hard to run a cohesive "utils test suite"

**Recommendation:**
Organize into subdirectories:
```
lib/
  format/
    format.ts (time/duration/token formatting)
    task-format.ts (task-specific formatting, or merge into format.ts)
  parse/
    diff-parser.ts
    stream-parser.ts
    extract-test-runs.ts
  ui/
    motion.ts
    render-markdown.ts
    terminal-theme.ts
    monaco-theme.ts
    task-status-ui.ts
  types/
    launchpad-types.ts
    dashboard-types.ts
    view-types.ts
  data/
    agent-messages.ts
    tool-summaries.ts
    prompt-assembly.ts
    pair-events.ts
  config/
    constants.ts
    feature-guide-data.ts
    default-templates.ts
    shortcuts-data.ts
  layout/
    dag-layout.ts
    task-query.ts
  adapters/
    logPoller.ts
    createDebouncedPersister.ts
  utils.ts (keep minimal catch-all)
```

Add lib/README.md documenting each subdirectory's purpose.

**Effort:** M (2-3 hours to reorganize; mainly moving & updating imports)  
**Confidence:** Medium (organizational, not bug-critical)

---

### F-t2-hook-6: useTaskNotifications — Global State + Local State Multiplexing

**Severity:** Medium  
**Category:** Mixed Concerns: Dedup + State Change Detection + Toast Firing  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useTaskNotifications.ts:1-125`

**Evidence:**
- **125 lines** managing 2 independent notification systems:
  1. **Global dedup state** (module-level `notifiedTaskIds` Set, lines 16-27) — tracks which tasks have been notified to avoid duplicates
  2. **Local component state** (useTaskToasts effect, lines 70-124) — watches task transitions and fires in-app toasts
- Shared functions: `notifyOnce()` (uses global state), `setOpenLogDrawerTaskId()` (module-level setter), `notify()` (desktop notification)
- Two separate IPC concerns: task state changes AND log drawer focus (which suppresses notifications)

**Pattern Violation:**
```typescript
// Module-level state (lines 16-27)
const notifiedTaskIds = new Set<string>()

// Public API to manage module state
export function notifyOnce(taskId: string, title: string, body: string): boolean {
  if (notifiedTaskIds.has(taskId)) return false
  if (openLogDrawerTaskId === taskId) return false  // ← Reaching into another concern's state
  notifiedTaskIds.add(taskId)
  boundSet(notifiedTaskIds, MAX_SEEN_IDS)
  notify(title, body)
  return true
}

// Hook owns task transition detection
export function useTaskToasts(
  tasks: SprintTask[],
  logDrawerTaskId: string | null,
  onViewOutput: (task: SprintTask) => void
): void {
  useEffect(() => {
    // Lines 93-119: Task transition detection + toast firing
    for (const task of tasks) {
      const prev = prevMap.get(task.id)
      if (!prev) continue
      if (logDrawerTaskId === task.id) continue  // ← Replicates the module-level guard
      
      if (prev.status !== 'done' && task.status === 'done') {
        // Check module state again
        if (notifiedTaskIds.has(task.id)) continue
        // Fire toast...
      }
    }
  }, [tasks, logDrawerTaskId])
}
```

**Complexity:**
- `notifyOnce()` is exported and used elsewhere (public API), but its behavior depends on module state that callers can't reset
- Two separate "has this task been notified?" checks: one in notifyOnce (line 35), one in useTaskToasts (line 102)
- Max size handling (boundSet) feels like a memory leak prevention hack rather than a real feature

**Impact:**
- **Testability:** To test "should not notify again if already notified," must:
  - Call notifyOnce() once (populates Set)
  - Call notifyOnce() again (returns false)
  - BUT the Set is module-level; test isolation requires _resetNotifiedTaskIds() (line 30)
  - If test creates two component instances, first one populates global state, second one reuses it
- **Predictability:** Module-level Set means notification dedup persists across component mount/unmount (might be intentional, but unclear)
- **Separation of Concerns:** Hook doesn't own the dedup logic it relies on

**Recommendation:**
Move dedup state into a custom hook:
```typescript
function useNotificationDedup() {
  const [notifiedIds, setNotifiedIds] = useState(new Set<string>())
  
  const notifyOnce = useCallback((taskId: string, title: string, body: string, openLogDrawerTaskId: string | null) => {
    if (notifiedIds.has(taskId) || openLogDrawerTaskId === taskId) return false
    setNotifiedIds(prev => new Set([...prev, taskId]))
    notify(title, body)
    return true
  }, [notifiedIds])
  
  return { notifyOnce, clearNotified: () => setNotifiedIds(new Set()) }
}

// Then useTaskToasts uses notifyOnce from above hook
```

Alternatively, move dedup into the store (useSprintUI or a new useNotificationStore) so it's easier to reset/test.

**Effort:** M (1-2 hours; requires lifting state + testing)  
**Confidence:** Medium

---

### F-t2-hook-7: useSprintTaskActions — Positive Example (Not a God Hook)

**Severity:** N/A (Good Example)  
**Category:** Well-Scoped  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useSprintTaskActions.ts:1-186`

**Evidence:**
Despite being the largest hook mentioned in scope (380 lines), this hook is actually **well-designed**:
- Clear responsibility: "all task mutation callbacks for SprintCenter" (line 24)
- 8 exported methods, all follow a consistent pattern:
  - Optional validation (confirm modal)
  - IPC call OR store mutation
  - Coordinate UI state (selection, drawer)
  - Toast notification
  - Data refresh

**Pattern:**
```typescript
const handleStop = useCallback(async (task: SprintTask) => {
  if (task.status !== 'active') return          // Guard
  const ok = await confirm({...})               // Validation
  if (!ok) return
  try {
    const result = await window.api.agentManager.kill(task.id)  // IPC
    if (result.ok) {
      updateTask(task.id, { status: TASK_STATUS.CANCELLED })  // Store
      toast.success('Agent stopped')            // Feedback
    } else {
      toast.error('Failed to stop agent')
    }
  } catch (e) {
    toast.error(...)
  }
}, [updateTask, confirm])
```

**Why It Works:**
- No modal state ownership — uses `useConfirm()` hook
- No store state ownership — delegates to useSprintTasks & useSprintUI
- No local state (refs or useState)
- All dependencies properly declared in useCallback deps array
- Functions are independently testable (no interdependencies)

**Takeaway:** This hook should be the **model for future action hooks**. The 380 lines are justified by clear, consistent patterns.

---

## Holistic Findings

### Pattern: Action Hooks Tend Toward Complexity
3 of the 5 largest hooks are "action" hooks (useReviewActions 393, useDashboardMetrics 240, useTaskCreation 238, useDashboardMetrics 240, useReviewPartnerActions 210).

These hooks naturally accumulate multiple concerns (IPC + state + notification) because they coordinate between stores, UI, and the main process. Consider a **shared pattern/template** for action hooks:
- Separate "single action" hooks from "batch operation" hooks
- Extract common error handling into `useActionErrorHandling()`
- Use `useTransientAction()` pattern for action-in-flight tracking

### Pattern: Polling & Detection Hooks Are Well-Scoped
useSprintPolling, useDashboardPolling, useGitStatusPolling, useTaskNotifications (state change detection part) are all focused and testable. Good separation of concerns.

### Opportunity: Keyboard Shortcuts Scattered Across Hooks
4 hooks own keyboard logic: useAppShortcuts, useSprintKeyboardShortcuts, useIDEKeyboard, useAppInitialization (implied via custom events).

Consider a **shortcuts registry** or **command palette pattern** to centralize shortcut binding logic instead of distributed listeners.

---

## Severity Breakdown

| Severity | Count | Findings |
|----------|-------|----------|
| **Critical** | 1 | useReviewActions (God Hook) |
| **High** | 2 | useDesktopNotifications (Multiplexing), useIDEKeyboard (Mixed Concerns) |
| **Medium** | 4 | useAppInitialization (Kitchen Sink), format.ts duplication, lib/ organization, useTaskNotifications (Dedup) |

---

## Effort Summary

| Effort | Findings | Hours |
|--------|----------|-------|
| **S** (Small) | format.ts merge, useAppInitialization inline | 1 |
| **M** (Medium) | useIDEKeyboard split, useTaskNotifications dedup, lib/ reorganize | 6 |
| **L** (Large) | useReviewActions extraction | 4 |
| **Total** | — | ~11 hours |

---

## Next Steps

1. **Immediate (Critical):**
   - Schedule F-t2-hook-1 (useReviewActions) for refactor; this is the highest impact
   
2. **High Priority (This Sprint):**
   - F-t2-hook-2 (useDesktopNotifications) — impacts notification reliability
   - F-t2-hook-4 (useIDEKeyboard) — affects editor UX and keyboard testing
   
3. **Nice-to-Have (Next Sprint):**
   - F-t2-lib-1 (format.ts duplication) — quick win
   - F-t2-hook-3 (useAppInitialization) — clarity improvement
   - F-t2-lib-2 (lib/ organization) — long-term maintainability

---


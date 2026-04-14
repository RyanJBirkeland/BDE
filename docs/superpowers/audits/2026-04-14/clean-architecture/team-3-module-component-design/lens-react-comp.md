# React Component Quality Audit — April 14, 2026

## Executive Summary

The BDE React codebase demonstrates **generally solid component design** with clear separation between views and feature components. Most components stay under 300 lines, rely on well-extracted hooks, and delegate business logic to stores and services. However, several **mid-sized components (200–350 lines) are approaching responsibility overload** and contain subtle instances of **implicit abstraction hierarchy mixing** where high-level layout logic intertwines with low-level implementation details. Additionally, a few components exhibit **prop drilling patterns** that could be simplified via context or selective store access. The biggest concerns are not catastrophic violations, but rather **incremental technical debt creeping into otherwise clean architecture** — the types of issues that compound as features expand.

---

## Findings

### F-t3-react-comp-1: WorkbenchForm Combines Form Rendering, Validation UI, and Submission Orchestration

**Severity:** Medium  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/task-workbench/WorkbenchForm.tsx:392 lines`

**Evidence:**  
WorkbenchForm handles:
- Form field rendering (title, repo, advanced options, spec editor)
- Validation check rendering (`<ValidationChecks />`)
- Confirmation modal state for queue blocking logic (`showQueueConfirm`, `queueConfirmMessage`)
- Keyboard shortcut logic (Cmd+Enter handler with inline `describeQueueBlocker()` logic)
- Spec generation and research request logic

The `describeQueueBlocker()` helper (lines 43–53) evaluates validation state inline and returns human-readable blocking reasons. This is good extraction for logic, but the component itself manages three distinct concerns: **form presentation**, **validation presentation**, and **submission orchestration**.

**Impact:**  
When validation rules change, the blocker description must be kept in sync with the ValidationChecks component. When new submission flows are added (e.g., draft vs. queue vs. archive), the conditional modal and submission handlers grow. The component becomes a coordination hub rather than a pure form presenter.

**Recommendation:**  
Extract a `useQueueBlocker()` hook that encapsulates the validation state → human-readable reason logic, and a separate `SubmissionOrchestrator` subcomponent (or custom hook) that owns the confirm modal, submission state machine (`'editing' | 'confirming' | 'submitting'`), and handler dispatch. This leaves WorkbenchForm as a clean form renderer that calls hooks and passes callbacks down.

**Effort:** M  
**Confidence:** High

---

### F-t3-react-comp-2: TaskDetailDrawer Props Overload and Multi-Responsibility Rendering

**Severity:** Medium  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/TaskDetailDrawer.tsx:352 lines`

**Evidence:**  
TaskDetailDrawer accepts 14 callback props (onLaunch, onStop, onRerun, onDelete, onViewLogs, onEdit, onViewAgents, onUnblock, onRetry, onReviewChanges, onExport, plus task and onClose). The component:
1. Renders task metadata (title, status, elapsed time)
2. Displays dependent tasks (`UpstreamOutcomes`)
3. Renders agent activity preview (`AgentActivityPreview`)
4. Dispatches 11+ different action callbacks

The elapsed time computation (lines 73–77) updates every 10 seconds via `useBackoffInterval`, which is legitimate, but the component also manages a custom resize hook (`useDrawerResize`), making it responsible for layout concerns as well as task presentation.

**Impact:**  
Testing this component requires mocking 14 callback signatures. Adding a new task action (e.g., "duplicate task") requires threading a new prop through the parent (SprintPipeline). The component owns too many decision paths.

**Recommendation:**  
Extract an `<ActionMenu>` or `<TaskActions>` subcomponent that owns the action dispatch logic. Pass a single `onAction(type: string, task: SprintTask)` callback instead of 11 individual ones. Hoist the resize logic into the parent container (TaskDetailDrawer becomes a "dumb" presenter of size, while a wrapping component manages the resize handle). This reduces the prop API surface and makes the component testable in isolation.

**Effort:** M  
**Confidence:** High

---

### F-t3-react-comp-3: SprintPipeline Accumulates Orchestration Concerns and Event Listeners

**Severity:** Medium  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/sprint/SprintPipeline.tsx:433 lines`

**Evidence:**  
SprintPipeline is well-decomposed into sub-components (PipelineBacklog, PipelineStage, TaskDetailDrawer, PipelineOverlays, DagOverlay, BulkActionBar). However, it manages:
1. Task selection and multi-selection state (selectedTaskId, selectedTaskIds, clearMultiSelection)
2. Drawer visibility and spec panel visibility (drawerOpen, specPanelOpen)
3. Done view, conflict drawer, and health check drawer state (doneViewOpen, conflictDrawerOpen, healthCheckDrawerOpen)
4. DAG overlay toggle (dagOpen)
5. Log drawer task ID (logDrawerTaskId, with setOpenLogDrawerTaskId side effect sync)
6. Toast notifications and output listener subscriptions (initTaskOutputListener)
7. Keyboard shortcut registration (useSprintKeyboardShortcuts, useSprintPipelineCommands)
8. Command palette registration (useSprintPipelineCommands)

Even though each concern is extracted to a hook, the component coordinates 8+ distinct UI states and 4+ side-effect subscriptions. The focus management pattern (triggerRef) adds another layer. Lines 105–114 and 117–123 set up subscriptions to external event streams and manage side-effect synchronization.

**Impact:**  
Testing the component requires mocking multiple hook return values. Adding a new overlay (e.g., "task metrics panel") requires threading new state and callbacks. The sheer number of open/close toggles makes it hard to reason about the state machine. Future developers adding features will naturally add more to this already-large component.

**Recommendation:**  
Create a `useSprintPipelineUIState()` hook that owns all overlay/drawer visibility toggles and returns a single state object with setters (`{ drawers: { spec: boolean; done: boolean; ... }, setDrawerOpen, closeAllDrawers, ... }`). Extract task output listening into a separate `useTaskOutputNotifications()` hook that subscribes and posts toasts independently. This reduces the component's concern count and makes each concern independently testable.

**Effort:** L  
**Confidence:** Medium (refactor is large but low-risk)

---

### F-t3-react-comp-4: AgentConsole Virtual Scrolling + Search + Playgrounds Mixing Concerns

**Severity:** Medium  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/agents/AgentConsole.tsx:312 lines`

**Evidence:**  
AgentConsole manages:
1. Virtual scrolling with TanStack Virtualizer (`parentRef`, `virtualizer`, overscan tuning)
2. Search state and matching logic (searchOpen, searchQuery, activeMatchIndex, blockMatchesQuery, matchingIndices)
3. Pending message injection (pendingMessages, setPendingMessages)
4. Playground modal state (playgroundBlock, setPlaygroundBlock)
5. Jump-to-latest button logic (showJumpButton, isAtBottomRef)
6. Chat block pairing and rendering (pairEvents, blocks memoization, ConsoleCard dispatch)

The `blockMatchesQuery()` callback (lines 68–100) is a 33-line function embedded in the component that handles 7 different block types. The search result indices are computed separately (lines 102–108). When the component needs to support a new block type or event kind, this function grows.

**Impact:**  
The component is performant (virtualization is well-done), but adding new event types or block kinds requires touching the search matching logic, the block pairing logic, and the rendering dispatch in ConsoleCard. The search feature and virtual scrolling are orthogonal concerns that happen to live in the same component.

**Recommendation:**  
Extract the block matching and search logic into a `useConsoleSearch(blocks)` hook that returns `{ matchingIndices, activeMatch, goToMatch }`. Move `blockMatchesQuery()` into that hook and make it a reducer-friendly data structure. The component then becomes: render virtualizer → pass matched indices to ConsoleCard → let it highlight. This separates the "which blocks match the query?" concern from "how do we render the results?"

**Effort:** M  
**Confidence:** High

---

### F-t3-react-comp-5: CommandBar Manages Autocomplete State, Attachment Handling, and Form Input Simultaneously

**Severity:** Medium  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/agents/CommandBar.tsx:279 lines`

**Evidence:**  
CommandBar owns:
1. Textarea value and attachment state (value, setAttachment)
2. Autocomplete filtering and visibility (filteredCommands, showAutocomplete, autocompleteHidden)
3. Auto-grow textarea logic (useLayoutEffect height adjustment)
4. Clipboard paste handling with image blob parsing (handlePaste, 50+ lines)
5. Key down event routing (Enter, Shift+Enter, Cmd+Enter, arrow keys for autocomplete)
6. Submission dispatch (command vs. message routing)

The `handlePaste()` callback (lines 109–180) contains a 72-line async flow that reads clipboard, checks sizes, and converts to base64. This is correct but sits inside the component. The key-down handler also has complex routing logic (lines 73–97).

**Impact:**  
The component is responsible for form input, clipboard handling, and command dispatch. If the attachment feature expands (e.g., adding file uploads, drag-drop), the component grows further. Testing requires mocking both clipboard APIs and command routing.

**Recommendation:**  
Extract clipboard handling into a `useClipboardAttachment()` hook that returns `{ attachment, setAttachment, handlePaste }`. Extract command vs. message dispatch into `useCommandBarSubmit()` that encapsulates the routing logic. This leaves CommandBar focused on textarea rendering, autocomplete UI, and key bindings.

**Effort:** M  
**Confidence:** High

---

### F-t3-react-comp-6: DependencyPicker Mixing List Rendering with Dropdown State and Complex Filtering

**Severity:** Low  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/task-workbench/DependencyPicker.tsx:253 lines`

**Evidence:**  
DependencyPicker manages:
1. Dropdown open/close state and focus management (dropdownOpen, searchRef, closeDropdown)
2. Search filtering with lazy windowing (search, allMatches, visibleTasks, hasMore, showAll)
3. Dependency list rendering and type toggling (selectedIds, dependencies.map with toggle UI)
4. Condition picker dropdown per dependency (condition select in a nested rendered list)
5. Outside-click handling and escape key handling

While well-structured, the component handles both **list presentation** (showing selected dependencies with edit controls) and **dropdown picker UI** (search, autocomplete, windowing). These are separable concerns.

**Impact:**  
Testing the dropdown picker requires resetting state on every test. Adding new dependency type options (currently hard/soft) or condition options requires threading changes through both the picker and the list. The 30-line result window and pagination logic is correct but would be clearer in isolation.

**Recommendation:**  
Extract a `<DependencySearchDropdown>` component that owns searchRef, dropdownOpen, allMatches, visibleTasks, pagination, and the search input UI. Return `onSelectTask` callback to the parent (DependencyPicker), which owns the selectedIds list and type/condition toggles. This is a lower-priority refactor since the component is already well-structured; this is a "nice to have" factorization.

**Effort:** S  
**Confidence:** Medium

---

### F-t3-react-comp-7: GitTreeView Props Drilling and Event Handler Proliferation (400 lines)

**Severity:** Low  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/views/GitTreeView.tsx:400 lines`

**Evidence:**  
GitTreeView is a view that owns git repository state and renders three main sections:
1. Header with repo selector, branch selector, and action buttons (fetch, pull, refresh)
2. CommitBox for commit message and push/commit buttons
3. Three FileTreeSection components for staged, unstaged, and untracked files

The component defines 16 handler functions (handleRefresh, handleRepoChange, handleCheckout, etc., lines 75–204). These are mostly thin wrappers around store actions, but they accumulate quickly. The component also manages error state and retry logic (lastError, lastErrorOp, lines 304–327).

The FileTreeSection components receive 6 props each (title, files, isStaged, selectedPath, onStageFile, onUnstageFile, etc.), creating a prop-passing pattern that is not quite drilling (only 1–2 levels), but borders on it.

**Impact:**  
The handler functions are straightforward, but having 16 of them in one file makes the component harder to navigate. Adding a new git operation (e.g., "rebase onto main") requires adding a handler, wiring it to a button, and passing it to the component tree.

**Recommendation:**  
This is low-priority. The component is well-structured and these handlers are mostly thin. If it grows further, consider extracting git action handlers into a `useGitActions()` hook. The current structure is acceptable for a 400-line view.

**Effort:** S  
**Confidence:** Low (not a critical issue)

---

### F-t3-react-comp-8: DashboardView's Morning Briefing Logic Mixes Business Logic with Render Logic

**Severity:** Low  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/views/DashboardView.tsx:321 lines`

**Evidence:**  
DashboardView includes a morning briefing feature (lines 63–95) that:
1. Checks localStorage for the last window close time
2. Filters tasks completed since the last close
3. Shows a MorningBriefing modal if new completions exist
4. Updates localStorage on dismiss

While this logic is isolated to a `useEffect` block and guarded by `briefingChecked`, it mixes:
- **Storage I/O** (localStorage.getItem/setItem)
- **Date arithmetic** (comparing timestamps)
- **Task filtering** (finding new completions)
- **UI state management** (showBriefing, setBriefingTasks)

The FreshnessLabel subcomponent (lines 32–47) is a nice extraction for avoiding full re-renders on the 10-second ticker, but the morning briefing logic sits inline in the main component.

**Impact:**  
If the morning briefing feature grows (e.g., adding summary stats, filtering by status, or persisting dismissed tasks), the component grows further. Testing the morning briefing feature requires mocking localStorage and running the full DashboardView mount.

**Recommendation:**  
Extract a `useMorningBriefing()` hook that encapsulates the localStorage logic, timestamp comparison, and task filtering. Return `{ showBriefing, briefingTasks, handleDismiss }`. This is a low-priority refactor since the feature is already isolated, but it would make the component cleaner.

**Effort:** S  
**Confidence:** Low

---

### F-t3-react-comp-9: TopBar Props Overload and Conditional Batch Mode Logic

**Severity:** Low  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/components/code-review/TopBar.tsx:200 lines`

**Evidence:**  
TopBar coordinates batch mode (selected multiple tasks) vs. single-task mode. It:
1. Calls multiple hooks (useCodeReviewStore, useSprintTasks, useReviewPartnerStore, useReviewActions, useTaskAutoSelect, useBatchActions)
2. Renders entirely different UIs based on `isBatchMode` (lines 68–130 vs. 133–199)
3. Passes 5 props to BatchActionsToolbar (selectedCount, batchActionInFlight, ghConfigured, onMergeAll, onShipAll, onCreatePrs, onDiscard, onClear)
4. Renders conditionally based on task selection validity

The component is 200 lines because it contains two nearly identical UI branches (batch mode and normal mode), each with its own action handlers.

**Impact:**  
Adding a new batch action requires updating both the batch mode handler dispatch and the normal mode state. The two branches are visually similar but have subtle handler differences.

**Recommendation:**  
Extract batch mode logic into a dedicated `<BatchModeBar>` component. Then TopBar becomes:
```jsx
{isBatchMode ? <BatchModeBar /> : <NormalModeBar />}
```
This is a low-priority refactor since the component is already under control, but it would reduce duplication.

**Effort:** S  
**Confidence:** Medium

---

### F-t3-react-comp-10: PlannerView Keyword Prop Shadowing and State Explosion Risk

**Severity:** Low  
**Category:** React Component Quality  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/views/PlannerView.tsx:207 lines`

**Evidence:**  
PlannerView manages:
1. Task groups store state and actions (groups, selectedGroupId, loading, etc.)
2. Search query state (searchQuery, setSearchQuery)
3. Create modal state (showCreateModal, setShowCreateModal)
4. Confirm modal state (confirm, confirmProps)
5. Task filtering by search (useMemo)
6. Multiple callback handlers (handleCreateNew, handleAddTask, handleEditTask, handleEditGroup, handleDeleteGroup, handleToggleReady, etc.)

The view is well-structured and under 210 lines, but it has absorbed 8+ distinct UI states. While each state is necessary, the component is approaching saturation. Future features (sorting, bulk operations, pagination) would naturally add more.

**Impact:**  
The component is still manageable, but testing requires setting up multiple store interactions and modal states. Adding a sort toggle or filter option will make the component harder to reason about.

**Recommendation:**  
This is preventative. Extract modal state into a custom hook: `useConfirmDialog()` returns `{ confirmProps, openConfirm, closeConfirm }`. Extract create modal state into `useCreateModal()`. This is a low-priority refactor since the component is still under 210 lines, but it's a useful pattern for future expansion.

**Effort:** S  
**Confidence:** Low

---

## Patterns and Conclusions

### Positive Observations

1. **Hook extraction is consistent:** Most components that orchestrate complex logic use extracted hooks (useSprintTaskActions, useBatchActions, useDashboardMetrics, etc.). This is excellent.
2. **Subcomponent decomposition is practiced:** Large components like SprintPipeline, AgentConsole, and CommandBar all break down into smaller, single-purpose subcomponents. This is a strength.
3. **Store access is centralized:** Components rely on Zustand stores for state, avoiding prop drilling and keeping data flow explicit.
4. **View vs. component separation is clear:** Views (AgentsView, DashboardView, SprintView) own panel-level orchestration, while components own feature details.

### Recurring Issues

1. **Mid-sized components (200–350 lines) accumulate multiple concerns:** Each concern is individually small, but together they create a "don't know where to make the next change" scenario.
2. **Callback proliferation:** Components that dispatch many actions (TaskDetailDrawer, TaskDetailActionButtons) pass 10+ props. Consolidating via a single `onAction(type, ...args)` callback would reduce surface area.
3. **Embedded utility functions:** Functions like `describeQueueBlocker()`, `blockMatchesQuery()`, and `handlePaste()` are logically sound but sit inside components. Extracting them to hooks or utilities would improve testability.
4. **Keyboard and event handling:** Several components manage keyboard shortcuts, clipboard events, and outside-click handlers. These patterns are correct but could be standardized via custom hooks.

### Recommendations for Future Growth

1. **Create a `useComponentActions(actionMap)` hook** that takes a record of action names and handlers, and returns dispatch and loading state. This would consolidate the pattern seen in TaskDetailActionButtons and CommandBar.
2. **Establish a modal state pattern:** useConfirmDialog(), useCreateModal(), useFeedbackModal(). This prevents modal state explosion.
3. **Extract event listeners into dedicated hooks:** useOutsideClick(), useKeyboardShortcuts(), useClipboardAttachment(). These are often copied between components.
4. **Document component responsibility limits:** Guidelines like "a component should have ≤ 3 top-level state variables (not counting props)" or "a component should call ≤ 4 custom hooks" would help maintain discipline as the codebase grows.

---

## Summary Table

| Finding | Severity | Effort | Status |
|---------|----------|--------|--------|
| F-t3-react-comp-1: WorkbenchForm | Medium | M | Actionable |
| F-t3-react-comp-2: TaskDetailDrawer | Medium | M | Actionable |
| F-t3-react-comp-3: SprintPipeline | Medium | L | Actionable |
| F-t3-react-comp-4: AgentConsole | Medium | M | Actionable |
| F-t3-react-comp-5: CommandBar | Medium | M | Actionable |
| F-t3-react-comp-6: DependencyPicker | Low | S | Nice-to-have |
| F-t3-react-comp-7: GitTreeView | Low | S | Preventative |
| F-t3-react-comp-8: DashboardView | Low | S | Nice-to-have |
| F-t3-react-comp-9: TopBar | Low | S | Nice-to-have |
| F-t3-react-comp-10: PlannerView | Low | S | Preventative |


# Component Responsibility Auditor — Lens: comp

## F-t2-comp-1: SprintPipeline Mixed Data Fetching, State Management, and UI Orchestration
**Severity:** High
**Category:** God Component, Mixed Data/Display/Logic
**Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:48-485`
**Evidence:**
- Subscribes to 6 stores (sprintTasks, sprintUI, panelLayout, taskWorkbench, sprintEvents, codeReview)
- Owns filtering logic via `useFilteredTasks()` hook that partitions 6+ task groups
- Manages 7+ UI drawers/panels (TaskDetailDrawer, SpecPanel, DoneView, ConflictDrawer, HealthCheckDrawer, DagOverlay, BulkActionBar)
- Handles 9+ distinct callbacks (handleTaskClick, handleAddToQueue, handleUnblock, handleReviewChanges, handleExport, etc.)
- Initializes task output listener and notification system
- Routes cross-domain actions (selectCodeReviewTask, loadTaskInWorkbench) across 3 different stores
- Lines 112-139: Registers 4 pipeline commands in command palette
**Impact:**
- Any change to task display, filtering, or action flow requires modifying this 485-line monolith
- Testing is fragmented across store mocks, hook mocks, and prop drilling
- New drawer types force prop additions and callback plumbing
- Changes to health-check or conflict logic affect the entire component's render cycle
**Recommendation:**
- Extract `<TaskDetailPane>` owning TaskDetailDrawer + its 10 action callbacks
- Move partition computation and auto-select logic into `useSelectedTask()` hook
- Decouple filtering UI (PipelineFilterBar, PipelineFilterBanner) from main component state
**Effort:** L
**Confidence:** High

---

## F-t2-comp-2: TopBar (Code Review) Monolithic Batch Action Handler
**Severity:** High
**Category:** Inline Business Logic, Mixed Data/Display, Prop Drilling
**Location:** `src/renderer/src/components/code-review/TopBar.tsx:65-137`
**Evidence:**
- 4 nearly-identical async batch action handlers (handleBatchMergeAll, handleBatchShipAll, handleBatchCreatePr, handleBatchDiscard) — each 25-30 lines
- Each handler: confirm → loop tasks → call API → update UI state → toast
- Contains toggle state for taskSwitcherOpen + ref management
- Handles task auto-selection via useTaskAutoSelect() hook and manual task lookup logic
- Manages confirmation modal state and integration
- 438 total lines: includes UI layout, batch actions, single-task actions, AND data fetching coordination
**Impact:**
- Batch action logic is copy-paste duplicated; bug in one affects all four
- Difficult to add new batch actions (requires copying handler pattern + registering button + managing loading state)
- No clear separation between "batch coordinator" and "single-task review orchestrator"
**Recommendation:** Extract `<BatchActionHandler>` component that owns all 4 batch callbacks using a configurable action config array rather than 4 separate functions. Move TaskSwitcher logic to separate component.
**Effort:** M
**Confidence:** High

---

## F-t2-comp-3: AgentsView Multi-Purpose Command Palette, Event Streaming, and UI Orchestration
**Severity:** High
**Category:** God Component, Mixed Data/Display/Logic
**Location:** `src/renderer/src/views/AgentsView.tsx:22-250`
**Evidence:**
- Initializes 5+ event listeners (spawn modal trigger, scratchpad banner, agent events init, history loading)
- Owns 8 local state variables + 3 command palette states
- Manages agent selection fallback logic
- Registers 2 commands (spawn, clear-console) in command palette
- Implements 6 command handlers (/stop, /retry, /focus, /checkpoint, /test, /scope, /status) lines 158-240
- Owns both UI (launchpad, console, banner, tooltip) AND command routing logic
- Handles steering/instruction formatting with attachment logic (lines 131-153)
**Impact:**
- Changes to command set require modifying view-level component + agent console
- Event listener cleanup is fragmented across multiple useEffect hooks
- Unclear separation between "agent selection/display" (UI) and "agent control" (command logic)
**Recommendation:** Extract `<AgentCommands>` hook that owns all /command logic and returns handlers. Move scratchpad banner and tooltip to separate controlled components. Consolidate event listeners into `useAgentViewLifecycle()` hook.
**Effort:** M
**Confidence:** High

---

## F-t2-comp-4: IDEView Panel Layout Coupling + State Restoration + File Management
**Severity:** Medium
**Category:** Mixed Concerns, Prop Drilling
**Location:** `src/renderer/src/views/IDEView.tsx:40-280`
**Evidence:**
- Lines 45-88: State restoration logic (IDE.state → multiple setters)
- 13 subscriptions from useIDEStore via useShallow
- Manages unsaved dialog coordination
- Handles panel ref + collapse/expand logic (lines 143-151)
- File loading and content management (lines 154-172)
- File save race condition handling with savingPaths Set (lines 175-190)
- beforeunload guard (lines 232-242)
- Command palette registration (lines 245+)
**Impact:**
- State restoration, panel management, file operations, and commands are tangled
- Testing requires mocking IDE store, panel refs, settings API, and file API simultaneously
**Recommendation:**
- Extract `useIDEStateRestoration()` hook
- Extract `useFileOperations()` hook
- Extract `useUnsavedGuard()` hook
- Extract `useIDECommands()` hook
**Effort:** M
**Confidence:** Medium

---

## F-t2-comp-5: TerminalTabBar Tab Management + Scroll + Context Menu + Editing + Dragging
**Severity:** Medium
**Category:** Monolithic Interaction Handler
**Location:** `src/renderer/src/components/terminal/TerminalTabBar.tsx:22-417`
**Evidence:**
- 8 local state variables managing independent concerns (editing, context menu, dragging, pickers)
- 4 useEffect hooks for overflow checking, edit input focus, context menu click-outside, context menu auto-focus
- 6 event handlers (rename submit/cancel, context menu, middle-click, drag handlers, scroll)
- Context menu keyboard navigation with 3-item fallback logic (lines 99-128)
- Mixed concerns: tab rendering + actions + scroll UI + pickers (ShellPicker, AgentPicker)
**Impact:**
- Tab interaction state is scattered across useEffect cleanups
- Adding new tab features requires modifying prop list and handler registration
**Recommendation:** Extract `<TabContextMenu>` component with its own state. Extract `<TabEditMode>` composition. Consolidate overflow checking into `useTabOverflow()` hook.
**Effort:** M
**Confidence:** Medium

---

## F-t2-comp-6: WorkbenchForm Validation, Generation, Submission, and Keyboard Shortcut Handling
**Severity:** Medium
**Category:** Mixed Data/Display/Logic
**Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:57-250`
**Evidence:**
- Calls 3 custom hooks (useValidationChecks, useSpecQualityChecks, useTaskCreation) that own critical logic
- Owns 5 local state variables (submitting, generating, queueConfirm, contractExpanded, titleRef)
- Handles form submission with queue confirmation flow (lines 115-139)
- Spec generation async logic (lines 152-170)
- Research copilot delegation (lines 172-178)
- Keyboard shortcut handler with queue blocker description logic (lines 181-198)
- Queue blocker logic duplicated from earlier in file (lines 41-51)
**Impact:**
- Form validation spans useTaskWorkbenchStore + local state + custom hooks
- Keyboard shortcut behavior is tightly coupled to UI component; difficult to reuse
**Recommendation:** Extract `useFormSubmission()` hook owning queue confirmation, blocker detection, and success/error toasting. Extract `<QueueConfirmModal>`. Move `describeQueueBlocker()` to workbench store.
**Effort:** M
**Confidence:** Medium

---

## F-t2-comp-7: DiffViewer Virtualization Logic Mixed with Selection State and Keyboard Navigation
**Severity:** Medium
**Category:** Mixed Concerns, Monolithic Interaction
**Location:** `src/renderer/src/components/diff/DiffViewer.tsx:212-473`
**Evidence:**
- 8 useMemo blocks computing flat rows, offsets, commentsByPosition, pendingByPosition, allHunks, etc.
- VirtualizedDiffContent nested component with its own scroll + offset calculation (lines 61-178)
- Keyboard navigation logic (lines 372-421) handles both file + hunk stepping
- Comment selection state (composerRange, selectionStart, isSelecting) managed at top level
- 4 refs (containerRef, fileRefs, hunkRefs) for scroll-to coordination
- Supports 2 render paths (virtualized vs. plain) with different interaction models
**Impact:**
- Virtualization threshold logic couples rendering strategy to comment presence
- Changes to keyboard shortcuts affect both navigation handler + hunk stepping logic
**Recommendation:** Extract `<VirtualizedDiff>` and `<PlainDiff>` as fully independent components. Extract `useDiffKeyboardNavigation()` hook. Move comment state management to a higher-order component or context.
**Effort:** M
**Confidence:** Medium

---

## F-t2-comp-8: GitTreeView Repository Operations, File Selection, Error Handling, and Command Registration
**Severity:** Medium
**Category:** Mixed Concerns, Prop Drilling
**Location:** `src/renderer/src/views/GitTreeView.tsx:25-468`
**Evidence:**
- 13 store subscriptions from useGitTreeStore
- 8 callback handlers for git operations (stage, unstage, commit, push, fetch, pull, checkout, refresh)
- Inline handlers for FileTreeSection onStageAll logic (lines 388-401, 417-430) duplicated in 2 sections
- Command palette registration for 4 commands (lines 112-156)
- Error banner management (lastError, lastErrorOp) with retry logic
**Impact:**
- Stage/unstage logic is copy-pasted in two FileTreeSection render branches
- Error retry logic couples to specific operation types (push/commit)
**Recommendation:** Extract `useGitOperations()` hook returning handlers + loading states + error state. Extract error banner to separate component with own retry logic.
**Effort:** M
**Confidence:** Medium

---

## F-t2-comp-9: DashboardView Data Aggregation, Filtering, and Cross-Store Coordination
**Severity:** Medium
**Category:** Mixed Data/Display, Prop Drilling
**Location:** `src/renderer/src/views/DashboardView.tsx:49-280`
**Evidence:**
- Subscribes to 5 stores (sprintTasks, costData, dashboardData, sprintUI, panelLayout)
- Manages morning briefing state with one-time check (briefingChecked ref)
- Navigation helpers combine filter setters across 3 stores (lines 156-179)
- Staleness computation with Date.now() in render
- Isolated FreshnessLabel component to prevent cascading re-renders from 10s ticker
**Impact:**
- Cross-store navigation logic (lines 156-179) is difficult to reuse in other views
- Morning briefing logic can't be shared with other views
**Recommendation:** Extract `useNavigateWithFilter()` hook. Extract `useMorningBriefing()` hook. Move staleness computation into dashboardData store selector.
**Effort:** S
**Confidence:** Medium

---

## F-t2-comp-10: WorkbenchCopilot Streaming Coordination + Message State + Scroll Behavior
**Severity:** Low
**Category:** Mixed Concerns
**Location:** `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx:51-250`
**Evidence:**
- activeStreamIdRef + streaming state sync logic (lines 66-116) with complex branching for placeholder streamId
- Separate scroll auto-behavior (lines 122-125) triggered by streaming content length changes
- Message send logic combines user message creation, assistant message creation, stream init, and API call (lines 127-176)
- Tool-use formatting logic embedded in streaming listener
- Insert logic couples to spec field updates (lines 188-195)
**Impact:**
- Streaming state is fragmented across ref + store + complex conditional logic
- Auto-scroll behavior is a separate concern but triggered by same streaming content
**Recommendation:** Extract `useChatStreaming()` hook managing streamId coordination. Extract `useAutoScroll()` hook.
**Effort:** S
**Confidence:** Low

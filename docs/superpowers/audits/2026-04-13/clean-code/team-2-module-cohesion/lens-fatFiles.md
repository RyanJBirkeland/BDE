# Fat Files Audit Report — 2026-04-13

## Executive Summary
This audit identified **8 critical findings** where files exceed 250 lines of code (excluding comments/blanks) and violate the Single Responsibility Principle at the module level. These files mix 2-4 distinct operational domains, creating friction for feature development, testing, and long-term maintenance.

The most severe violations are in the data layer (sprint-queries.ts: 805 lines, 30+ operations across CRUD, filtering, stats, and dependency management) and the agent orchestration layer (agent-manager/index.ts: 713 lines, combining lifecycle management, dependency indexing, concurrency control, and watchdog logic).

---

## F-t2-fatFiles-1: Sprint-Queries Module Conflation
**Severity:** Critical
**Category:** Too Large | Mixed Responsibilities
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts` (805 lines)
**Evidence:**
- 30+ exported functions across 5 distinct domains:
  1. **Task CRUD operations** (createTask, updateTask, deleteTask, getTask, listTasks)
  2. **Queue management** (getQueuedTasks, claimTask, releaseTask, getActiveTaskCount)
  3. **Status tracking** (markTaskDoneByPrNumber, markTaskCancelledByPrNumber, getQueueStats)
  4. **Dependency & relationship queries** (getTasksWithDependencies, getOrphanedTasks, updateTaskMergeableState)
  5. **Reporting & analytics** (re-exports from reporting-queries, pruneOldDiffSnapshots)
- Helper functions for serialization, mapping, validation (mapRowToTask, serializeFieldForStorage, withErrorLogging)
- Complex update allowlist & column validation logic (UPDATE_ALLOWLIST, COLUMN_MAP)

**Impact:**
- Changes to one feature (e.g., queue state transitions) require understanding & potentially modifying unrelated paths (e.g., orphan recovery logic)
- Testing is coupled — a bug in CRUD affects all callers of the module
- Merge conflicts inevitable when multiple features edit different sections (multiple teams edit same file for different features)
- Difficult to stub/mock for integration tests without importing entire monolithic module
- Module file grows unbounded as new query patterns emerge

**Recommendation:**
Split into 4-5 focused repositories:
- **sprint-task-crud.ts**: createTask, updateTask, deleteTask, getTask, listTasks, listTasksRecent, createReviewTaskFromAdhoc
- **sprint-task-queue.ts**: claimTask, releaseTask, getQueuedTasks, getActiveTaskCount, getQueueStats
- **sprint-task-status.ts**: markTaskDoneByPrNumber, markTaskCancelledByPrNumber, updateTaskMergeableState, listTasksWithOpenPrs, getHealthCheckTasks
- **sprint-task-graph.ts**: getTasksWithDependencies, getOrphanedTasks, checkAndBlockDeps (if exists)
- **sprint-task-maintenance.ts**: pruneOldDiffSnapshots, getAllTaskIds, clearSprintTaskFk
- Move cross-cutting concerns (UPDATE_ALLOWLIST, mapRowToTask, serializeFieldForStorage) to **sprint-task-serialization.ts**

Shared helpers (setSprintQueriesLogger, withErrorLogging) in **sprint-queries-shared.ts**.

**Effort:** L
**Confidence:** High

---

## F-t2-fatFiles-2: AgentManager Class — Orchestration + Lifecycle + Dependency Graph
**Severity:** Critical
**Category:** Too Large | Mixed Abstraction Levels
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts` (713 lines)

**Evidence:**
- **Concurrency & task claim logic** (_spawnAgent, _validateDrainPreconditions, _drainQueue — slot allocation, circuit breaker, task claiming)
- **Dependency graph indexing & maintenance** (_refreshDependencyIndex, _lastTaskDeps cache, DependencyIndex rebuild in onTaskTerminal)
- **Watchdog & health monitoring** (_watchdogLoop, verdict handling, rate-limit detection, process killing)
- **Terminal status resolution** (onTaskTerminal, resolveDependents calls, dependency unblocking)
- **Configuration hot-reload** (reloadConfig method, settings munging)
- **Metrics collection** (MetricsCollector integration, field increment calls)
- **Internal timers & lifecycle** (start, stop, pollTimer, watchdogTimer, orphanTimer, pruneTimer management)

Single 892-line class with 30+ methods mixing state machines, graph algorithms, timer management, and IPC signaling.

**Impact:**
- Hard to understand control flow — concurrency state, dependency indexing, and watchdog verdict operate at different abstraction levels in same method body
- Changes to dependency logic (F-t4-lifecycle-5 guard) require touching watchdog/terminal code
- Testing requires massive mock setup and complex test fixture initialization
- Dependency index refresh buried inside onTaskTerminal makes that code path harder to reason about
- Cannot reuse watchdog logic independent of full AgentManager
- Feature flag for new drain logic requires modifying core orchestrator

**Recommendation:**
Extract into 4 focused classes:
- **AgentOrchestrator** (new): Owns the main loop (start, stop, _drainQueue, _spawnAgent spawn orchestration, but NOT claim logic)
  - Delegates to other services for concerns
  - Exposes public API: start(), stop(), getStatus()
- **AgentConcurrencyManager** (new): Wraps concurrency.ts logic
  - claimTask, releaseTask, availableSlots, circuit breaker decisions
  - Single responsibility: task slot allocation
- **DependencyGraphService** (extracted): Owns _refreshDependencyIndex, _lastTaskDeps, dep index rebuild
  - Inject into AgentOrchestrator
  - Can be tested in isolation with mock task data
- **AgentWatchdog** (extracted): Owns _watchdogLoop, verdict classification, process killing
  - Current: embedded in AgentManagerImpl._watchdogLoop()
  - Extracted: standalone class with start/stop, inject as dependency
- **StatusTransitionHandler** (extracted): onTaskTerminal resolution logic
  - Move resolveDependents call, _terminalCalled guard, metrics increment here
  - Cleaner separation of concerns from orchestrator

Use **dependency injection** to wire these together in AgentManager factory. Original AgentManagerImpl becomes thin facade that composes services.

**Effort:** L (extract, wire, test separately)
**Confidence:** High

---

## F-t2-fatFiles-3: Run-Agent — Lifecycle Orchestration + Message Consumption + Cost/Token Tracking
**Severity:** High
**Category:** Mixed Responsibilities | Mixed Abstraction Levels
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts` (617 lines)

**Evidence:**
- **Spawn & process lifecycle** (spawnWithTimeout, process.on('exit'), cleanup, worktree cleanup)
- **Message consumption & classification** (consumeMessages, isRateLimitMessage, fast-fail classification, exitCode handling)
- **Cost & token tracking** (trackAgentCosts, updateAgentMeta, turn-based accounting)
- **Playground detection & HTML write handling** (detectHtmlWrite, tryEmitPlaygroundEvent)
- **Partial diff capture** (capturePartialDiff after agent completion)
- **OAuth error handling & recovery** (handleOAuthRefresh, auth failure detection)
- **Prompt construction & context** (buildAgentPrompt, fetchUpstreamContext, readPriorScratchpad)
- **Event emission & logging** (mapRawMessage, emitAgentEvent, lastAgentOutput tracking)

All bundled in a single function with deeply nested callbacks and error paths.

**Impact:**
- Hard to add new agent behaviors without touching message consumption pipeline
- Testing any path requires mocking 10+ dependencies and process lifecycle
- OAuth refresh logic buried in message handler makes error handling non-obvious
- Partial diff capture side effect during completion cleanup breaks single responsibility
- Cannot unit test cost tracking separately from process lifecycle

**Recommendation:**
Decompose into:
- **AgentProcessLifecycle** (class): Process spawn, monitoring, cleanup
  - Methods: spawn(), waitForCompletion(), kill()
  - Owns: spawnWithTimeout, worktree cleanup, exit code handling
- **AgentMessageHandler** (class): Message classification, cost/token parsing
  - Methods: consumeMessages(process, deps), trackCosts(msg, agent)
  - Owns: isRateLimitMessage, getNumericField, fast-fail classification
- **AgentContextBuilder** (helper module): Context assembly before spawn
  - Functions: fetchUpstreamContext(), readPriorScratchpad(), buildAgentPrompt()
  - Extracted from current logic — testable independently
- **PlaygroundEventEmitter** (helper module): Playground detection & HTML write handling
  - Functions: detectHtmlWrite(), tryEmitPlaygroundEvent()
  - Extracted from message stream — clear responsibility boundary
- **AgentErrorHandler** (helper module): OAuth refresh, error classification
  - Functions: handleOAuthRefresh(), classifyExit(), is-rateLimit logic
  - Owns: error recovery strategy decisions

Keep **runAgent()** as coordinator that wires these services together. Use dependency injection.

**Effort:** M (extract to helper functions/classes, introduce DI container, retest)
**Confidence:** High

---

## F-t2-fatFiles-4: Handlers/Workbench — Spec Validation + AI Generation + IPC Registration
**Severity:** High
**Category:** Mixed Responsibilities | Mixed Abstraction Levels
**Location:** `/Users/ryan/projects/BDE/src/main/handlers/workbench.ts` (349 lines)

**Evidence:**
- **Spec quality validation** (mapQualityResult, CheckField classification, severity filtering for clarity/scope/filesExist)
- **AI-assisted spec generation** (generateSpec call, buildChatPrompt, runSdkStreaming integration)
- **Task extraction from LLM output** (extractTasksFromPlan integration, copilot service)
- **IPC handler registration** (registerWorkbenchHandlers, safeHandle wrapping, auth checks)
- **Streaming management** (activeStreams Map, stream lifecycle, close handlers)
- **Operational validation** (checkOperational handler with auth, git, repo discovery checks)

**Impact:**
- Cannot reuse spec validation logic outside of IPC handler context
- Hard to test validation mapping (mapQualityResult) without mocking entire handler registration
- Spec generation logic coupled to IPC layer — difficult to call from other contexts
- Streaming management scattered across handler implementations

**Recommendation:**
Split into:
- **SpecQualityValidator** (class/module): Spec validation & quality result mapping
  - Export: mapQualityResult(result: SpecQualityResult), createQualityService(), checkSpec()
  - Test independently from IPC layer
  - Reusable in renderer-side validation
- **SpecGenerationService** (or extend existing): AI-assisted spec generation
  - Methods: generateSpec(taskId, title, repo, templateHint), extractTasksFromPlan()
  - Already exists — just decouple from IPC handler
- **WorkbenchIPCHandlers** (module): Pure IPC handler registration
  - registerWorkbenchHandlers(am?, deps)
  - Delegates to services above — no business logic
  - safeHandle wrapping only
- **WorkbenchStreamManager** (helper): Stream lifecycle management
  - Methods: createStream(), closeStream(), broadcastChunk()
  - Extracted from handler implementations

Move helper functions (mapQualityResult) to SpecQualityValidator. Handlers become thin adapters.

**Effort:** M
**Confidence:** High

---

## F-t2-fatFiles-5: Git-Operations — Multi-Purpose Git Utility Belt
**Severity:** High
**Category:** Too Large | Mixed Responsibilities
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/git-operations.ts` (505 lines)

**Evidence:**
- **PR operations** (generatePrBody, createNewPr, findOrCreatePR, checkExistingPr)
- **Merge & rebase operations** (rebaseOntoMain, ffMergeMain, autoCommitIfDirty, executeSquashMerge, attemptAutoMerge in related file)
- **Branch management** (deleteBranch, forceDeleteBranchRef, listWorktrees, removeWorktreeForce)
- **Worktree operations** (addWorktree, pruneWorktrees, cleanupWorktreeAndBranch)
- **Git state checking** (hasCommitsAheadOfMain, checkExistingPr output parsing)
- **Post-merge hooks** (runPostMergeDedup integration, GIT_ARTIFACT_PATTERNS)

All global async functions with shared error handling & retry logic.

**Impact:**
- Changes to PR creation logic (createNewPr, checkExistingPr, generatePrBody) affect worktree cleanup code
- Cannot use branch operations independently from PR logic without importing entire module
- Testing any operation requires understanding git subprocess patterns & mocking entire execFile/retry logic
- Squash merge retries and branch operations share error paths — hard to change one without affecting other

**Recommendation:**
Reorganize into 4-5 focused modules:
- **pr-operations.ts**: PR creation, updates, body generation
  - Export: generatePrBody(), createNewPr(), checkExistingPr(), findOrCreatePR()
  - Owns: PR_CREATE_MAX_ATTEMPTS, PR_CREATE_BACKOFF_MS, retry logic
- **branch-operations.ts**: Branch creation, deletion, merging
  - Export: deleteBranch(), forceDeleteBranchRef(), rebaseOntoMain(), ffMergeMain()
  - Owns: error classification for branch operations
- **worktree-operations.ts**: Worktree lifecycle
  - Export: addWorktree(), listWorktrees(), removeWorktreeForce(), pruneWorktrees()
- **commit-operations.ts**: Commit & diff operations
  - Export: autoCommitIfDirty(), hasCommitsAheadOfMain(), executeSquashMerge()
  - Owns: GIT_ARTIFACT_PATTERNS, staging/unstaging logic
- **git-common.ts**: Shared helpers
  - Export: sleep(), sanitizeForGit(), buildAgentEnv(), runPostMergeDedup()
  - Owns: execFile promisification, error handling utils

Keep a **git-operations.ts** that re-exports all (for backward compatibility) but breaks implementation into focused modules.

**Effort:** M
**Confidence:** High

---

## F-t2-fatFiles-6: PanelLayout Store — Panel Tree Manipulation + Persistence + Serialization
**Severity:** High
**Category:** Too Large | Mixed Responsibilities
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/stores/panelLayout.ts` (453 lines)

**Evidence:**
- **Tree structure manipulation** (splitNode, findLeaf, mergeLeaf, resizePanel, moveTab — recursive tree operations)
- **Panel state serialization/deserialization** (toPanelState, fromPanelState — JSON conversion)
- **localStorage persistence** (loadState, saveState, STORAGE_KEY management)
- **Tab management** (addTab, closeTab, setActiveTab — tab CRUD on leaf nodes)
- **Layout validation & repair** (validateLayout, repairLayout — structure integrity checks)
- **ID generation & counter** (nextId, idCounter, _resetIdCounter for testing)
- **Zustand store state & actions** (50+ action methods, complex selector logic)

**Impact:**
- Hard to unit test tree operations (splitNode, mergeLeaf) without full Zustand store setup
- Persistence logic scattered — changes to serialization format require updating store actions
- ID generation strategy embedded in tree module makes it hard to parameterize for different tree types
- Cannot reuse panel tree logic (splitting, merging) without importing Zustand store
- Large store means frequent merge conflicts when multiple teams modify layout logic

**Recommendation:**
Split into 3-4 modules:
- **panel-tree-ops.ts** (pure module): Tree manipulation functions
  - Export: splitNode(), findLeaf(), mergeLeaf(), resizePanel(), moveTab(), flattenTree()
  - Zero dependencies on Zustand, localStorage, or React
  - Testable with pure data structures
  - Pure functions — easier to test and reason about
- **panel-tree-serialization.ts** (pure module): JSON conversion
  - Export: toPanelState(), fromPanelState(), validateLayout(), repairLayout()
  - Uses tree-ops module
- **panel-tree-persistence.ts** (module): localStorage I/O
  - Export: savePanelState(), loadPanelState(), clearPanelState()
  - Owns: STORAGE_KEY, localStorage error handling
- **usePanelLayout.ts** (Zustand store): Thin facade
  - Composes pure modules above
  - Owners: Zustand actions, selectors, state shape
  - No business logic — delegates to pure modules

Move ID generation to its own **id-generator.ts** — can be reused for other components.

**Effort:** M
**Confidence:** High

---

## F-t2-fatFiles-7: SprintTasks Store — Data Fetching + IPC Signaling + Optimistic Updates
**Severity:** Medium
**Category:** Mixed Responsibilities
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/stores/sprintTasks.ts` (375 lines)

**Evidence:**
- **Data fetching & caching** (loadData, mergeSseUpdate, setTasks — server state sync)
- **Optimistic updates** (updateTask, createTask with pendingUpdates/pendingCreates tracking)
- **Task mutations** (deleteTask, batchDeleteTasks, batchRequeueTasks, launchTask)
- **AI-assisted spec generation** (generateSpec delegation to handler)
- **Error handling & retries** (loadError state, retry on fetch failure — tightly coupled)
- **Pending state tracking** (pendingUpdates Map, pendingCreates array — reconciliation logic)
- **SSE event merging** (mergeSseUpdate — real-time sync from server)

All in single 375-line Zustand store with ~10 async actions.

**Impact:**
- Cannot test optimistic update logic without full store setup
- Changes to server sync (SSE merging) affect task CRUD paths
- Hard to add new task mutation types without editing multiple store actions
- Pending state reconciliation logic scattered across loadData and mergeSseUpdate

**Recommendation:**
Extract & compose:
- **useSprintTasksData** (hook): Server state fetching & SSE sync
  - loadData(), mergeSseUpdate(), setTasks()
  - Single responsibility: remote ↔ local sync
  - Reuse: other stores can subscribe to same server channel
- **useSprintTasksMutations** (hook): Task mutations (CRUD)
  - updateTask(), deleteTask(), createTask(), launchTask()
  - Simpler state shape — just the mutation queue
  - Can be tested independently with mock API
- **useSprintTasksOptimism** (custom hook): Optimistic update logic
  - pendingUpdates, pendingCreates tracking
  - Reconciliation on SSE update
  - Pure logic — testable independently
- **useSprintTasksUI** (hook): UI-specific state (loading, error)
  - loading, loadError state only
  - Separate concern from data/mutation state

Compose in **useSprrintTasks** (public hook) that wires these together. Each piece is smaller, testable, and reusable.

**Effort:** M
**Confidence:** Medium

---

## F-t2-fatFiles-8: Prompt-Composer — Personality-Based Prompt Assembly + Task Classification
**Severity:** Medium
**Category:** Too Large | Mixed Responsibilities
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/prompt-composer.ts` (482 lines)

**Evidence:**
- **Task classification** (classifyTask — determines personality/output constraints based on task content)
- **Personality-specific prompt builders** (buildPipelinePrompt, buildAssistantPrompt, buildCopilotPrompt, buildSynthesizerPrompt — each 50-150 lines)
- **Shared sections across personalities** (buildUpstreamContextSection, buildBranchAppendix, buildRetryContext, buildScratchpadSection, buildPersonalitySection)
- **Output cap hinting** (buildOutputCapHint — TaskClass-dependent hints)
- **Time limit section building** (buildTimeLimitSection)
- **Central orchestrator** (buildAgentPrompt — routes to personality-specific builder)
- **Spec truncation** (truncateSpec utility)

Single 482-line file bundling task classification, personality routing, and prompt template assembly.

**Impact:**
- Hard to add new personality without understanding entire file structure
- Shared sections duplicated across personality builders — DRY violation
- Task classification logic isolated from personality builders — mental model split
- Cannot unit test personality builder independently from buildAgentPrompt routing
- Personality-specific prompts hard to refactor (unclear which sections are shared vs. personality-specific)

**Recommendation:**
Restructure into:
- **task-classifier.ts**: Task classification logic
  - Export: classifyTask(), TaskClass enum
  - Pure function — testable independently
- **prompt-sections.ts**: Shared prompt components
  - Export: buildUpstreamContextSection(), buildBranchAppendix(), buildRetryContext(), buildScratchpadSection(), buildTimeLimitSection(), buildPersonalitySection(), buildOutputCapHint()
  - Zero knowledge of personalities — reusable
- **personality-prompts.ts**: Personality-specific builders
  - Export: buildPipelinePrompt(), buildAssistantPrompt(), buildCopilotPrompt(), buildSynthesizerPrompt()
  - Each imports shared sections
  - Each responsible for its personality's unique structure
- **prompt-composer.ts**: Orchestrator
  - Export: buildAgentPrompt() only
  - Routes to correct personality builder based on input
  - Imports from modules above
  - Single responsibility: routing

Add **shared-prompt-utils.ts** for truncateSpec, spec formatting, other utils.

This structure makes it easy to:
- Add new personality (new file, no changes to existing code)
- Refactor shared sections without touching personality builders
- Unit test each personality builder independently
- Understand personality-specific vs. shared prompt logic

**Effort:** M
**Confidence:** Medium

---

## Summary Table

| Finding | File | LOC | Severity | Effort |
|---------|------|-----|----------|--------|
| F-t2-fatFiles-1 | sprint-queries.ts | 805 | Critical | L |
| F-t2-fatFiles-2 | agent-manager/index.ts | 713 | Critical | L |
| F-t2-fatFiles-3 | agent-manager/run-agent.ts | 617 | High | M |
| F-t2-fatFiles-4 | handlers/workbench.ts | 349 | High | M |
| F-t2-fatFiles-5 | agent-manager/git-operations.ts | 505 | High | M |
| F-t2-fatFiles-6 | stores/panelLayout.ts | 453 | High | M |
| F-t2-fatFiles-7 | stores/sprintTasks.ts | 375 | Medium | M |
| F-t2-fatFiles-8 | agent-manager/prompt-composer.ts | 482 | Medium | M |

---

## Recommendations for Prioritization

**Phase 1 (Critical path — unblocks other work):**
1. **F-t2-fatFiles-1** (sprint-queries.ts): Split into 5 modules
   - Reduces merge conflict surface by 80%
   - Unblocks parallel feature work (queue logic, CRUD, reporting each in own file)
   - No production behavior change if wire-up done correctly
   - Effort: L, but high impact

2. **F-t2-fatFiles-2** (agent-manager/index.ts): Extract concurrency, watchdog, dependency services
   - Enables independent testing of dependency indexing logic
   - Clarifies control flow for new team members
   - Effort: L if done incrementally (extract watchdog first, then dependency service, then concurrency)

**Phase 2 (Unblocks testing/debugging):**
3. **F-t2-fatFiles-3** (run-agent.ts): Extract lifecycle, message handler, context builder
   - Enables unit testing of cost/token tracking independent of process lifecycle
   - Makes OAuth error handling testable in isolation
   - Effort: M

4. **F-t2-fatFiles-5** (git-operations.ts): Reorganize into PR/branch/worktree/commit modules
   - Reduces cognitive load when working on branch management
   - PR creation retries become testable independently
   - Effort: M

**Phase 3 (Improves maintainability):**
5. **F-t2-fatFiles-6** (panelLayout.ts): Extract pure tree ops, serialization, persistence
   - Enables testing panel tree logic without Zustand
   - Tree operations become reusable in other contexts
   - Effort: M, high payoff for future UI work

6. **F-t2-fatFiles-7** (sprintTasks.ts): Extract data fetch, mutations, optimism layers
   - Easier to understand each piece independently
   - Optimistic update logic becomes reusable
   - Effort: M

7. **F-t2-fatFiles-4** (workbench.ts): Extract quality validator, generation service, IPC handlers
   - Spec validation reusable in renderer-side preview
   - Effort: M

8. **F-t2-fatFiles-8** (prompt-composer.ts): Extract task classifier, shared sections, personality builders
   - Easier to add new agent personalities
   - Prompt sections become reusable
   - Effort: M, highest leverage for agent extensibility

---

## Notes

All recommendations maintain backward compatibility through re-export modules (e.g., sprint-queries.ts re-exports from all split modules for callers that haven't migrated).

Incremental refactoring is safer than big-bang rewrites. Start with extracting pure functions/modules (no side effects), wire them back into existing code, then gradually move callers to new locations.

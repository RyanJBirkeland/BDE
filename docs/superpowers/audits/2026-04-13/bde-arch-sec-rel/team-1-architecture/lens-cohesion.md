# Cohesion Audit: BDE Agent Manager & Data Layer

**Date:** 2026-04-13
**Scope:** `src/main/agent-manager/`, `src/main/data/`, `src/main/handlers/`, `src/main/index.ts`, `src/renderer/src/stores/`
**Baseline:** sprint-queries.ts intentional split (v_good), sdk-streaming.ts extracted (v_good)

---

## F-t1-cohesion-1: AgentManager Index God File — Orchestration + Event Handling + Metrics Sprawl

**Severity:** High
**Category:** Module Cohesion
**Location:** `src/main/agent-manager/index.ts:102-800+`
**Evidence:** 
- 801 lines in a single class (AgentManagerImpl)
- **8 responsibilities** layered into one class:
  1. Agent lifecycle (spawn, claim, kill)
  2. Drain loop coordination (queuedTask processing, concurrency control)
  3. Dependency resolution + index refresh
  4. Watchdog loop (heartbeat checking + orphan detection)
  5. Worktree lifecycle (setup, cleanup, pruning)
  6. Circuit breaker management (spawn failure tracking)
  7. Metrics collection (agentsSpawned, successes, failures)
  8. Config hot-reloading (reloadConfig method)
- 15+ private/exposed methods; 8+ internal timers; 7+ dependency injections
- Mutable state: `_activeAgents`, `_processingTasks`, `_running`, `_lastTaskDeps`, `_terminalCalled`

**Impact:**
- **Hard to test:** Watchers, drain loop, and metrics tangled together; changing drain logic requires understanding orphan detection
- **Difficult to reason about lifecycle:** When do timers start/stop? What calls onTaskTerminal? State transitions are distributed across methods
- **Brittle config reload:** `reloadConfig()` only updates subset of fields; adding a new config param requires careful handling in 3+ places
- **Metrics scattered:** `_metrics` object is passed but also incremented inline; hard to see all instrumentation points
- **Terminal callback conflicts:** `_terminalCalled` idempotency guard competes with watchdog and completion handler — races possible

**Recommendation:**
Extract into cohesive modules:
1. **AgentSpawner** — spawn logic, claim, kill, _spawnAgent, RunAgentDeps binding
2. **DrainLoop** — _drainQueuedTasks, _processQueuedTask, queue fetching, blocking logic
3. **DependencyResolver** — _refreshDependencyIndex, terminal callback, index state mutation
4. **WatchdogManager** — _watchdogLoop, _orphanLoop, _pruneLoop, all timers (compose into event manager)
5. **CircuitBreaker** (already extracted, good)
6. **MetricsCollector** (already extracted, but review integration)

Orchestrator becomes a thin dispatcher that wires these together and exposes public interface.

**Effort:** L
**Confidence:** High

---

## F-t1-cohesion-2: RunAgent Function — Process Lifecycle + Message Streaming + Cost Tracking + Event Emission Bundled

**Severity:** High
**Category:** Module Cohesion
**Location:** `src/main/agent-manager/run-agent.ts:150-770` (processSDKMessage + message stream loop)
**Evidence:**
- 769 lines; function spans spawn-to-exit with embedded message loop
- **6 interwoven concerns** in streaming loop:
  1. Message deserialization (asSDKMessage)
  2. Cost/token tracking (trackAgentCosts, TurnTracker updates)
  3. Rate-limit detection (isRateLimitMessage)
  4. Event mapping + emission (mapRawMessage, emitAgentEvent)
  5. Playground HTML detection + async emit (detectPlaygroundWrite)
  6. Exit code capture + terminal callback invocation
- Mutations to `agent` object (costUsd, lastOutputAt, rateLimitCount, tokensIn, tokensOut) happen inside loop
- Early returns at 3 places after errors (stream failure, spawn timeout, exit code mismatch)
- Helper functions (trackAgentCosts, detectPlaygroundWrite, processSDKMessage) layer complexity

**Impact:**
- **Hard to add instrumentation:** New metric? Must thread through entire message loop
- **Testing nightmare:** Can't test cost tracking without mocking stream; can't test event emission without cost update
- **Exit path unclear:** Multiple early returns + onTaskTerminal callback in multiple places; hard to guarantee cleanup
- **Message ordering bugs:** If playground emit throws, does exit code still get captured? Unclear from linear reading

**Recommendation:**
Extract message processing pipeline:
1. **MessageProcessor** — single interface: process(msg) → { costUpdate?, event?, exitCode?, playground? }
2. **TurnTracker** (already exists) — move all token/cache accounting here
3. **EventEmitter** — emit with structured logging
4. **PlaygroundDetector** — standalone, async-safe, returns path or null
5. **StreamConsumer** — thin orchestrator that calls pipeline and handles backpressure

Keep spawn + setup in runAgent, but offload stream handling.

**Effort:** M
**Confidence:** High

---

## F-t1-cohesion-3: Completion.ts — Git Ops + Task State + Merge Strategy + Email All Tangled

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `src/main/agent-manager/completion.ts:1-478`
**Evidence:**
- 478 lines handling agent completion (success/failure)
- **7 responsibilities** mashed together:
  1. Branch detection (detectBranch)
  2. Diff file statistics (getDiffFileStats)
  3. Repo config lookup (getRepoConfig)
  4. Task state transitions (resolveSuccess/resolveFailure)
  5. Commit checking (commitCheckAndAutoMerge)
  6. Auto-merge strategy logic (determineMergeStrategy, executeAutoMerge)
  7. Event emission + terminal callbacks (broadcastCoalesced, onTaskTerminal)
- Mixed async/await with helper functions that also fetch from DB
- Error handling scattered: failTaskWithError, try/catch blocks at multiple levels
- Repo lookup happens inside async function at runtime, not injected

**Impact:**
- **Hard to test merge strategy:** Can't test merge logic without mocking git ops + task updates
- **Unclear contract:** Which functions read from repo? Which mutate task state? Side effects not obvious
- **Fragile error paths:** If repo config lookup fails, does task get marked error? Unclear from code structure
- **Concurrency risk:** repo.updateTask called multiple times in sequence; no transaction safety

**Recommendation:**
Separate concerns:
1. **MergeStrategyPolicy** (pure) — given (task, diffStats, autoReview rules) → merge strategy enum
2. **CompletionHandler** — orchestrates success/failure state transitions
3. **TaskRepository** calls — centralize in a single completion method on repo, not scattered
4. **GitOperations** — already partially extracted; use as dependency

**Effort:** M
**Confidence:** Medium

---

## F-t1-cohesion-4: Git-Operations.ts — PR Creation + Rebase + Squash Merge + Cleanup All Melted Together

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `src/main/agent-manager/git-operations.ts:34-555`
**Evidence:**
- 555 lines of git command wrappers
- **5 logical domains** mixed:
  1. PR lifecycle (createNewPr, findOrCreatePR, checkExistingPr, generatePrBody)
  2. Rebasing + pushing (rebaseOntoMain, pushBranch, ffMergeMain)
  3. Squash merge (executeSquashMerge, stageWithArtifactCleanup)
  4. Worktree management (addWorktree, removeWorktreeForce, pruneWorktrees)
  5. Branch cleanup (deleteBranch, forceDeleteBranchRef, cleanupWorktreeAndBranch)
- No clear organization; functions scattered by call order, not by concern
- Artifact patterns hardcoded (GIT_ARTIFACT_PATTERNS); should be injectable
- Environment variable building (buildAgentEnv) called in 10+ places; not hoisted
- PR retry logic buried in findOrCreatePR (3 attempts, backoff hardcoded)

**Impact:**
- **Hard to override strategy:** Can't swap merge strategy without editing git-operations.ts
- **Testing tedious:** Each function has its own execFileAsync calls; mocking is per-function
- **Hidden retry logic:** findOrCreatePR has 3 retries + backoff, but not visible in name; other callers may not know
- **Artifact cleanup fragile:** If a new artifact type is added, must edit hardcoded patterns

**Recommendation:**
Reorganize into modules:
1. **PrWorkflow** — PR creation, detection, body generation
2. **RebaseAndPush** — rebase, ff-merge, push (could be further split)
3. **SquashMergeExecutor** — executeSquashMerge + stageWithArtifactCleanup
4. **WorktreeManager** — worktree add/remove/prune
5. **BranchCleanup** — delete, force-delete
6. **GitEnv** — singleton that builds and caches env; share across all

**Effort:** M
**Confidence:** Medium

---

## F-t1-cohesion-5: Review-Action-Policy + Executor Split Issue — Policy Emits I/O Signals But No Execution Contract

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `src/main/services/review-action-policy.ts:105-330` + `review-action-executor.ts:67-250`
**Evidence:**
- **Pure policy** (policy.ts) emits a plan with GitOpDescriptors[], but descriptors are loosely typed
- **Executor** (executor.ts) has large switch statement (14+ cases) matching on op.type
- No validation that executor can handle all descriptor types emitted by policy
- When policy adds a new GitOpType, executor must manually add case — easy to forget
- Executor state (branch, conflicts, cssWarnings) accumulated during loop; not pre-defined
- Failure modes undefined: what if executor skips an op? Does state become invalid?

**Impact:**
- **Silent mismatches:** Policy emits 'cssDedup' op, but executor never added the handler (or added it but it's a no-op)
- **State corruption:** ExecutorState accumulates data; if an operation fails mid-way, later ops see partial state
- **Hard to test policy in isolation:** Policy returns a plan, but no way to validate the plan without running executor

**Recommendation:**
1. Create **GitOpValidator** that checks all descriptor types are executable
2. Pre-define **ExecutorStateSchema** with required/optional fields; validate before each op
3. Make executor fail-fast on unknown descriptor type (not silently skip)
4. Add **describeOp()** method to each descriptor for better logging/debugging
5. Consider tagged union for op types (discriminated union) instead of string-based switch

**Effort:** S
**Confidence:** Medium

---

## F-t1-cohesion-6: Sprint-Service + Sprint-Mutations Facade Not Thin Enough — Wrapper Still Complex

**Severity:** Low
**Category:** Module Cohesion
**Location:** `src/main/services/sprint-service.ts:43-85`
**Evidence:**
- sprint-service.ts is meant to be a thin facade over sprint-mutations.ts
- But it re-exports 14 functions from mutations, only wrapping 6 for broadcast
- Pattern is repetitive: getTask → mutations.getTask; createTask → mutations.createTask + broadcaster.notify
- Callers could import mutations directly, bypassing the facade
- No enforcement of "must go through facade"; interface segregation not clear

**Impact:**
- **Facade integrity leak:** Handlers import directly from mutations in some places, broadcaster in others
- **Notification missed:** If code imports mutations directly, no broadcast happens
- **Maintenance burden:** Adding a new mutation requires deciding: wrap it or re-export it?

**Recommendation:**
1. Hide sprint-mutations and sprint-mutation-broadcaster from public exports (export type only where needed)
2. Wrap ALL mutations in sprint-service (even read-only ones); add notification hooks for future mutations
3. Consider a **SprintMutationFacade** class with explicit mutation methods, not re-exports
4. Move broadcaster internals into service; callers don't need to know about notification pattern

**Effort:** S
**Confidence:** Low

---

## F-t1-cohesion-7: Handlers Registry Overloaded — Registration + Handler Logic Mixed

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `src/main/handlers/registry.ts` + individual handler files
**Evidence:**
- Each handler file exports a `register*` function
- Registry.ts imports 20+ handler modules and calls registerXxxHandlers(deps)
- Handler files are split, but registration logic is still inside each file mixed with business logic
- No clear separation: is this a registration module or a handler module?
- DependencyContainer pattern not used; deps passed as interface to each register function
- Each handler has different deps structure (some need repo, some need logger, some need dialog)

**Impact:**
- **Registry is not a registry:** It's a collection of side-effect function calls
- **Hard to discover:** Which handlers are registered? Look at registry.ts; which are disabled? Grep for if() conditions
- **Testing awkward:** To test a handler, must call register function, which calls safeHandle(channel_name, handler)
- **Dependency mismatch:** Some handlers expect logger, others expect repo; no type safety

**Recommendation:**
1. Create **HandlerRegistry** class with explicit register(channel, handler) method
2. Extract handler logic from register functions into pure functions
3. Use **HandlerFactory** pattern: factory.createXxxHandler(deps) → handler function
4. Compose all dependencies at bootstrap time, inject into factory
5. Registry becomes a true registry: register('channel:name', handler); start()

**Effort:** M
**Confidence:** Medium

---

## F-t1-cohesion-8: Zustand Stores Mixing State + Persistence + Validation — TaskWorkbench Example

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `src/renderer/src/stores/taskWorkbench.ts:1-388`
**Evidence:**
- 388-line Zustand store doing 5 things:
  1. Form state management (title, repo, spec, etc.)
  2. Validation result tracking (structuralChecks, semanticChecks, operationalChecks)
  3. LocalStorage persistence (DRAFT_STORAGE_KEY, ADVANCED_OPEN_STORAGE_KEY)
  4. Dirty-state tracking (originalSnapshot, isDirty())
  5. Field mutations (setField, setSpecType, resetForm, loadTask)
- createDebouncedPersister hook is imported but its dependencies not visible in store
- Validation results have 3 levels (structural, semantic, operational); each with own state setter
- resetForm() clears everything; no granular reset
- originalSnapshot comparison logic is coupled with form data

**Impact:**
- **Hard to test validation logic:** Can't test without mounting store; validation side effects mixed with state
- **Persistence coupling:** Adding a new form field requires updating multiple places (state, snapshot, persister)
- **Validation flow unclear:** When does semantic check run? After structural? Throttled?
- **Memory leak risk:** debounced persister may hold references after store unmounted

**Recommendation:**
1. **FormState** (form fields only) — clean, typed state object
2. **ValidationState** (check results) — separate concern, maybe move to different hook
3. **FormPersistence** — custom hook, not mixed into store; handles debounce + localstorage
4. **DirtyState** — helper function, not store state; computed from snapshot + current fields
5. Use **Immer** or **Zustand** middleware for immutable updates, not manual spreading

**Effort:** M
**Confidence:** Medium

---

## F-t1-cohesion-9: SprintTasks Store — Optimistic Updates + Merging + Fingerprinting All in loadData()

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `src/renderer/src/stores/sprintTasks.ts:62-148`
**Evidence:**
- 86-line loadData() function doing 6 things:
  1. Fetch from API (window.api.sprint.list)
  2. Sanitize depends_on (sanitizeDependsOn)
  3. Build fingerprints (currentFingerprint, incomingFingerprint)
  4. Check for pending ops (pendingUpdates, pendingCreates)
  5. Merge incoming with local optimistic state (mergedById Map)
  6. Expire old pending updates (PENDING_UPDATE_TTL check)
- Nested 4 levels deep with complex set() callback
- Logic is imperative; hard to follow data flow
- Fingerprint strategy hardcoded; can't swap for different merge strategy

**Impact:**
- **Hard to test:** Can't isolate merge logic from fetch; can't test TTL expiration without advancing time
- **Hard to add feature:** Want to add conflict resolution? Must edit inside set() callback
- **Performance unclear:** Multiple passes through tasks array; Map allocations in hot path
- **Race conditions possible:** If loadData called twice rapidly, second call might see partial state from first

**Recommendation:**
1. Extract **TaskMergingStrategy** — pure function: (current, incoming, pending) → merged
2. Extract **PendingUpdateCleanup** — expires old pending, returns cleanup function
3. Extract **FingerprintComparer** — compares fingerprints, returns shouldUpdate boolean
4. Keep loadData() as thin orchestrator: fetch → sanitize → compare → merge → set
5. Unit test each extracted function independently

**Effort:** S
**Confidence:** Medium

---

## F-t1-cohesion-10: Agent-Manager Index — Mutable Config + Public Mutation + No Invalidation

**Severity:** Low
**Category:** Module Cohesion
**Location:** `src/main/agent-manager/index.ts:136-150` (config field)
**Evidence:**
- Public `config: AgentManagerConfig` field on AgentManagerImpl
- `reloadConfig()` method mutates config in place (worktreeBase is NOT mutable, marked as note)
- Concurrency state derived from config but not invalidated on reload
- Old timers (pollTimer, watchdogTimer) use intervals based on config; reloadConfig doesn't restart them

**Impact:**
- **Hot reload incomplete:** maxConcurrent is reloaded, but poll interval stays old until app restart
- **State divergence:** config.maxConcurrent != concurrency state until next concurrency operation
- **Hard to reason about:** Config is both immutable (in constructor) and mutable (reloadConfig); no clear contract

**Recommendation:**
1. Make config immutable (readonly keyword)
2. If reload needed, create new AgentManager with new config and swap reference at app level
3. OR: Make config an observable (EventEmitter) and have components listen to changes
4. OR: Separate hot-reloadable config into own object; mark clearly

**Effort:** S
**Confidence:** Low

---

## Summary

**Critical Issues (High Severity):**
- **F-t1-cohesion-1:** AgentManager index file is a god class (801 lines, 8+ responsibilities)
- **F-t1-cohesion-2:** RunAgent function mixes spawn lifecycle + message streaming + cost tracking + event emission

**Moderate Issues (Medium Severity):**
- **F-t1-cohesion-3:** Completion.ts handles git ops, task state, merge strategy, and email all together
- **F-t1-cohesion-4:** Git-operations.ts contains 5 unrelated domains (PR, rebase, squash, worktree, cleanup)
- **F-t1-cohesion-5:** Review-action policy emits unvalidated git ops; executor has weak contract
- **F-t1-cohesion-7:** Handlers registry mixes registration logic with handler business logic
- **F-t1-cohesion-8:** TaskWorkbench store couples form state, validation, persistence, and dirty tracking
- **F-t1-cohesion-9:** SprintTasks store's loadData() mixes fetch, merge, TTL expiry, and fingerprinting

**Low-Risk Issues:**
- **F-t1-cohesion-6:** Sprint-service facade not thin enough; wrapper logic still visible
- **F-t1-cohesion-10:** Agent-manager config mutable but contracts unclear

---

**Effort Estimate for Fixes:** 4-5 sprints
- **L (Large):** F-t1-cohesion-1 (AgentManager refactor)
- **M (Medium):** F-t1-cohesion-2, 3, 4, 5, 7, 8, 9 (7 modules)
- **S (Small):** F-t1-cohesion-6, 10 (quick wins)

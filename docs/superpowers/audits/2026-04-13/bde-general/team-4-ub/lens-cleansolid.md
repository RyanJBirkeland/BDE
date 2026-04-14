# SOLID Principles & Class Design Audit — BDE (2026-04-13)

## Executive Summary

The BDE codebase shows strengths in **layered architecture** and **separation of concerns** at the macroscopic level (data layer, agent manager, handlers, UI stores). However, several files exceed healthy size limits (300–500+ lines) and accumulate multiple responsibilities that would benefit from decomposition per Uncle Bob's principles. The three most critical violations are: (1) **AgentManagerImpl** mixing orchestration, state machine logic, and dependency resolution in one 957-line class; (2) **sprint-queries.ts** serving as both a synchronous query abstraction AND an audit trail recorder with 966 lines; and (3) **run-agent.ts** bundling agent spawn, message consumption, and finalization logic across 789 lines without clear phase boundaries.

**Patterns Observed:**
- Heavy reliance on procedural function chains rather than polymorphic dispatch
- Large utility modules (sprint-queries, completion.ts) that bundle multiple responsibilities
- Late-stage dependency injection (constructor functions receiving complex deps objects) leading to god-object interfaces
- Minimal use of interface segregation for domain concepts (e.g., `RunAgentDeps` is a catch-all)

---

## F-t4-cleansolid-1: AgentManagerImpl — God Class Violating SRP with 957 Lines

**Severity:** High  
**Category:** SOLID / Single Responsibility Principle (SRP) Violation  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:1–957`

**Evidence:**  
The `AgentManagerImpl` class (957 lines) conflates **five distinct responsibilities:**

1. **Concurrency orchestration** — managing `_concurrency` state, slots, WIP limits, tryRecover()
2. **Dependency resolution** — `_depIndex`, `_epicIndex`, `_lastTaskDeps` fingerprint caching
3. **Agent lifecycle state machine** — `_activeAgents`, `_processingTasks`, `_terminalCalled` guards
4. **Event loop coordination** — multiple `setInterval` timers (poll, watchdog, orphan, prune), drain loop scheduling
5. **Configuration hot-reload** — `reloadConfig()` re-reading and applying settings at runtime

**Example code regions:**
- Lines 122–175: Constructor initializes concurrency, dependency indices, metrics collector, circuit breaker
- Lines 512–604: `_drainLoop()` does dependency index incremental rebuild (543–566), task status map refresh, OAuth check, queued task fetching, and task processing
- Lines 746–779: Timer setup and initial drain scheduling mixed into `start()` method
- Lines 888–931: `reloadConfig()` re-reads settings, mutates internal config, and updates runAgentDeps

**Impact:**  
Testing this class requires mocking concurrency state, dependency indices, metrics, timers, and settings simultaneously. Adding new orchestration logic (e.g., a new watchdog check or a dependency resolution strategy) requires editing the class body. The class has >6 reasons to change: concurrency limits change, dependency ordering logic changes, task state machine changes, timer intervals change, configuration hot-reload is added/modified, and agent lifecycle guards change.

**Recommendation:**  
Extract into delegated sub-objects:
- Create `ConcurrencyOrchestrator` (responsible for slot allocation, WIP enforcement, recovery)
- Create `DependencyOrchestrator` (responsible for index management and task-deps fingerprinting)
- Create `EventLoopCoordinator` (responsible for timer lifecycle, drain scheduling)
- Have `AgentManagerImpl` delegate to these via composition, keeping the main responsibility as "coordinate task flow through agent pipeline"

Deprecate the 20+ `_` prefixed testing methods and replace with dependency injection of these sub-objects.

**Effort:** M  
**Confidence:** High

---

## F-t4-cleansolid-2: sprint-queries.ts — Mixed Concerns: Query + Audit Trail Recorder in 966 Lines

**Severity:** High  
**Category:** SOLID / Single Responsibility Principle (SRP) Violation  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:1–966`

**Evidence:**  
The module exports 27 functions that serve **two orthogonal purposes:**

1. **Query layer** — `getTask()`, `listTasks()`, `listTasksRecent()`, `createTask()`, `updateTask()`, `deleteTask()`, `claimTask()`, `releaseTask()`, etc.
2. **Audit trail recording** — Every mutation (`updateTask`, `claimTask`, `releaseTask`, `markTaskDoneByPrNumber`, `updateTaskMergeableState`, `pruneOldDiffSnapshots`) calls `recordTaskChanges()` or `recordTaskChangesBulk()` internally

**Example code regions:**
- Lines 355–455: `updateTask()` validates transitions (lines 370–377), filters unchanged fields (lines 383–388), builds SET clauses, **and calls `recordTaskChanges()` within transaction** (lines 432–444)
- Lines 486–533: `claimTask()` transitions status/claimed_by/started_at **and calls `recordTaskChanges()` within transaction** (lines 513–519)
- Lines 609–648: `transitionTasksToDone()` calls `recordTaskChangesBulk()` to log the state change (lines 631–639)

Callers of `updateTask()` cannot opt out of audit logging — it is baked in. If audit trail requirements change (e.g., new field to track, different TTL for sensitive fields), the query layer must be edited.

**Impact:**  
Changes to audit trail policy (which fields are audited, how diffs are stored, retention/cleanup) require modifying data access functions. Testing query logic is entangled with testing audit side effects. Callers cannot choose "make a change without recording it" because the two concerns are fused.

**Recommendation:**  
Extract audit recording into a separate `AuditTrailService`:
```typescript
export interface AuditTrailService {
  recordChange(taskId: string, oldTask: SprintTask, newPatch: Record<string, unknown>, changedBy: string): void
  recordBulkChanges(changes: Array<{taskId, oldTask, newPatch}>, changedBy: string): void
  pruneOldSnapshots(retentionDays: number): number
}

// sprint-queries.ts delegates:
export function updateTask(id: string, patch: Record<string, unknown>, auditService?: AuditTrailService): SprintTask | null {
  // ... validation, update logic ...
  if (auditService) {
    auditService.recordChange(id, oldTask, auditPatch, 'unknown')
  }
}
```

Split the module into:
- `sprint-queries.ts` — pure query/mutation (no audit side effects)
- `audit-trail-service.ts` — responsibility for recording and retention

**Effort:** M  
**Confidence:** High

---

## F-t4-cleansolid-3: run-agent.ts — Procedural Pipeline Mixing Spawn, Message Consumption, and Finalization in 789 Lines

**Severity:** High  
**Category:** SOLID / Single Responsibility Principle (SRP) Violation  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:1–789`

**Evidence:**  
The `runAgent()` function (lines 738–789) is a 51-line orchestrator that calls four sequential phases, each implemented as a nested private async function:

1. **Phase 1: Validate & Prepare** (lines 364–446) — Checks task content, fetches upstream task specs, builds scratchpad directory, calls `buildAgentPrompt()`
2. **Phase 2: Spawn & Wire** (lines 452–577) — Calls `spawnWithTimeout()`, wires stderr handler, creates `ActiveAgent` record, persists agent_run_id, emits started event
3. **Phase 3: Consume Messages** (lines 310–358) — Iterates over SDK messages, tracks costs, emits events, detects playground writes
4. **Phase 4: Finalize** (lines 583–736) — Classifies exit, runs success/failure handlers, captures partial diff, cleans up worktree

The file also exports standalone utility functions (`detectHtmlWrite`, `tryEmitPlaygroundEvent`, `capturePartialDiff`, `classifyDiffCaptureError`, `spawnWithTimeout`, `consumeMessages`) that are independently testable but logically bundled with the main `runAgent` orchestration.

**Within consumeMessages (310–358):**
- Lines 324–337: Iterates and calls `processSDKMessage()` for each message
- Lines 272–305: `processSDKMessage()` does five things: tracks costs, checks rate limit, updates exit code, maps events, detects playground writes

**Within finalizeAgentRun (583–736):**
- Lines 599–608: Emits completion event
- Lines 626–652: Updates agent run record and persists cost breakdown
- Lines 654–711: Classifies exit (fast-fail, requeue, normal), calls `resolveSuccess()` or `resolveFailure()`
- Lines 713–733: Deletes from activeAgents map, captures diff, cleans up worktree

**Impact:**  
The file mixes:
- **Agent lifecycle state machine** (determine if fast-fail, requeue, or normal exit)
- **Cost & token tracking** (processSDKMessage, trackAgentCosts, TurnTracker)
- **Resource cleanup** (capturePartialDiff, cleanupWorktree, deleteAgentRecord)
- **Event emission** (emitAgentEvent, playground event detection)

Testing individual phases requires complex setup with mocked Handle, Logger, Repository, and RunAgentDeps. Adding a new metric (e.g., "track max token usage per turn") or a new exit classification requires editing multiple functions.

**Recommendation:**  
Decompose into single-responsibility classes/functions:
- `AgentSpawner` — responsible for `spawnWithTimeout()` and wiring
- `AgentMessageConsumer` — responsible for iterating messages and delegating to handlers
- `AgentExitClassifier` — responsible for `classifyExit()` logic and exit code interpretation
- `AgentCompletionHandler` — responsible for calling `resolveSuccess()` / `resolveFailure()` based on exit classification
- `AgentResourceCleaner` — responsible for `capturePartialDiff()`, worktree cleanup, agent record deletion

Keep `runAgent()` as a thin orchestrator:
```typescript
export async function runAgent(task, worktree, repoPath, deps): Promise<void> {
  const prompt = await validateAndPreparePrompt(...)
  const { agent, agentRunId, turnTracker } = await spawner.spawn(...)
  const { exitCode, lastAgentOutput } = await consumer.consume(...)
  const classification = classifier.classify(exitCode, ...)
  await completionHandler.handle(classification, ...)
  await resourceCleaner.cleanup(...)
}
```

**Effort:** L  
**Confidence:** High

---

## F-t4-cleansolid-4: completion.ts — Oversized Orchestrator Bundling Git Operations, PR Creation, and Task Resolution in 707 Lines

**Severity:** High  
**Category:** SOLID / Open/Closed Principle (OCP) Violation  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:1–707`

**Evidence:**  
The `completion.ts` module exports two main functions (`resolveSuccess`, `resolveFailure`) but implements at least 8 nested helper functions bundling distinct post-agent responsibilities:

1. **Auto-commit logic** (lines 109–159) — `autoCommitIfDirty()` stages files, unstages test artifacts, commits
2. **Rebase logic** (lines ~161–250 estimated, not shown) — calls `rebaseOntoMain()`
3. **Diff snapshot capture** (lines ~195–270 estimated) — calls `captureDiffSnapshot()`
4. **PR creation/finding** (lines ~200+ estimated) — calls `findOrCreatePR()`
5. **Auto-merge rules** (lines ~28–38 define, implementation not shown) — evaluates `AutoReviewRule[]`
6. **Merge execution** (lines ~268–350 estimated) — calls git operations and `runPostMergeDedup()`
7. **Task state transitions** (lines ~195–210 estimated for `transitionToReview()`) — updates task status to 'review' or 'done'

The two entry points (`resolveSuccess` and `resolveFailure`) don't define abstract interfaces for these concerns. **If a new post-agent strategy is needed** (e.g., "auto-format code before commit", "run linter on diff", "notify Slack on success"), the file must be edited.

**Example evidence (lines 28–38):**
```typescript
type AutoReviewRule = {
  id: string
  name: string
  enabled: boolean
  conditions: { maxLinesChanged?: number; filePatterns?: string[]; excludePatterns?: string[] }
  action: 'auto-merge' | 'auto-approve'
}
```

This type is defined but no abstract `ReviewStrategy` interface exists — adding a new rule type (e.g., "auto-skip if only comments changed") requires modifying the type and the logic that evaluates it.

**Impact:**  
The open/closed principle is violated: the module is not closed for modification when new post-agent strategies are needed. Callers cannot plug in custom resolution strategies; the behavior is hard-coded. Testing the entire success/failure path requires triggering real git and PR operations (or heavy mocking).

**Recommendation:**  
Define abstract strategies and decompose:
```typescript
export interface PostAgentStrategy {
  shouldApply(context: PostAgentContext): boolean
  execute(context: PostAgentContext): Promise<void>
}

export const BUILT_IN_STRATEGIES: PostAgentStrategy[] = [
  new AutoCommitStrategy(),
  new RebaseStrategy(),
  new DiffSnapshotStrategy(),
  new PullRequestStrategy(),
  new AutoMergeStrategy(),
  new TaskTransitionStrategy()
]

export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const context = buildPostAgentContext(opts, logger)
  for (const strategy of BUILT_IN_STRATEGIES) {
    if (strategy.shouldApply(context)) {
      await strategy.execute(context)
    }
  }
}
```

This decouples strategy selection from execution and allows callers to inject custom strategies.

**Effort:** M  
**Confidence:** High

---

## F-t4-cleansolid-5: RunAgentDeps — God Object Interface with 7 Unrelated Dependencies

**Severity:** Medium  
**Category:** SOLID / Dependency Inversion Principle (DIP) + Interface Segregation Principle (ISP) Violation  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:47–57`

**Evidence:**  
The `RunAgentDeps` interface requires callers to pass all of these:
```typescript
export interface RunAgentDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  repo: ISprintTaskRepository
  onSpawnSuccess?: () => void
  onSpawnFailure?: () => void
}
```

Callers construct this object in **two places** (and potentially more):
1. **AgentManagerImpl.constructor** (lines 171–179) — assembles RunAgentDeps with bound callbacks
2. **Tests** — must mock all 7 fields

The interface couples together:
- **Agent state** (`activeAgents` Map — a mutable collection)
- **Configuration** (`defaultModel` — a setting)
- **Logging** (`logger` — a utility)
- **Event notification** (`onTaskTerminal` — an external callback)
- **Data access** (`repo` — a repository abstraction)
- **Hook callbacks** (`onSpawnSuccess`, `onSpawnFailure` — optional lifecycle hooks)

Adding a new dependency (e.g., `costTracker: CostTracker`, `notificationService: NotificationService`) requires modifying the interface and all test setup code.

**Impact:**  
- **Hard to test**: Tests must mock all 7 dependencies even if testing a function that only uses 2–3 of them
- **Violates ISP**: Functions like `consumeMessages()` only need `logger` and `task`, but receive the entire god object
- **Violates DIP**: The interface exposes concrete implementation details (`Map<string, ActiveAgent>`) instead of abstractions

**Recommendation:**  
Segregate into focused dependency bags:
```typescript
export interface AgentSpawnDeps {
  defaultModel: string
  logger: Logger
}

export interface AgentMessageConsumerDeps {
  logger: Logger
  repo: ISprintTaskRepository
}

export interface AgentFinalizerDeps {
  activeAgents: Map<string, ActiveAgent>
  logger: Logger
  repo: ISprintTaskRepository
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
}

// Each function now has a focused interface:
export async function spawnWithTimeout(prompt: string, cwd: string, deps: AgentSpawnDeps): Promise<AgentHandle> { ... }
export async function consumeMessages(handle: AgentHandle, deps: AgentMessageConsumerDeps): Promise<ConsumeMessagesResult> { ... }
export async function finalizeAgentRun(task: RunAgentTask, deps: AgentFinalizerDeps): Promise<void> { ... }
```

**Effort:** S  
**Confidence:** High

---

## F-t4-cleansolid-6: sprint-local.ts — Handler Registration Without Strategy Pattern, Hard-Coded IPC Route Mapping

**Severity:** Medium  
**Category:** SOLID / Open/Closed Principle (OCP) Violation  
**Location:** `/Users/ryan/projects/BDE/src/main/handlers/sprint-local.ts:48–200`

**Evidence:**  
The `registerSprintLocalHandlers()` function (lines 48–200+) registers handlers by calling `safeHandle()` sequentially for each route:

```typescript
safeHandle('sprint:list', () => { return listTasksRecent() })
safeHandle('sprint:create', async (_e, task: CreateTaskInput) => { ... })
safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => { ... })
safeHandle('sprint:delete', async (_e, id: string) => { ... })
safeHandle('sprint:readSpecFile', async (_e, filePath: string) => { ... })
// ... 10+ more routes
```

Each route handler is a lambda that does:
1. Validate inputs
2. Call a service function
3. Handle errors
4. Return result

**If a new handler is needed**, the function must be edited to add another `safeHandle()` call. There is no abstraction for "a handler descriptor" or "a strategy for handling a route".

**Impact:**  
- **Violates OCP**: The module is not closed for modification; adding new routes requires editing the file
- **No polymorphism**: All handlers follow the same pattern but are hard-coded in sequence
- **Testing** requires invoking the real IPC registration mechanism or re-implementing it

**Recommendation:**  
Define a handler registry abstraction:
```typescript
export interface HandlerDescriptor {
  route: string
  handler: (event: any, ...args: unknown[]) => Promise<unknown> | unknown
}

const SPRINT_LOCAL_HANDLERS: HandlerDescriptor[] = [
  { route: 'sprint:list', handler: () => listTasksRecent() },
  { route: 'sprint:create', handler: async (_e, task) => { ... } },
  { route: 'sprint:update', handler: async (_e, id, patch) => { ... },
  // ... more
]

export function registerSprintLocalHandlers(deps: SprintLocalDeps): void {
  for (const descriptor of SPRINT_LOCAL_HANDLERS) {
    safeHandle(descriptor.route, descriptor.handler)
  }
}
```

This makes it easy to test the handler list (no IPC invocation needed), and to add new handlers by appending to the array.

**Effort:** S  
**Confidence:** Medium

---

## F-t4-cleansolid-7: Large Utilities Without Cohesion — sprint-queries.ts Re-exported + 27 Exported Functions in 966 Lines

**Severity:** Medium  
**Category:** Class / Module Cohesion & File Bloat  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:18–32 (re-exports), lines 1–966 (full file)`

**Evidence:**  
The module re-exports reporting functions (lines 18–31) without owning them:
```typescript
export {
  getDoneTodayCount,
  getFailureReasonBreakdown,
  getTaskRuntimeStats,
  getSuccessRateBySpecType,
  getDailySuccessRate
} from './reporting-queries'
```

This is barrel export pattern (delegating to another module). Combined with 27 functions in the module itself, the module tries to be "all sprint-task queries" without clear boundaries:

- **Core CRUD queries**: `getTask()`, `listTasks()`, `createTask()`, `updateTask()`, `deleteTask()`
- **State transition queries**: `claimTask()`, `releaseTask()`, `markTaskDoneByPrNumber()`, `markTaskCancelledByPrNumber()`
- **Dependency graph queries**: `getTasksWithDependencies()`, `getAllTaskIds()`
- **Health/monitoring queries**: `getHealthCheckTasks()`, `getActiveTaskCount()`, `getQueuedTasks()`, `getQueueStats()`
- **Maintenance queries**: `pruneOldDiffSnapshots()`, `clearSprintTaskFk()`
- **Domain-specific queries**: `listTasksWithOpenPrs()`, `updateTaskMergeableState()`

**Impact:**  
- **Poor discoverability**: Callers must know 27 function names to use the module
- **High maintenance cost**: Changes to any query logic require editing this 966-line file
- **Tangled concerns**: Reporting queries are re-exported from another module; mutation queries are mixed with read queries

**Recommendation:**  
Reorganize into focused submodules:
- `sprint-task-crud.ts` — `getTask()`, `listTasks()`, `createTask()`, `updateTask()`, `deleteTask()`
- `sprint-task-transitions.ts` — `claimTask()`, `releaseTask()`, `markTaskDone()`, `markTaskCancelled()`
- `sprint-task-graph.ts` — `getTasksWithDependencies()`, `getAllTaskIds()`, dependency-related queries
- `sprint-task-health.ts` — `getHealthCheckTasks()`, `getActiveTaskCount()`, `getQueueStats()`, maintenance
- Keep `sprint-queries.ts` as a facade that re-exports from the submodules for backward compatibility

This reduces file size, improves testability, and makes responsibilities explicit.

**Effort:** M  
**Confidence:** Medium

---

## F-t4-cleansolid-8: App.tsx — Renderer Root with 284 Lines Bundling Setup, State Initialization, and Layout Orchestration

**Severity:** Low  
**Category:** SOLID / Single Responsibility Principle (SRP) Violation (minor)  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/App.tsx:1–284`

**Evidence:**  
The `App()` component (lines 108–265) does:
1. **Initialization** (lines 121–127) — calls multiple hooks (`useOnboardingCheck()`, `useAppInitialization()`, `useAppShortcuts()`, `useGitHubErrorListener()`, `useDesktopNotifications()`)
2. **Event listeners setup** (lines 130–188) — 5 separate `useEffect` hooks for tab removal, tab return, cross-window drop, Escape key, and feature guide
3. **Document title management** (lines 176–180)
4. **Window close tracking** (lines 191–197)
5. **Layout rendering** (lines 214–263) — composed of UnifiedHeader, Sidebar, PanelRenderer, CommandPalette, etc.
6. **State management** (lines 109–120) — manages `shortcutsOpen`, `featureGuideOpen`, and reads stores

The `AppRoot()` wrapper (lines 277–282) conditionally renders based on query params, further mixing concerns.

**Impact:**  
Testing the `App` component requires mocking all hooks, all event listeners, and all store interactions. Adding a new initialization hook (e.g., `useMetricsReporter()`, `useCrashReporter()`) requires editing the component body.

**Recommendation:**  
Extract initialization into a custom hook:
```typescript
function useAppInitialization_All() {
  useOnboardingCheck()
  useAppInitialization()
  useAppShortcuts({ ... })
  useGitHubErrorListener()
  useDesktopNotifications()
  useTearoffWindowListeners()
  useCrossWindowDrop()
  useDocumentTitle()
  useWindowCloseTracking()
}

function App() {
  const { shortcutsOpen, setShortcutsOpen, featureGuideOpen, setFeatureGuideOpen } = useAppInitialization_All()
  // ... render
}
```

This reduces the component to pure render logic and makes initialization testable as a separate unit.

**Effort:** S  
**Confidence:** Medium

---

## Summary of Refactoring Priorities

| Finding | Effort | Impact | Priority |
|---------|--------|--------|----------|
| F-t4-cleansolid-1 (AgentManagerImpl) | M | High | 1 |
| F-t4-cleansolid-2 (sprint-queries) | M | High | 2 |
| F-t4-cleansolid-3 (run-agent) | L | High | 3 |
| F-t4-cleansolid-4 (completion) | M | High | 4 |
| F-t4-cleansolid-5 (RunAgentDeps) | S | Medium | 5 |
| F-t4-cleansolid-6 (sprint-local) | S | Medium | 6 |
| F-t4-cleansolid-7 (module cohesion) | M | Medium | 7 |
| F-t4-cleansolid-8 (App.tsx) | S | Low | 8 |

**Total Estimated Effort:** ~6–8 weeks for systematic refactoring (2–3 weeks per major class decomposition, parallelizable after design review).


# Vocabulary Audit: Naming Health Report

## Overall Assessment

The BDE codebase exhibits **generally strong vocabulary discipline** with domain-specific, intention-revealing names. Most violations are concentrated in specific areas: (1) overly generic `data` container names in stores and hooks; (2) imprecise action names in polling hooks (`fetch` / `load` prefix overuse); and (3) label-style handler names that don't clearly express intent. The agent-manager and IPC layers are particularly well-named with clear, purpose-driven vocabulary. However, store patterns show consistent use of generic prefixes (`load`, `fetch`) that obscure whether operations are cached refreshes or initial loads, and selector patterns occasionally use abbreviated or implicit naming that reduces clarity.

---

## Findings

### F-t2-naming-1: Generic "data" Container Names Obscure Type Intent
**Severity:** Medium  
**Category:** Naming  
**Location:** `src/renderer/src/stores/dashboardData.ts:14-18`, `src/renderer/src/stores/sprintTasks.ts:38`  
**Evidence:** `loadData: LoadSnapshot | null`, `throughputData: CompletionBucket[]`, `feedEvents: FeedEvent[]` — the store field is named `loadData`, but it actually holds "system load metrics" (CPU, memory). This name collides with the action method `loadData()` and obscures what type of data is stored. Similarly, `throughputData` and `feedEvents` are sufficiently generic that a new reader cannot immediately tell these are **dashboard** throughput and **agent activity** feed events without reading surrounding code.  
**Impact:** Developers unfamiliar with the domain must read method bodies to understand what "data" refers to. A developer might expect `loadData` to hold a generic data snapshot, not specifically system load metrics. The collision between the field name and the action method name creates cognitive friction.  
**Recommendation:** Rename `loadData` → `systemLoad` (or `loadSnapshot` if it's the structured object). Keep `feedEvents` but consider renaming `throughputData` → `hourlyCompletions` to clarify it is bucketed completion rate per hour, not raw data points. The `loadData()` action can remain since actions are verbs (it's clearly not a data field).  
**Effort:** S  
**Confidence:** High

### F-t2-naming-2: Vague "fetchAgents" / "loadData" Patterns Hide Execution Model
**Severity:** Medium  
**Category:** Naming  
**Location:** `src/renderer/src/hooks/useAgentSessionPolling.ts:7`, `src/renderer/src/hooks/useDashboardPolling.ts:6-7`, `src/renderer/src/stores/agentHistory.ts:53-66`  
**Evidence:** `fetchAgents()` and `fetchAll()` appear as store actions, but they perform **mutable updates to cached state**. The name `fetch` implies "retrieve from network" but conceals the optimistic update pattern, cache expiration logic, and fallback behavior. In `agentHistory.ts:53-66`, `fetchAgents()` calls the API and **immediately sets state** — it's not a pure data fetch, it's a "refresh the agent list in the store." The same issue appears in `useDashboardPolling` where `fetchAll()` batches multiple independent fetches (throughput, events, success rate) behind a generic name.  
**Impact:** Callers cannot distinguish between "fetch fresh data" (always queries network) and "sync state with latest server data" (may be cached). In `useDashboardPolling`, the batched nature of the operation is hidden. New developers may call this action thinking it's lightweight; they may not realize it triggers 3+ network requests simultaneously.  
**Recommendation:** Rename `fetchAgents()` → `refreshAgentList()` to signal it updates local state. Rename `fetchAll()` → `refreshDashboardMetrics()` to clarify it batches metrics refresh. Reserve "fetch" for pure getter functions that don't mutate local state (e.g., `api.agents.list()`). For store actions, use verbs that signal state mutation: `refresh*`, `sync*`, `reload*`.  
**Effort:** M  
**Confidence:** High

### F-t2-naming-3: Abbreviations in Handler Names Obscure Module Boundaries
**Severity:** Low  
**Category:** Naming  
**Location:** `src/main/handlers/agent-handlers.ts:25-30`, `src/main/handlers/synthesizer-handlers.ts`, `src/main/handlers/agent-manager-handlers.ts`  
**Evidence:** Handlers are registered via `safeHandle('local:getAgentProcesses', ...)` and `safeHandle('agent:steer', ...)` — these names use IPC channel names (which are correct) but the module exports names like `registerAgentHandlers` without distinguishing which handlers go with which channel. The channel pattern is intentional (e.g., `'local:spawnClaudeAgent'` clearly maps to IPC), but within the handler modules, related functions like `spawnAdhocAgent` and `steerAgent` use inconsistent verb patterns (`spawn` vs `steer`). The code does not have a clear, consistent naming contract.  
**Impact:** Low — the IPC channels themselves are clear. However, if a developer needs to find where `agent:kill` is handled, they must search across three handler modules. No naming pattern reveals which handlers belong in which file.  
**Recommendation:** Consider a naming prefix system: all agent lifecycle handlers in `agent-handlers.ts` could prefix handler registrations with intent clarity, e.g., `registerAgentLifecycleHandlers()` (what currently exists is correct; just ensuring consistency). This is a minor style point — the IPC channels already provide clarity.  
**Effort:** S  
**Confidence:** Medium

### F-t2-naming-4: "task" vs "run" Terminology Mismatch in Agent Manager
**Severity:** High  
**Category:** Naming  
**Location:** `src/main/agent-manager/run-agent.ts`, `src/main/agent-manager/spawn-and-wire.ts`, type definitions throughout  
**Evidence:** The agent manager uses both `RunAgentTask` (the task being run) and `ActiveAgent` (the running process). The interface `RunAgentTask` at the call site is called a "task" but it's actually **one claim of a sprint task**. If a task is retried, there are multiple `RunAgentTask` instances. Meanwhile, `activeAgents: Map<string, ActiveAgent>` maps by `taskId`, suggesting the agent is uniquely tied to the sprint task. This is **terminologically inconsistent**: in one context, "task" means a sprint task (persistent DB record); in another, it means one attempt (transient runtime claim). Looking at `completion.ts:20-29`, the context structure is `ResolveSuccessContext` with `taskId` — but the handler is dealing with the result of running that task, not the task definition itself.  
**Impact:** Developers cannot easily reason about ownership: does "an agent run a task" or does "a task own an agent run"? The relationship becomes unclear when you see `task.id` and realize it's actually the sprint task's ID, not a run ID. If debugging a retry scenario, the terminology breaks down.  
**Recommendation:** Rename `RunAgentTask` → `SprintTaskClaim` to clarify it's one claim/attempt of a sprint task. Optionally rename the internal `taskId` within agent-manager contexts to `claimedTaskId` or keep a parallel `agentRunId` field to clarify which ID is which. The agent manager's `activeAgents` map should be keyed by `agentRunId`, not `taskId`, if the intent is to track individual runs. This change would propagate through drain-loop, message-consumer, and completion handlers.  
**Effort:** L  
**Confidence:** High

### F-t2-naming-5: "buildTaskStatusMap" Obscures Dependency Resolution Role
**Severity:** Medium  
**Category:** Naming  
**Location:** `src/main/agent-manager/drain-loop.ts:87-103`  
**Evidence:** The function `buildTaskStatusMap()` returns `Map<string, string>` — a map of task ID to status string. The comment says "Build a fresh taskStatusMap for the drain tick" and notes it rebuilds the dependency index when dirty. The function is not just "building a map"; it's **orchestrating the dependency index refresh logic and computing which tasks are eligible to run**. The return value is used in `drainQueuedTasks()` to validate dependencies. The name suggests it's a low-level data structure builder, but it actually contains high-level orchestration logic.  
**Impact:** A developer reading `buildTaskStatusMap()` expects a simple data transform; they don't expect it to have side effects like `deps.depIndex.rebuild()` and `deps.setDepIndexDirty(false)`. The verb "build" is passive and doesn't signal the orchestration and index refreshing happening inside.  
**Recommendation:** Rename `buildTaskStatusMap()` → `refreshDependencyIndexAndGetTaskStatuses()` to signal that it both refreshes the index and returns status data. Alternatively, split into two functions: `refreshDependencyIndexIfDirty()` and `buildTaskStatusMap()`, making the dependency refresh explicit at the call site.  
**Effort:** S  
**Confidence:** Medium

### F-t2-naming-6: "processQueuedTask" Name Hides State Transition Complexity
**Severity:** High  
**Category:** Naming  
**Location:** `src/main/agent-manager/drain-loop.ts:110-132`, `src/main/agent-manager/task-claimer.ts` (where it's defined)  
**Evidence:** The function `processQueuedTask()` appears in the drain loop to handle queued tasks. The name `processQueuedTask` is a label, not vocabulary: it doesn't explain **what processing** happens. Reading the code, it claims the task, prepares a worktree, spawns an agent, initializes tracking, and queues the agent for execution. That's a multi-step state machine transition from `queued` → `active`, not a simple "process" operation. The name is vague enough that a new developer might think it just marks the task as processed, not that it orchestrates a full spawn-and-track pipeline.  
**Impact:** Callers of `processQueuedTask()` in the drain loop don't know the operation is heavyweight and may not understand why it's wrapped in a try-catch that logs but continues (errors are expected during spawn failures). The name gives no hint that this function is the orchestration entry point for the entire claim-to-spawn pipeline.  
**Recommendation:** Rename `processQueuedTask()` → `claimAndSpawnQueuedTask()` to clarify the two major operations: claiming the task and spawning an agent for it. This makes the heavyweight nature of the operation clear at call sites.  
**Effort:** M  
**Confidence:** High

### F-t2-naming-7: Channel Names Mixing Transport and Domain Semantics
**Severity:** Low  
**Category:** Naming  
**Location:** `src/shared/ipc-channels/sprint-channels.ts:146-210` (review channels), `src/shared/ipc-channels/agent-channels.ts:74-79` (agent event history)  
**Evidence:** IPC channels use a naming pattern like `'review:getDiff'`, `'review:getCommits'`, and `'review:mergeLocally'`. These names start with the domain (`review`) but are not consistent with RESTful or semantic action naming. For example, `'review:shipIt'` uses slang (`shipIt`) instead of technical vocabulary (`merge` or `commit`). Meanwhile, `'agent:history'` returns event history, and `'agents:list'` lists agents, but the naming doesn't consistently distinguish between singular (one resource) and plural (collection). There's no clear pattern for when to use `'verb:noun'` (e.g., `'sprint:generatePrompt'`) vs `'noun:verb'` (e.g., `'review:getDiff'`).  
**Impact:** Low — the IPC contract is machine-verified, so inconsistency here doesn't break code. However, it makes the API harder to discover and reason about. A developer looking for "how do I merge?" must search across multiple channels or read documentation.  
**Recommendation:** Standardize IPC channel naming to `'domain:action'` (verb-noun order). For example, `'review:getDiff'` → `'review:fetchDiff'` for consistency with resource-fetching patterns. Rename `'review:shipIt'` → `'review:mergeAndPush'` or `'review:commitAndMerge'` to use domain vocabulary instead of slang. This is a low-priority refactor since the channels already work.  
**Effort:** M  
**Confidence:** Low

### F-t2-naming-8: Store Selector Names Hide Their Purpose
**Severity:** Low  
**Category:** Naming  
**Location:** `src/renderer/src/stores/sprintTasks.ts:59-66`, `src/renderer/src/stores/sprintSelection.ts:20-23`, `src/renderer/src/stores/sprintEvents.ts:29-35`  
**Evidence:** Selectors are exported functions like `selectActiveTaskCount`, `selectReviewTaskCount`, `selectFailedTaskCount`. These follow the `select*` prefix pattern. However, the name `selectActiveTaskCount` doesn't clarify whether it returns a **count** of active tasks or the tasks themselves. Reading the code, it's clear: `state.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length`. But the pattern `selectX` is borrowed from Redux and doesn't consistently signal "compute and return derived value" — it just says "select from state." A reader unfamiliar with the selector pattern might expect `selectActiveTasks()` to return the tasks themselves, not a count.  
**Impact:** Low — once a developer understands the selector pattern, the names are clear. But the pattern is not self-documenting. A developer reading `selectActiveTaskCount()` for the first time may need to check the return type.  
**Recommendation:** Consider renaming to `computeActiveTaskCount()` or `getActiveTaskCount()` to make it clearer that the function computes/derives a value rather than selecting an existing field. Alternatively, keep the `select*` pattern but document it prominently in the store's JSDoc. This is a style consistency issue, not a functional issue.  
**Effort:** S  
**Confidence:** Low

### F-t2-naming-9: "ConsumeMessages" vs "Message Stream Iteration" Vocabulary Confusion
**Severity:** Medium  
**Category:** Naming  
**Location:** `src/main/agent-manager/message-consumer.ts:101-129`  
**Evidence:** The export `consumeMessages()` takes an `AgentHandle` with a `.messages` property (an async iterable) and iterates it, tracking costs and emitting events. The name `consumeMessages` suggests the function is a simple consumer (pattern: iterate and discard). However, the function does **significant work**: it tracks costs, emits events, detects playground HTML writes, and handles OAuth refresh. It's not a passive consumer; it's an **active processor and event orchestrator**. The vocabulary "consume" misleads — the function consumes the stream to power a complex side-effect pipeline, not to extract data from messages.  
**Impact:** Developers reading `consumeMessages()` may underestimate its complexity. They might think it's a simple iteration loop and place complex logic inline, when in fact the function is already orchestrating multiple concerns (cost tracking, event emission, playground detection, OAuth handling).  
**Recommendation:** Rename `consumeMessages()` → `processAgentMessageStream()` to clarify that it processes messages and drives orchestration, not just consumes them. This aligns the name with the function's actual responsibility: driving the entire message-handling pipeline.  
**Effort:** S  
**Confidence:** Medium

### F-t2-naming-10: "turn" Terminology Introduced Without Clear Semantics
**Severity:** Medium  
**Category:** Naming  
**Location:** `src/main/agent-manager/turn-tracker.ts:4-82`  
**Evidence:** The class `TurnTracker` tracks turns, which are defined implicitly in the code as "each time an assistant message is received" (see `if (m.type === 'assistant')`). The term "turn" is domain-specific to Claude SDK (it refers to a turn in the conversation, i.e., one back-and-forth). However, the class doesn't export a clear definition. A developer reading `TurnTracker` might not immediately understand what a "turn" is or why we're tracking them. The field `currentTurnToolCalls` is reset after each assistant message, but the semantics of "current" vs "total" are not obvious from the name alone.  
**Impact:** Moderate — the code works correctly, but domain knowledge is required to understand what "turn" means. A developer unfamiliar with Claude SDK architecture might think "turns" are agent runs or task claims, not conversation turns.  
**Recommendation:** Add a JSDoc comment at the class level explaining that a "turn" is one assistant message in the conversation. Optionally rename `currentTurnToolCalls` → `assistantMessageToolCalls` or `latestTurnToolCalls` to make it clearer that it's scoped to the latest assistant message. The class itself is well-named given the domain context; just ensure the semantics are documented.  
**Effort:** S  
**Confidence:** Low

---

## Summary of High-Impact Findings

1. **Generic "data" field names** hide type intent and collide with action method names (F-t2-naming-1).
2. **Ambiguous "fetch" / "load" action names** don't clarify whether operations mutate state or are pure (F-t2-naming-2).
3. **"RunAgentTask" terminology mismatch** between sprint tasks and agent runs causes confusion about ownership and retry semantics (F-t2-naming-4).
4. **"processQueuedTask" is a label, not vocabulary** — it doesn't clarify the multi-step state transition it orchestrates (F-t2-naming-6).

These findings suggest that the team should adopt clearer naming conventions in three areas:

- **Store actions**: Use verbs like `refresh*`, `sync*`, `reload*` to signal state mutation.
- **Agent manager**: Distinguish between sprint tasks, task claims, and agent runs consistently.
- **High-level orchestration**: Use compound verbs (`claimAndSpawn`, `processAndEmit`) to signal multi-step operations.

The codebase is generally well-structured and names are domain-appropriate. These violations are concentrated in areas where abstraction levels overlap or where generic container types are used without clear intent.

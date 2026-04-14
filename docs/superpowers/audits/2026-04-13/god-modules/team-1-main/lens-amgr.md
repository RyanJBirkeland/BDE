# Agent Manager Surgeon — Lens: amgr

## F-t1-amgr-1: runAgent Orchestration Burden — Phase 1 & 2 Intertwined
**Severity:** High
**Category:** Mixed Responsibilities, Abstraction Violation
**Location:** `src/main/agent-manager/run-agent.ts:714-769`
**Evidence:**
The `runAgent` function orchestrates four distinct phases in a flat sequence:
1. Validate + prepare prompt (validateAndPreparePrompt → validateTaskForRun + assembleRunContext)
2. Spawn + wire agent (spawnAndWireAgent → initializeAgentTracking)
3. Consume messages (consumeMessages)
4. Finalize (finalizeAgentRun → resolveAgentExit + cleanup)

The function conflates validation with prompt assembly (Phase 1), mixing eager task validation (with side effects: repo updates, terminal callbacks, worktree cleanup) with pure prompt generation. validateTaskForRun has no business throwing inside prompt assembly — it's a guard that mutates the task.
**Impact:**
- Testing is harder: can't test prompt assembly without triggering validation side effects
- Error handling is opaque: early exits at lines 728 and 739 silently return without logging why
- Maintenance risk: adding new pre-spawn checks requires understanding four levels of function nesting
**Recommendation:** Extract a separate `GuardAgentSpawn` function that consolidates all task/worktree guards (validation, repo resolution, repo config, etc.) before entering the orchestration loop. Call it once, then chain purely composable phases.
**Effort:** M
**Confidence:** High

---

## F-t1-amgr-2: _processQueuedTask: Gate + Orchestration + Error Handling (125 lines, 7 distinct operations)
**Severity:** Critical
**Category:** Excessive Length, Mixed Responsibilities
**Location:** `src/main/agent-manager/index.ts:257-346`
**Evidence:**
Single method performs:
1. Idempotency check (_processingTasks set guard)
2. Task mapping + validation (mapQueuedTask)
3. Dependency blocking check (checkAndBlockDeps)
4. Repo path resolution (resolveRepoPath)
5. Repo config error handling with task update + terminal callback
6. Task claiming (claimTask)
7. Fresh dependency snapshot refresh (getTasksWithDependencies re-fetch)
8. Worktree setup + error recovery with disk space, locking, cleanup
9. Agent spawn delegation (_spawnAgent)

Each operation has its own error handling, try/catch, and multiple early returns. The method mixes high-level orchestration (dependency checks, claiming) with low-level concerns (worktree disk/lock management).
**Impact:**
- Difficult to test: can't unit test dependency blocking without setting up worktree paths, logger, repo, depIndex
- Hard to change: modifying error handling for repo config impacts 6 other concerns
- Unclear contract: callers don't know which exceptions are caught vs. propagated
- Silent failures: dependency snapshot refresh failures at line 307-309 eat errors silently
**Recommendation:**
Decompose into separate pure functions:
1. `validateAndClaimQueuedTask(raw, taskStatusMap, deps)` → returns validated MappedTask or null
2. `prepareWorktreeForTask(task, repoPath, config, logger)` → returns worktree or throws
3. Wrap both in `_processQueuedTask` as thin orchestrator with single responsibility
**Effort:** L
**Confidence:** High

---

## F-t1-amgr-3: completion.ts: git + task state + auto-merge + retry logic (479 lines)
**Severity:** High
**Category:** Mixed Responsibilities, God Module
**Location:** `src/main/agent-manager/completion.ts`
**Evidence:**
Single module owns:
- Git operations (rebase, auto-commit, push, PR creation) — 95 lines of orchestration
- Task state transitions (error → failed, retry with backoff, done → review → auto-merged)
- Auto-merge policy evaluation (rule matching, diff stats analysis)
- Failure classification (classifyFailureReason with hard-coded FAILURE_PATTERNS lookup table)
- Error propagation (failTaskWithError, hasCommitsAheadOfMain guards)
- Terminal callbacks (onTaskTerminal chained through 5+ functions)

The function `resolveSuccess` is 103 lines, combining git rebase, branch detection, auto-commit, worktree guards, dependency checks, and auto-merge orchestration in a single flow.
**Impact:**
- Testing nightmare: can't test retry logic without mocking git operations
- Hard to extend: adding a new auto-merge rule requires editing FAILURE_PATTERNS and multiple guard functions
- Tight coupling: task state transitions tightly coupled to git I/O
- Duplication risk: failure pattern classification duplicated if retry logic moves elsewhere
**Recommendation:**
Extract a `CompletionPipeline` strategy interface with phases:
1. `GitCompletionPhase` (rebase, branch detection, commit)
2. `TaskStatePhase` (transitions based on commits, classify failure reason)
3. `AutoMergePhase` (evaluate rules, execute squash merge)
**Effort:** L
**Confidence:** High

---

## F-t1-amgr-4: AgentManagerImpl._drainLoop: Task Processing, Dependency Indexing, OAuth, and Concurrency Orchestration
**Severity:** High
**Category:** Mixed Abstraction Levels
**Location:** `src/main/agent-manager/index.ts:413-440`
**Evidence:**
The drain loop mixes:
- High-level orchestration: validation preconditions, dependency index refresh, available slots check
- Mid-level I/O: OAuth token check (checkOAuthToken)
- Low-level task processing: queue fetching and per-task processing in _drainQueuedTasks
- Concurrency state management: tryRecover, circuit breaker state

Line 430: `const tokenOk = await checkOAuthToken(this.logger)` is a mid-stream guard that halts the drain loop but is orthogonal to actual task processing. If OAuth fails mid-loop, the loop silently returns without logging, leaving queued tasks unstaged.
**Impact:**
- Unpredictable failure modes: OAuth failure during drain is silent
- Hard to test: can't test drain preconditions without stubbing OAuth + dependencies
- Future extensibility risk: adding new guards makes the method longer and more fragile
**Recommendation:** Extract drain precondition checks into `_validateDrainPreconditions()` (already exists!) and move OAuth check into the same function with consistent logging.
**Effort:** S
**Confidence:** High

---

## F-t1-amgr-5: watchdog-handler.ts + handleWatchdogVerdict: Decision Logic Fragmentation
**Severity:** Medium
**Category:** Abstraction Violation, Hidden Side Effect
**Location:** `src/main/agent-manager/index.ts:476-507` + `src/main/agent-manager/watchdog-handler.ts`
**Evidence:**
Watchdog verdict decision-making is split across three locations:
- watchdog.ts: Pure health check (returns WatchdogCheck verdict)
- watchdog-handler.ts: Pure decision mapping (returns WatchdogVerdictResult)
- index.ts:476-507: Side effect application (_watchdogLoop updates repo, calls onTaskTerminal, mutates concurrency)

If a new verdict type is added to watchdog.ts, the developer must touch all three files. The shouldNotifyTerminal flag at line 500 couples _watchdogLoop to verdict internals.
**Impact:**
- Coordination burden: verdicts can't be extended without touching three files
- Fragmented logic: "what to do with a verdict" split between watchdog-handler and _watchdogLoop
- Testability: _watchdogLoop combines verdict computation + application
**Recommendation:** Move verdict application logic (lines 478-506) into a new pure function `applyWatchdogVerdict(verdict, agent, result, metrics, repo, logger)`.
**Effort:** S
**Confidence:** Medium

---

## F-t1-amgr-6: onTaskTerminal + Terminal Handler Dependency Chain (Idempotency Race Risk)
**Severity:** Medium
**Category:** Hidden Side Effect, Abstraction Violation
**Location:** `src/main/agent-manager/index.ts:219-229` + `src/main/agent-manager/terminal-handler.ts:72-100`
**Evidence:**
`onTaskTerminal` is called from 8 different places in the codebase (completion.ts, run-agent.ts, index.ts, _watchdogLoop). Each call assumes a shared idempotency guard (a Set with 10-second cleanup timeout). If two completions race (watchdog + finalizeAgentRun), the second caller hits the guard but both have already scheduled cleanup — creating a race condition window.
**Impact:**
- Race condition risk: idempotency guard cleanup race under concurrent terminal callbacks
- Maintenance burden: callers must know about _terminalCalled and its timeout semantics
- Obscured contract: callers don't know if onTaskTerminal is idempotent at the call site
**Recommendation:** Move idempotency guard inside onTaskTerminal itself using a Map<taskId, Promise> to ensure only one terminal flow runs per task, returning the existing promise for duplicate calls.
**Effort:** M
**Confidence:** Medium

---

## F-t1-amgr-7: Dependency Index Rebuild Scatter — Performance & Correctness Risk
**Severity:** Medium
**Category:** Hidden Side Effect, Performance
**Location:** `src/main/agent-manager/index.ts:215-217`, `src/main/agent-manager/terminal-handler.ts:35-41`, `src/main/agent-manager/index.ts:575-593`
**Evidence:**
Dependency index (`_depIndex`) is rebuilt in three places:
1. On startup: full rebuild
2. Each drain tick: incremental refresh via `refreshDependencyIndex`
3. Before resolving dependents: full rebuild inside `handleTaskTerminal`

The rebuild in terminal-handler happens inside `handleTaskTerminal`, which is called from multiple completion paths. If a fast-fail task completes, terminal handler rebuilds the index from scratch. If completion.ts completes a task successfully 5 seconds later, the index is rebuilt again (expensive O(n) DB query).
**Impact:**
- Performance degradation: each terminal callback triggers O(n) DB query
- Potential correctness issue: index rebuild can race with concurrent task completions, causing missed unblocking
**Recommendation:** Consolidate index refresh into the drain loop only. Mark dependencies as "dirty" when onTaskTerminal is called; the next drain tick does a single refresh.
**Effort:** M
**Confidence:** Medium

---

## F-t1-amgr-8: git-operations.ts: Hardcoded Retry Parameters
**Severity:** Low
**Category:** Single Responsibility (minor)
**Location:** `src/main/agent-manager/git-operations.ts:195-265`
**Evidence:**
The `createNewPr` function handles retry loop with backoff (3 attempts, 3000/8000ms delays), race condition recovery, error parsing and fallback to existing PR lookup. PR_CREATE_MAX_ATTEMPTS and backoff arrays are magic constants (lines 19-20) that aren't configurable.
**Impact:**
- Maintenance risk: retry parameters hardcoded (can't be adjusted per-deployment)
- Testing burden: mocking the retry loop + race recovery requires multiple test cases
**Recommendation:** Extract a reusable `RetryableAsyncTask` utility that takes function + backoff config.
**Effort:** S
**Confidence:** Low

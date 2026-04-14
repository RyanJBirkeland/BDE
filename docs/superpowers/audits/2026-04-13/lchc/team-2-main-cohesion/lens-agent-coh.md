# Agent Manager Cohesion Audit (2026-04-13)

## F-t2-agent-1: run-agent.ts Mixes Four Abstraction Levels
**Severity:** High
**Category:** Mixed Abstraction Levels
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:25–770`
**Evidence:**
- Exports high-level public API (`runAgent`, `consumeMessages`, `validateTaskForRun`, `assembleRunContext`)
- Manages process lifecycle: spawn, abort, exit classification (lines 487–512, 557–624)
- Handles IPC: SDK message parsing, event emission (lines 129–162, 142–146)
- Performs database I/O: task updates, agent history creation (lines 379–384, 444, 449–471)
- Handles file I/O: scratchpad reads, diff capture (lines 302–310, 639)
- Orchestrates multi-step pipelines: validation → spawn → consume → finalize (lines 714–769)

**Impact:** Hard to test individual concerns in isolation. A test of "spawn handling" must mock 5+ dependencies (repo, logger, onTaskTerminal, emitAgentEvent, createAgentRecord). Changes to DB schema, event emission format, or file paths ripple through. Stepdown structure reads like a kitchen sink (processSDKMessage handles costs + events + playground + text extraction).

**Recommendation:** Extract concerns into narrower modules:
- `agent-process-handler.ts`: spawn, consume stream, abort, exit code capture
- `agent-tracking.ts`: activeAgents map, turnTracker wiring, costUsd/tokensIn/tokensOut updates
- `agent-telemetry.ts`: persistAgentRunTelemetry, createAgentRecord, updateAgentMeta (telemetry-only, no business logic)
- `agent-completion-resolver.ts`: classifyExit, call resolveSuccess/resolveFailure (pure completion decisions)
- Keep `runAgent.ts` as orchestrator only (phase 1→2→3→4 flow, error boundaries)

**Effort:** M
**Confidence:** High

---

## F-t2-agent-2: completion.ts Violates SRP: Detects + Rebases + Commits + Merges
**Severity:** High
**Category:** Multi-Responsibility Module
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:98–344`
**Evidence:**
- `resolveSuccess` function (239–344): 100 lines spanning 6 distinct phases:
  1. File system checks (existsSync)
  2. Git branch detection + shell exec
  3. Auto-commit logic
  4. Rebase onto main + conflict handling
  5. Commit count checks + failure retry logic
  6. Transition to review + auto-merge evaluation
- Imports: `git-operations` (rebaseOntoMain, autoCommitIfDirty), `auto-merge-policy` (evaluateAutoMergePolicy), `review-transition` (transitionToReview), `failure-classifier`, task repository, broadcast
- Helper functions: `detectBranch`, `hasCommitsAheadOfMain`, `attemptAutoMerge`, `getRepoConfig` each layer on more concerns

**Impact:** `resolveSuccess` is impossible to unit test without spawning subprocesses and manipulating git. A change to merge policy evaluation, rebase strategy, or review transition logic forces retesting the entire 100-line function. The function reads as a bash script, not domain logic.

**Recommendation:** Extract phases into pure decision functions, delegate execution:
- `detect-completion-status.ts`: has-commits, is-dirty, merge-eligible (pure git queries)
- `completion-strategy.ts`: classifyCompletion → {strategy: 'auto-merge' | 'manual-review' | 'fail'} (pure decision)
- `completion-executor.ts`: execute strategy (spawn rebase, commit, call APIs) — testable via mocks
- Keep `resolveSuccess` as orchestrator: `detect → decide → execute`

**Effort:** M
**Confidence:** High

---

## F-t2-agent-3: index.ts Couples Drain Loop, Dependency Refresh, and Terminal Handlers
**Severity:** High
**Category:** Multi-Responsibility Module
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:337–579`
**Evidence:**
- `_processQueuedTask` (337–367): claims task, validates, checks deps, prepares worktree, spawns agent
- `_validateAndClaimTask` (262–301): maps task, checks blocking deps, resolves repo path, calls onTaskTerminal for errors
- `_prepareWorktreeForTask` (303–335): calls setupWorktree, updates task on error, calls onTaskTerminal
- `onTaskTerminal` (223–234): updates metrics, calls handleTaskTerminal (which triggers resolveDependents), sets depIndexDirty flag
- `_drainLoop` (439–477): rebuilds/refreshes dep index, checks OAuth, spawns tasks, tries recovery

**Impact:** Changes to terminal handling (e.g., which metrics to record) affect task queueing. Changes to dep-refresh strategy (incremental vs. full rebuild) leak into drain loop timing. Tests must mock 10+ dependencies and manage complex state transitions (processing → claimed → active → terminal). Hard to reason about in what order side effects fire.

**Recommendation:**
- Extract `task-queueing-service.ts`: claim, validate, check blocking deps (pure decisions + DB reads)
- Extract `worktree-provisioning-service.ts`: setupWorktree + error handling as isolated service
- Extract `terminal-event-dispatcher.ts`: metric recording + dep index dirtyness + dependent resolution (all terminal-path side effects)
- `index.ts` becomes: drain loop orchestrator that calls these services in order

**Effort:** L
**Confidence:** High

---

## F-t2-agent-4: sdk-adapter.ts Does Protocol Parsing + Process Spawning + Handle Normalization
**Severity:** Medium
**Category:** Mixed Abstraction Levels
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/sdk-adapter.ts:97–250+`
**Evidence:**
- Exports `spawnAgent` which dispatches to either SDK or CLI (lines 97–117)
- `spawnViaSdk`: wraps SDK message stream, extracts sessionId, wires abort controller, implements steering (lines 119–177)
- `spawnViaCli`: spawns subprocess, wires stdin/stdout, sets NODE_OPTIONS (lines 179–250+)
- Message protocol helpers: `asSDKMessage`, `getNumericField`, `isRateLimitMessage`, `getSessionId` (lines 41–71)
- Environment configuration: `withMaxOldSpaceOption`, `buildAgentEnv` usage, OAuth token handling (lines 89–95, 103–107)

**Impact:** Testing spawn behavior requires mocking SDK, subprocess, and I/O streams. Changes to CLI fallback logic, NODE_OPTIONS tuning, or SDK message wrapping require touching multiple abstraction levels. Unclear what's "protocol parsing" vs. "process management" vs. "environment setup."

**Recommendation:**
- `sdk-protocol.ts`: SDK message shape, parsing helpers (asSDKMessage, getNumericField, etc.) — pure
- `cli-spawning.ts`: CLI subprocess spawn + NODE_OPTIONS cap — isolated process handler
- `sdk-spawning.ts`: SDK query() wrapping + sessionId extraction — SDK-specific
- `agent-spawning.ts`: dispatcher (try SDK, fallback CLI) + returns normalized AgentHandle — orchestrator

**Effort:** M
**Confidence:** Medium

---

## F-t2-agent-5: terminal-handler.ts Couples Metrics, Dependency Resolution, and Config Callbacks
**Severity:** Medium
**Category:** Mixed Abstraction Levels
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/terminal-handler.ts:10–104`
**Evidence:**
- `recordTerminalMetrics` (10–16): maps status → metric increment (3 lines)
- `resolveTerminalDependents` (18–56): calls resolveDependents, sets dep index dirty flag, logs errors
- `executeTerminal` (68–81): records metrics, checks config.onStatusTerminal, dispatches to resolveTerminalDependents
- `handleTaskTerminal` (83–104): idempotency guard with Map, calls executeTerminal, cleanup in finally

**Impact:** Cannot test "record terminal metrics" without also testing "resolve dependents." Cannot change dependent-resolution behavior without understanding metrics recording. The function reads as "on terminal, do 3 unrelated things" rather than "transition terminal state."

**Recommendation:**
- `terminal-metrics.ts`: recordTerminalMetrics only — pure side effect
- `dependent-resolution-service.ts`: resolveTerminalDependents — pure business logic (move from resolve-dependents.ts if it's an orchestrator)
- `terminal-transition.ts`: executeTerminal as pure decision (what to do given task status) + returns list of side effects
- Keep `handleTaskTerminal` as side-effect executor + idempotency guard

**Effort:** S
**Confidence:** Medium

---

## F-t2-agent-6: initializeAgentTracking Spans Database + IPC Emission + In-Memory Registry
**Severity:** Medium
**Category:** Hidden Dependency
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:410–481`
**Evidence:**
- Wires stderr to IPC emission (lines 422–424)
- Mutates activeAgents map (line 440)
- Creates TurnTracker instance (line 441)
- Persists agent_run_id to DB (lines 443–447)
- Creates agent-history record (lines 449–471)
- Emits agent:started event (lines 474–478)
- Returns multi-layered object with agent, agentRunId, turnTracker

**Impact:** Adding a new tracking concern (e.g., "record agent spawn IP" or "emit to Datadog") requires modifying this 70-line function. Hard to test: must mock repo.updateTask, createAgentRecord, and emitAgentEvent. Stderr wiring buries IPC concern inside what should be "set up tracking state."

**Recommendation:** Extract `agent-tracking-initializer.ts`:
- Pure setup: `setupAgentRecord() → { agent, agentRunId, turnTracker }` (no DB, no events)
- Separate side-effector: `persistAgentTracking(agent, agentRunId) → Promise` (DB writes)
- Separate side-effector: `wireAgentIPC(handle, agentRunId) → void` (event emission + stderr)
- Caller orchestrates: setup → persist → wire

**Effort:** S
**Confidence:** High

---

## F-t2-agent-7: resolveAgentExit Chains Decision → Data Update → Event Emission in Single Function
**Severity:** Medium
**Category:** Multi-Responsibility Module
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:557–624`
**Evidence:**
- Classifies exit (fast-fail vs. normal) — pure decision (line 568)
- Updates task status based on classification — DB I/O (lines 573–595)
- Calls onTaskTerminal for side effects (lines 586, 620)
- Calls resolveSuccess/resolveFailure to orchestrate further pipelines (lines 600–621)
- Error handling mixes classification errors with update errors (lines 581–585, 594–596)

**Impact:** Cannot test "fast-fail classification" without mocking repo.updateTask. Cannot change retry logic without touching exit classification. Function does 4 jobs: decide → log error → update DB → chain next handler.

**Recommendation:**
- `exit-classifier.ts`: classifyExit → enum (pure)
- `exit-handler.ts`: given classification and task, return {...taskUpdate, shouldRequeue, shouldTerminal} (pure decision)
- `exit-executor.ts`: apply task updates, call onTaskTerminal, invoke resolveSuccess/Failure (orchestrator)
- Keep runAgent as simple phase sequencer

**Effort:** S
**Confidence:** High

---

## F-t2-agent-8: completion.ts failTaskWithError Centralizes Error Handling but Scatters Updates
**Severity:** Low
**Category:** Hidden Dependency
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:98–127`
**Evidence:**
- Helper function `failTaskWithError` (98–127) logs, broadcasts event, updates task, calls onTaskTerminal
- Used 3 times in `resolveSuccess` (lines 245–252, 261–268, 273–280)
- Each call duplicates: taskId, message, notes, repo, logger, onTaskTerminal (6 params)
- If error handling logic changes (e.g., "add Sentry notification"), all call sites ripple

**Impact:** Error paths are tightly coupled. Cannot retest error handling without running full `resolveSuccess`. Hard to localize what "failing a task" means when it's spread across log + broadcast + DB + callback.

**Recommendation:**
- Keep `failTaskWithError` but reduce to pure decision: `{ taskUpdate, shouldCallTerminal, events }` (no I/O)
- Separate executor: `executeTaskError(decision, ...)` applies task update, emits event, calls terminal
- This unblocks reusing error handling in other contexts (spawn failure, validation failure, etc.)

**Effort:** S
**Confidence:** Low

---

## F-t2-agent-9: 25+ Import Lines in index.ts Suggests Insufficient Factoring
**Severity:** Low
**Category:** Hidden Dependency
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:1–46`
**Evidence:**
- Lines 1–46: 25 import statements spanning:
  - Lifecycle: concurrency, watchdog, orphan recovery, worktree pruning
  - Dependency mgmt: dependency-service, epic-dependency-service, task-mapper, resolve-dependents
  - I/O: paths, settings, metrics, agent-event-mapper
  - Spawn: run-agent, sdk-adapter
  - Utilities: circuit breaker, OAuth, terminal handler
- Each import pulls a new concern into the class

**Impact:** Large import surface = tightly coupled surface. Changes to any imported module's API ripple into index.ts. Hard to reason about which concerns are truly "core drain loop" vs. "delegated to helpers."

**Recommendation:** Not immediately actionable, but signals that the class is doing too many things. Once F-t2-agent-1 through F-t2-agent-7 are factored, expected import count should drop to ~15 (interfaces, core lifecycle, orchestration only).

**Effort:** N/A (diagnostic)
**Confidence:** Medium

---

## F-t2-agent-10: Stepdown Structure Incomplete in run-agent.ts
**Severity:** Low
**Category:** Mixed Abstraction Levels
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:82–770`
**Evidence:**
- Public exports: `runAgent`, `consumeMessages`, `validateTaskForRun`, `assembleRunContext` (called from different contexts)
- Private helpers: `validateAndPreparePrompt`, `handleSpawnFailure`, `spawnAndWireAgent`, `resolveAgentExit`, `cleanupOrPreserveWorktree`, `finalizeAgentRun`
- Mix of 5-line helpers (processSDKMessage) and 100-line orchestrators (resolveAgentExit)
- No clear "high-level phases → mid-level steps → low-level primitives" cascade

**Impact:** Reader cannot quickly identify: "What's the main flow? What are optional concerns?" The function list reads as a flat namespace of concerns.

**Recommendation:**
- Move `validateTaskForRun`, `assembleRunContext` to `task-validation.ts` (used independently by index.ts)
- Group lifecycle phases in runAgent with clear comments:
  ```ts
  // Phase 1: Prepare
  const prompt = await validateAndPreparePrompt(...)
  
  // Phase 2: Spawn + Wire
  const { agent, agentRunId, turnTracker } = await spawnAndWireAgent(...)
  
  // Phase 3: Consume
  const { exitCode, lastAgentOutput } = await consumeMessages(...)
  
  // Phase 4: Finalize
  await finalizeAgentRun(...)
  ```
- This makes the stepdown structure visible and explicit

**Effort:** S
**Confidence:** Medium

---

## Summary

**Critical Issues (F-t2-agent-1, F-t2-agent-2, F-t2-agent-3):** Run agent pipeline spans 4 abstraction levels (process + IPC + DB + orchestration). Completion handler mixes git, commit, rebase, and merge decisions. Drain loop couples queueing, dependency refresh, and terminal dispatch.

**High-Priority Extractions:**
1. Separate process lifecycle (spawn/abort/consume) from tracking (agent record, telemetry)
2. Factor completion into detect-status → decide-strategy → execute-workflow
3. Extract task-queueing service from drain loop; make terminal handler pure

**In-Flux Areas:** sdk-adapter.ts is noted as "being modified (SDK options fix)" — refactoring should wait for that to stabilize, but expect cohesion issues to emerge once options are handled.

**Effort Estimate:** 10–15 working days if done in priority order (1 module per day for refactoring + tests).

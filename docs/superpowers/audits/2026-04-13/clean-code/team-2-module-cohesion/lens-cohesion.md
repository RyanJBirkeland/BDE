# Module Cohesion Analysis
**Date:** 2026-04-13  
**Scope:** Task completion, git operations, dependency resolution, and UI state management  
**Focus:** Identifying files with multiple reasons to change (violating SRP at the module level)

---

## F-t2-cohesion-1: completion.ts Conflates Task State Machine + Git Operations
**Severity:** High  
**Category:** Multiple Reasons to Change  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts` (506 lines)

**Evidence:**
- **Axis 1 (Task State Machine):** Lines 131–161 (`failTaskWithError`), 456–506 (`resolveFailure`) — update task status, set `claimed_by`, calculate retry backoff, emit agent events
- **Axis 2 (Git Operations):** Lines 61–68 (`detectBranch`), 75–100 (`getDiffFileStats`), 204–266 (`attemptAutoMerge`), 272–281 (`findOrCreatePR`) — branch detection, diff parsing, auto-review rule evaluation, PR creation
- **Axis 3 (Business Logic - Auto-merge):** Lines 201–266 — read settings, evaluate auto-review rules, decide when to merge based on file diffs

**Impact:**
- If task state machine semantics change (e.g., new retry strategy or terminal status classification), you edit task-state code (456–506) but also risk breaking git flow (204–266 depends on `resolveFailure` decision)
- If auto-review rules change (e.g., new merge strategy), you change lines 204–266, but this also changes when/how worktrees are cleaned and when `onTaskTerminal` is called
- Test suite must cover task transitions AND git operations AND auto-merge logic in the same file, making test scope bloated
- Merge conflicts likely when one dev changes task retry logic and another changes auto-merge rules

**Recommendation:**
Split into three modules:
1. **completion-state-machine.ts** — `resolveFailure`, `failTaskWithError`, `classifyFailureReason` — pure task state transitions
2. **completion-git-flow.ts** — `detectBranch`, `getDiffFileStats`, `autoCommitIfDirty`, git rebasing/pushing (delegate to existing git-operations.ts)
3. **completion-auto-merge.ts** — `attemptAutoMerge`, auto-review rule evaluation; depends on completion-state-machine + git-flow

**Effort:** M  
**Confidence:** High

---

## F-t2-cohesion-2: run-agent.ts Mixes Agent Lifecycle + Task State + Cost Tracking
**Severity:** High  
**Category:** Multiple Reasons to Change  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts` (689 lines)

**Evidence:**
- **Axis 1 (Agent Lifecycle):** Lines 351–476 (`spawnAndWireAgent`) — spawn process, wire stderr/event handlers, create ActiveAgent tracking
- **Axis 2 (Task State Machine):** Lines 226–258 (`validateTaskForRun`), 482–635 (`finalizeAgentRun`) — task validation, status transitions (error/queued/done), failed task retry counts, dependency resolution
- **Axis 3 (Cost & Token Accounting):** Lines 98–105 (`trackAgentCosts`), 525–551 (persist cost breakdown) — extract costs from SDK messages, update token counters, persist to agent_run cost table
- **Axis 4 (Message Processing & Playground):** Lines 128–161 (`processSDKMessage`), 110–123 (`detectPlaygroundWrite`) — map messages to events, detect playground writes, emit events

**Impact:**
- If cost accounting schema changes (e.g., cache token breakdown), you touch cost-tracking code (98–105, 525–551) and also risk cascade changes to cost persistence (540–551)
- If task state machine rules change (e.g., fast-fail logic, lines 557–571), you also need to update cost persistence and agent run finalization (526–635)
- Test file must cover agent spawning, task state changes, cost tracking, and event emission simultaneously — scope is massive (689 lines)
- A bug in message processing (line 146) can corrupt cost tracking (line 100) because both are tightly coupled in one flow

**Recommendation:**
Decompose into layers:
1. **agent-spawn.ts** — spawn agent, wire handlers, manage ActiveAgent lifecycle
2. **agent-message-processor.ts** — message consumption, event mapping, playground detection
3. **agent-cost-tracker.ts** — extract costs from messages, update totals, persist to DB
4. **agent-completion-state.ts** — task state transitions, fast-fail logic, retry handling (probably calls completion.ts)

**Effort:** L  
**Confidence:** High

---

## F-t2-cohesion-3: sprint-queries.ts Mixes Data Mapping + State Machine + Audit Trail
**Severity:** High  
**Category:** Multiple Reasons to Change | Utility Bin  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts` (972 lines)

**Evidence:**
- **Axis 1 (Data Mapping):** Lines 66–84 (`mapRowToTask`), 181–202 (`serializeFieldForStorage`) — SQLite row ↔ SprintTask conversion
- **Axis 2 (Query Logic):** Lines 219–242 (`listTasks`), 355–460 (`updateTask`), 491–538 (`claimTask`) — SQL building, filtering, joining
- **Axis 3 (State Machine Enforcement):** Lines 370–378 (`validateTransition` called in updateTask) — enforce valid status transitions before allowing updates
- **Axis 4 (Audit Trail):** Lines 434–445 (record task changes), 518–524 (audit claim), 558–564 (audit release) — log all mutations to task_changes table
- **Axis 5 (Business Logic - WIP Limits):** Lines 484–489 (`checkWipLimit`) — enforce max active task constraint during claim

**Impact:**
- If task schema changes (new field, type change), you update mapRowToTask (66–84) AND serializeFieldForStorage (181–202) AND UPDATE_ALLOWLIST (95–133) — three synchronized places
- If state machine semantics change (e.g., "error" → "blocked"), you must update validateTransition call (370–378) but also update transitions in markTaskDoneByPrNumber/markTaskCancelledByPrNumber (614–697) — scattered logic
- If audit trail schema changes, you need to modify recordTaskChanges calls in 5+ places (lines 434, 518, 558, 812, etc.)
- A bug in serializeFieldForStorage (line 195, booleans → 1/0) affects both create and update paths because they share this function
- File is a 972-line "miscellaneous" bin: data mapping, SQL building, state machine, audit, WIP limits

**Recommendation:**
Split by concern:
1. **sprint-task-mapper.ts** — mapRowToTask, serializeFieldForStorage, sanitize functions (pure data mapping)
2. **sprint-task-queries.ts** — SQL building, listTasks, listTasksRecent, getQueuedTasks (query layer only)
3. **sprint-task-state.ts** — updateTask, claimTask, releaseTask with embedded state-machine validation (state machine + mutation)
4. **sprint-task-audit.ts** — wrapper around recordTaskChanges to centralize audit logging
5. Move WIP checking to a policy service

**Effort:** L  
**Confidence:** High

---

## F-t2-cohesion-4: task-terminal-service.ts Conflates Dependency Resolution + Event Batching + Broadcasting
**Severity:** Medium  
**Category:** Multiple Reasons to Change | Multiple Actors  
**Location:** `/Users/ryan/projects/BDE/src/main/services/task-terminal-service.ts` (114 lines)

**Evidence:**
- **Axis 1 (Event Batching & Scheduling):** Lines 44–106 (setTimeout coalescing, pending resolution map) — batch multiple task completions into one resolution pass
- **Axis 2 (Dependency Resolution):** Lines 71–83 (call resolveDependents) — figure out which downstream tasks should unblock
- **Axis 3 (Error Broadcasting):** Lines 100–101 (broadcast 'task-terminal:resolution-error') — emit error events to renderer

**Impact:**
- If event batching strategy changes (e.g., switch from setTimeout to microtask or a queue), you touch the scheduling logic (55–106) but also need to understand how resolveDependents reacts to batching
- If dependency semantics change, you modify resolveDependents signature (line 71), but this is called from inside the batching logic, forcing you to understand both
- Error broadcasting is tightly coupled to batching — if one batch element fails, the whole broadcast happens (line 100)
- Test expectations are coupled: "when 3 tasks complete synchronously, all should batch into one resolution pass AND emit one error if any fails"

**Recommendation:**
Separate scheduling from resolution:
1. **task-terminal-scheduler.ts** — setTimeout coalescing, pending map management, fire callback when batch is ready
2. **task-terminal-resolver.ts** — pure dependency resolution, returns which tasks to unblock (no I/O)
3. Have scheduler call resolver, then broadcast results or errors

**Effort:** S  
**Confidence:** Medium

---

## F-t2-cohesion-5: sprint-local.ts Serves Multiple Actors: IPC Handler + UI Business Logic + Settings Validation
**Severity:** Medium  
**Category:** Multiple Actors | Mixed Abstraction Layer  
**Location:** `/Users/ryan/projects/BDE/src/main/handlers/sprint-local.ts` (209 lines)

**Evidence:**
- **Actor 1 (IPC Server):** Lines 48–209 — register `safeHandle()` callbacks for renderer requests (sprint:list, sprint:create, sprint:update, etc.)
- **Actor 2 (Business Logic):** Lines 54–67 (task validation), 85–112 (status transition prep), 174–189 (dependency cycle detection)
- **Actor 3 (Settings/Config Access):** Lines 140–146 (read task.templates from settings), lines 9 (dialog service injection)

**Impact:**
- If the renderer decides to split task-update into two IPC calls (one for spec, one for status), the handler logic (85–112) must change
- If task creation validation rules tighten (e.g., reject short titles), you edit the handler (54–67) which conflates IPC request dispatching with business logic
- Error responses must satisfy both IPC contract AND business logic semantics — a single place to mess up
- Handler registration is interleaved with business logic — hard to test business logic in isolation from IPC framework

**Recommendation:**
Extract pure business services and inject them into handlers:
1. **sprint-service.ts (or sprint-command-handler.ts)** — pure functions: validateTaskCreation, prepareQueueTransition, validateDependencies, etc. — NO IPC dependencies
2. Keep sprint-local.ts thin: only safeHandle wrapper, input/output serialization, error-to-IPC-response mapping

**Effort:** M  
**Confidence:** Medium

---

## F-t2-cohesion-6: sprintTasks.ts (Renderer Store) Conflates Optimistic Updates + State Merging + Event Handling
**Severity:** Medium  
**Category:** Multiple Reasons to Change  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/stores/sprintTasks.ts` (439 lines)

**Evidence:**
- **Axis 1 (Data Loading & Polling):** Lines 67–96 (loadData, fetch from IPC) — poll server, handle response arrays
- **Axis 2 (Optimistic Updates):** Lines 38–40, 98–148 (pendingUpdates tracking, TTL expiration, field-level merge) — overlay local changes on server response
- **Axis 3 (Derived State):** Lines 55–57 (`countActiveTasks`), 145 (activeTaskCount computed in set call) — maintain activeTaskCount from tasks array
- **Axis 4 (Temp Pending Creates):** Lines 40, 135–140 (pendingCreates tracking) — keep optimistically-created tasks in state until they arrive from server

**Impact:**
- If polling interval or error handling changes, you touch loadData (67–96) which also calls mergeSseUpdate logic
- If optimistic update TTL strategy changes (currently 2000ms), you update PENDING_UPDATE_TTL but the expiration logic (101–105) is embedded in loadData's state setter
- Derived state computation (activeTaskCount) is coupled to the main data load — if count logic changes, loadData changes
- A race condition bug: if a pending update expires AND the server sends the same task with newer data, the merge logic (115–132) must handle both TTL expiration AND server freshness simultaneously

**Recommendation:**
Decompose into focused concerns:
1. **useSprintTasks-loader.ts** — loadData logic only, fetch + basic error handling
2. **useSprintTasks-merge.ts** — mergeIncoming logic: pending expiration, field-level merge, pending-creates preservation
3. **useSprintTasks-derived.ts** — activeTaskCount computation (might be its own Zustand slice)
4. Compose them in the main store

**Effort:** M  
**Confidence:** Medium

---

## F-t2-cohesion-7: git-operations.ts Mixes Git Infrastructure + Agent-Specific Workflows + PR Creation Policy
**Severity:** Medium  
**Category:** Multiple Reasons to Change  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/git-operations.ts` (150+ lines)

**Evidence:**
- **Axis 1 (Low-level Git Ops):** Lines 88–129 (rebaseOntoMain), lines 135–150 (pushBranch) — raw git command execution, error handling
- **Axis 2 (PR Creation Policy):** Lines 22–36 (parsePrOutput, PR_CREATE_MAX_ATTEMPTS, backoff logic) — decide retry count, parse response
- **Axis 3 (Commit Message Generation):** Lines 41–82 (generatePrBody) — format commit log and diff stats into PR description

**Impact:**
- If retry policy changes (e.g., 3 attempts → 5, or exponential backoff), you modify lines 22–23 and the retry loop (implied in findOrCreatePRUtil, not shown)
- If PR body format changes (team decides on new template), you change generatePrBody (41–82), but this is called from completion.ts which doesn't know about the new format
- A bug in parsePrOutput (32–36) affects both agent completion (finding PR for display) and review workflows (if this utility is reused)
- Abstraction level is inconsistent: some functions are "git commands" (rebaseOntoMain) while others are "agent workflows" (generatePrBody)

**Recommendation:**
1. **git-commands.ts** — rebaseOntoMain, pushBranch, autoCommitIfDirty, deleteBranch, etc. (pure git)
2. **pr-workflow.ts** — generatePrBody, parsePrOutput, PR_CREATE_MAX_ATTEMPTS, retry logic (agent-specific PR policy)
3. Keep only agent-level entry points (findOrCreatePR wrapper) exposed to completion.ts

**Effort:** S  
**Confidence:** Medium

---

## F-t2-cohesion-8: review-orchestration-service.ts Conflates Orchestration + Policy + Execution + Task State Mutations
**Severity:** High  
**Category:** Multiple Reasons to Change | Multiple Actors  
**Location:** `/Users/ryan/projects/BDE/src/main/services/review-orchestration-service.ts` (150+ lines visible)

**Evidence:**
- **Axis 1 (Orchestration Facade):** Lines 56–77 (runPlan helper) — decide which executor to call, wire dependencies
- **Axis 2 (Policy Decisions):** Lines 79–100 (mergeLocally) — read task, route to action classifier, call executor
- **Axis 3 (Task State Mutation & Notification):** Lines 64–72 (broadcast handler, notifySprintMutation) — update task state, broadcast events
- **Axis 4 (Configuration Management):** Lines 51–54 (getRepoConfig) — read repos from settings

**Impact:**
- If review action classification logic changes (e.g., new merge strategy decision tree), you modify classifyReviewAction (imported, line 7) but the policy is scattered across multiple entry points (mergeLocally, shipIt, requestRevision, etc.)
- If task state mutations should be transactional (all-or-nothing), you need to wrap the entire runPlan → broadcast flow (64–72), but this is embedded in the facade
- If repo config resolution changes (e.g., lookup by ID instead of name), you change getRepoConfig (51–54) but all 5+ entry points call it — coupling point
- The broadcast handler (lines 64–72) is a callback nested in runPlan, making it hard to test task mutation logic independently

**Recommendation:**
1. **review-action-policy.ts** (already exists, referenced) — policy decisions, should be pure (no I/O)
2. **review-action-executor.ts** (already exists) — execute git ops, but should NOT mutate task state — return result
3. **review-orchestration-service.ts** (refactor) — thin facade that routes input → policy → executor, then applies task state mutations separately
4. **review-state-manager.ts** — task state transitions during review (should reuse completion-state-machine if possible)

**Effort:** M  
**Confidence:** High

---

## Summary of Patterns

| File | Primary Problem | Fix Strategy |
|------|-----------------|--------------|
| completion.ts | Task state + Git + Auto-merge | Split into state-machine, git-flow, auto-merge layers |
| run-agent.ts | Agent lifecycle + Task state + Cost tracking + Message processing | 4-layer decomposition: spawn, message-processor, cost-tracker, completion-state |
| sprint-queries.ts | Data mapping + Query logic + State machine + Audit + WIP limits | 5-module split by concern |
| task-terminal-service.ts | Event batching + Dependency resolution + Broadcasting | Separate scheduling from resolution |
| sprint-local.ts | IPC handler + Business logic + Settings | Extract pure service layer from handler |
| sprintTasks.ts (Renderer) | Data loading + Optimistic updates + Derived state + Pending creates | Decompose into loader, merge, derived submodules |
| git-operations.ts | Low-level git + PR policy + Commit formatting | Separate git-commands from pr-workflow |
| review-orchestration-service.ts | Orchestration + Policy + Execution + Task mutations | Decompose: policy (pure), executor (I/O only), orchestrator (routing), state-manager |

---

## General Recommendations
1. **Use dependency injection** to wire layers together — don't import across layers
2. **Keep pure logic separate from I/O** — makes testing easier, changes isolated
3. **One file, one reason to change** — if you find yourself editing two parts for different reasons, split them
4. **Extract "decision-making" (policy)** from "execution" — they change independently
5. **Centralize audit/state transitions** — use a service layer so mutations are consistent across all code paths


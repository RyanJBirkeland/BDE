# Clean Code Function Quality Audit (Uncle Bob) — BDE Codebase
**Date:** 2026-04-13  
**Scope:** Backend agent orchestration, frontend React components, data query layers  
**Severity Distribution:** 3 Critical, 3 High, 2 Medium

## Overall Assessment

The BDE codebase exhibits strong architectural separation between orchestration (agent-manager), completion flows, and UI components. However, several functions violate Uncle Bob's single responsibility principle by mixing orchestration with I/O, state mutation, and error handling. The most egregious violations occur in run-agent.ts and completion.ts, where functions >300 lines handle validation, spawning, streaming, classification, and cleanup sequentially rather than extracting these concerns. Sprint queries (sprint-queries.ts) show defensive excellence but make validateTransition failures silently fail rather than propagating errors clearly. The prompt-composer.ts is architecturally sound but requires parameter explosion for various agent types, suggesting opportunity for polymorphism.

---

## F-t4-cleanfn-1: Monolithic `runAgent()` orchestrator mixes four distinct phases with weak phase isolation

**Severity:** Critical  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/run-agent.ts:738-789`  
**Evidence:**  
- Function: 51 lines at call site (lines 738–789), but decomposes into 4 sequential phases:
  - Phase 1: `validateAndPreparePrompt()` — validation + prompt assembly
  - Phase 2: `spawnAndWireAgent()` — process spawn + metadata persistence + event emission
  - Phase 3: `consumeMessages()` — async message streaming + cost tracking + playground emission
  - Phase 4: `finalizeAgentRun()` — exit classification + task state mutation + worktree cleanup
- All phases are async and independent; failure in one cascades to all later phases
- Although extracted into helper functions, the orchestrator function is still the single point of coordination with zero error isolation between phases
- If Phase 2 fails, Phase 4 still runs (via cleanup code at line 762–763 `catch { return }`)

**Impact:** 
- **Testability:** Impossible to test one phase in isolation; all must be mocked together
- **Debuggability:** When something fails mid-stream, the phase at fault is hidden in the orchestrator's control flow
- **Maintainability:** Adding a new phase (e.g., pre-spawn validation, post-finalize cleanup) requires touching the core orchestration logic
- **Error Recovery:** Each phase's error handling is local; the orchestrator has no way to selectively retry or recover a failed phase

**Recommendation:** 
Introduce a `RunAgentPhaseRunner` type with phase result objects:
```typescript
interface PhaseResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  phase: string;
}
```
Refactor `runAgent()` to execute phases with explicit error isolation:
```typescript
const phase1Result = await validateAndPreparePrompt(...);
if (!phase1Result.ok) return logAndCleanup(phase1Result.error);
const phase2Result = await spawnAndWireAgent(...);
if (!phase2Result.ok) return logAndCleanup(phase2Result.error);
// etc.
```
This makes each phase's success/failure explicit and testable.

**Effort:** M  
**Confidence:** High

---

## F-t4-cleanfn-2: `resolveSuccess()` in completion.ts (105 lines) conflates task completion sequencing with command invocation and state mutation

**Severity:** Critical  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/completion.ts:550-655`  
**Evidence:**  
- Function: 105 lines, performing 6 distinct responsibilities:
  1. Lines 555–565: Guard worktree existence (file system check)
  2. Lines 567–581: Detect current branch (git operation)
  3. Lines 596–601: Auto-commit dirty working tree (git state mutation)
  4. Lines 604–618: Rebase onto origin/main (git operation with error handling)
  5. Lines 621–633: Check if commits exist (git query with retry logic)
  6. Lines 640–651: Transition to review or auto-merge (state machine + conditional async call)
- Each section has its own try-catch, logger.warn, and early return
- Lines 636–638 call `transitionToReview()` unconditionally, then line 651 calls `attemptAutoMerge()` which may or may not execute based on settings
- No clear contract on what "success" means or when to stop

**Impact:**
- **Cognitive Load:** The function reads like a checklist script, not a coherent algorithm
- **Testability:** To test "successful completion," must mock git, file system, settings, and task repository simultaneously
- **Composability:** Cannot reuse the "auto-commit + rebase + check commits" sequence for other workflows (e.g., manual rebase recovery)
- **State Machine Clarity:** The transition from "active" → "review" happens inside a success handler, not in a dedicated state machine module

**Recommendation:**
Decompose into task-focused workflow orchestrators:
- `prepareWorktreeForReview()` → encapsulates git prep (commit, rebase, verify)
- `classifyCompletionOutcome()` → examines commits + rebase result, returns outcome type
- `executeCompletionOutcome()` → applies outcome-specific logic (transition, auto-merge, notify)

Refactor `resolveSuccess()` to call these in sequence:
```typescript
const workflowResult = await prepareWorktreeForReview(worktreePath);
if (!workflowResult.ok) return failTaskWithError(..., workflowResult.error);
const outcome = classifyCompletionOutcome(workflowResult);
await executeCompletionOutcome(outcome, { task, repo, logger, ... });
```

**Effort:** M  
**Confidence:** High

---

## F-t4-cleanfn-3: `SprintPipeline` React component (485 lines) uses 14+ Zustand subscriptions and 20+ callbacks, violating separation of concerns

**Severity:** High  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:38-484`  
**Evidence:**  
- Lines 40–95: 14+ Zustand store subscriptions (tasks, loading, selectedTaskId, selectedTaskIds, drawerOpen, specPanelOpen, doneViewOpen, logDrawerTaskId, conflictDrawerOpen, healthCheckDrawerOpen, + 5 setters)
- Lines 101–111: Extract behavior via hooks (handleSaveSpec, handleStop, handleRerun, handleRetry, launchTask, deleteTask, batchDeleteTasks)
- Lines 156–268: Define 10+ local callbacks (handleTaskClick, handleAddToQueue, handleCloseDrawer, handleDeleteTask, handleUnblock, handleReviewChanges, handleClearFailures, handleRequeueAllFailed, handleExport, handleViewOutput)
- Lines 287–483: Render 9 child components, passing state + callbacks as props, with conditional logic (loading, error, empty, normal)
- The component is simultaneously:
  - **Orchestrator:** Manages 5 concurrent overlays (TaskDetailDrawer, PipelineOverlays, ConflictDrawer, DagOverlay, HealthCheckDrawer)
  - **Event Handler:** Routes clicks, unblock requests, review launches, failure clearing
  - **State Synchronizer:** Auto-selects first task on load (lines 185–193), wires KeyboardShortcuts (lines 165–170), manages notification listeners (lines 150–153)
  - **Layout Manager:** Conditionally renders loading skeleton, error banner, empty state, and 3-pane layout

**Impact:**
- **Testability:** Cannot test task selection logic without mocking 14 Zustand stores
- **Reusability:** The 3-pane layout logic (PipelineBacklog + PipelineStage + TaskDetailDrawer) is entangled with notification setup, making it impossible to reuse in another view
- **Maintenance:** Adding a new overlay or callback requires modifying the main component; props drilling becomes unmaintainable
- **Performance:** All 14 subscriptions update the component on every store change; memoization attempts (useShallow, useMemo) are necessary but insufficient

**Recommendation:**
Extract into smaller, single-responsibility components:
- `PipelineLayout` → Renders 3-pane grid, takes `sections: { backlog, stages, detail }` as props
- `TaskSelectionManager` → Handles selectedTaskId logic + auto-select, emits to Zustand
- `OverlayManager` → Manages drawerOpen, specPanelOpen, doneViewOpen state with a single Zustand subscription
- Refactor `SprintPipeline` to compose these:
```typescript
<PipelineLayout
  backlog={<PipelineBacklog {...props} />}
  stages={<PipelineStages {...props} />}
  detail={drawerOpen ? <TaskDetailDrawer {...props} /> : null}
/>
```

**Effort:** L  
**Confidence:** High

---

## F-t4-cleanfn-4: `_drainLoop()` (93 lines) conflates concurrency checking, OAuth validation, dependency refresh, and task claiming

**Severity:** High  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/index.ts:512-604`  
**Evidence:**  
- Lines 514–571: Dependency index refresh (full task fetch + fingerprint cache update + terminal task eviction)
- Lines 573–574: Concurrency check (early return if no slots)
- Lines 576–579: OAuth token check with early return
- Lines 580–597: Task fetch + loop over queued tasks, calling `_processQueuedTask()` for each
- Lines 602–603: Metrics recording + concurrency recovery
- The function handles 3 independent concerns in sequence:
  1. **Dependency Indexing:** Optimized via fingerprinting (lines 544–566) — separate algorithm
  2. **Capacity Checking:** Concurrency guard + OAuth guard — separate validation layer
  3. **Task Claiming:** Loop over tasks and invoke `_processQueuedTask()` for each — separate state machine
- No way to retry just the OAuth check without re-fetching dependencies; no way to refetch dependencies without re-checking capacity

**Impact:**
- **Debugging:** If OAuth fails, logs show "skipping drain" but it's ambiguous whether issue is auth, concurrency, or dependencies
- **Testing:** Unit test must set up all three concerns (dep index, concurrency state, OAuth mock)
- **Monitoring:** Metrics recorded at end (line 602) are aggregates of three distinct operations; no per-concern timing data

**Recommendation:**
Extract phase checkers:
```typescript
async _refreshDependencyIndex(): Promise<void> { /* lines 514–571 */ }
_checkDrainPreconditions(): boolean { /* capacity + OAuth checks */ }
async _drainQueuedTasks(): Promise<void> { /* lines 580–597 */ }

async _drainLoop(): Promise<void> {
  await this._refreshDependencyIndex();
  if (!this._checkDrainPreconditions()) return;
  await this._drainQueuedTasks();
  this._metrics.setLastDrainDuration(...);
}
```
Each can be tested, logged, and retried independently.

**Effort:** M  
**Confidence:** High

---

## F-t4-cleanfn-5: `validateAndPreparePrompt()` (81 lines) mixes validation, task state mutation, cleanup, and context assembly

**Severity:** High  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/run-agent.ts:364-446`  
**Evidence:**  
- Lines 372–396: Validation phase — check task has content, update task to error status, call cleanup, throw
- Lines 398–418: Dependency fetching phase — fetch upstream tasks, extract specs, handle errors
- Lines 420–430: Scratchpad creation phase — mkdir, read prior scratchpad, suppress errors
- Lines 432–445: Prompt assembly phase — call `buildAgentPrompt()` with assembled context
- If validation fails at line 395, the function throws, but task has already been mutated to 'error' status at line 376; the caller (`runAgent()` line 750) doesn't know this and continues as if nothing happened
- The function both reads state (task content) and writes state (task.status = error, task.notes = ...)

**Impact:**
- **Side Effects Hidden:** Callers expect a pure function that returns a prompt string; they don't expect task mutations
- **Error Isolation:** When this function throws, the agent is already in 'error' state but hasn't been logged; later phases may not recognize this
- **Testing:** Cannot test prompt assembly without triggering worktree cleanup and task state mutations
- **Composability:** Cannot reuse prompt assembly (the legitimate concern) without accepting the validation + cleanup + mutation bundle

**Recommendation:**
Split into two functions:
- `validateTaskContent(task)` → returns `{ valid: boolean; error?: string }`
- `assembleAgentPrompt(task, context)` → pure function returning string

Caller (`runAgent()` or a new validation phase) handles the validation result:
```typescript
const validation = validateTaskContent(task);
if (!validation.valid) {
  await repo.updateTask(task.id, { status: 'error', notes: validation.error, ... });
  await cleanupWorktree(...);
  return; // early exit
}
const prompt = await assembleAgentPrompt(task, context);
```

**Effort:** S  
**Confidence:** High

---

## F-t4-cleanfn-6: `buildAgentPrompt()` dispatcher (32 lines, export at 650) requires 8 different BuildPromptInput configurations, each type-checked separately

**Severity:** Medium  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/prompt-composer.ts:650-682`  
**Evidence:**  
- The function switches on `agentType` (lines 654–671) and dispatches to one of 5 builders:
  - `buildPipelinePrompt()` — takes taskContent, branch, playgroundEnabled, retryCount, previousNotes, maxRuntimeMs, upstreamContext, crossRepoContract, repoName, taskId, priorScratchpad
  - `buildAssistantPrompt()` — takes taskContent, branch, playgroundEnabled, upstreamContext, crossRepoContract, repoName
  - `buildCopilotPrompt()` — takes messages, playgroundEnabled, upstreamContext, repoPath, formContext
  - `buildSynthesizerPrompt()` — takes codebaseContext, taskContent, playgroundEnabled, upstreamContext
  - `buildReviewerPrompt()` — takes reviewerMode, diff, reviewSeed
- Each builder requires different fields; passing an irrelevant field (e.g., `taskContent` to copilot) causes silent no-ops because the field is just ignored
- TypeScript's union type `BuildPromptInput` contains all fields, making it impossible for type checking to enforce "agent X must have field Y"
- The caller must know which fields are required for each agent type

**Impact:**
- **Type Safety:** TypeScript doesn't catch passing `taskContent` to a copilot when it should be `messages`; the field just sits unused
- **Discoverability:** New callers must read the switch statement to understand what fields each agent needs
- **Extensibility:** Adding a 6th agent type requires updating 5 places (the BuildPromptInput union, the switch case, + parameter naming inconsistency review)

**Recommendation:**
Replace the union type with discriminated union (discriminant = agentType):
```typescript
type BuildPromptInput = 
  | { agentType: 'pipeline'; taskContent: string; branch: string; ... }
  | { agentType: 'copilot'; messages: Array<...>; repoPath: string; ... }
  | { agentType: 'synthesizer'; codebaseContext: string; ... }
```
TypeScript will now enforce that copilot inputs never include taskContent. Dispatching happens automatically via type narrowing:
```typescript
export function buildAgentPrompt(input: BuildPromptInput): string {
  switch (input.agentType) {
    case 'pipeline':
      return buildPipelinePrompt(input); // input: PipelineInput, all fields available
    case 'copilot':
      return buildCopilotPrompt(input); // input: CopilotInput, no taskContent
  }
}
```

**Effort:** M  
**Confidence:** Medium

---

## F-t4-cleanfn-7: `updateTask()` in sprint-queries.ts (100 lines, lines 355–455) performs validation, serialization, transaction management, and audit logging sequentially

**Severity:** Medium  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/main/data/sprint-queries.ts:355-455`  
**Evidence:**  
- Lines 356–357: Allowlist filtering (validation)
- Lines 363–447: Transaction with three sub-phases:
  - Lines 366–377: Fetch old state, validate status transition
  - Lines 383–418: Compute changed fields, serialize values, build audit patch
  - Lines 422–446: Execute UPDATE, record changes
- Lines 449–454: Error handling with structured logging
- The function's primary responsibility is "update a task and record changes," but it also owns:
  - State machine validation (status transitions)
  - Serialization/deserialization logic (depend_on → JSON string → depend_on array for audit)
  - Change detection (comparing serialized old vs new)
  - Audit logging (recordTaskChanges call within transaction)
- If status transition validation fails (line 374), the function logs and returns null, but the caller doesn't know if it's a state machine violation or a database error

**Impact:**
- **Clarity of Intent:** The "real" work (the UPDATE) is buried in a 100-line function with multiple error paths
- **Testing:** Unit test must mock the entire transaction, the serialize/deserialize flow, the change detection, AND the audit recording
- **Error Handling:** A state machine error is logged but indistinguishable from a null result due to a missing task

**Recommendation:**
Extract state machine validation into a pure function:
```typescript
function validateStatusTransition(current: string, proposed: string): { ok: boolean; reason?: string } {
  const result = validateTransition(current, proposed);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true };
}
```
Then refactor updateTask:
```typescript
export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const oldTask = getTask(id);
  if (!oldTask) return null;
  
  if (patch.status && typeof patch.status === 'string') {
    const validation = validateStatusTransition(oldTask.status, patch.status);
    if (!validation.ok) {
      logger.warn(`[sprint-queries] ${validation.reason} for task ${id}`);
      return null; // Now it's clear this is a state machine error
    }
  }
  
  const changedEntries = computeChanges(oldTask, patch);
  if (changedEntries.length === 0) return oldTask;
  
  return db.transaction(() => {
    const result = executeUpdate(id, changedEntries);
    if (!result) return null;
    recordTaskChanges(id, oldTask, changedEntries); // might throw; aborts txn
    return mapRowToTask(result);
  })();
}
```

**Effort:** S  
**Confidence:** Medium

---

## F-t4-cleanfn-8: `_processQueuedTask()` (89 lines) orchestrates dependency checking, repo resolution, worktree setup, and agent spawn in sequence with 6+ error paths

**Severity:** Medium  
**Category:** Function Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/index.ts:400-489`  
**Evidence:**  
- Lines 404–409: Task validation (null check from _mapQueuedTask)
- Lines 411–412: Dependency check with auto-blocking logic
- Lines 414–434: Repo path resolution with error state update
- Lines 436–440: Task claiming with early return
- Lines 445–452: Fresh dependency refresh (re-fetches all tasks)
- Lines 454–483: Worktree setup with error state update + cleanup
- Lines 485: Agent spawn (delegated to _spawnAgent)
- The function is structured as a checklist:
  1. Is the task valid? If not, skip.
  2. Are dependencies satisfied? If not, block.
  3. Is the repo configured? If not, error out.
  4. Can I claim the task? If not, skip.
  5. Let me refresh the dependency snapshot.
  6. Can I set up the worktree? If not, error out.
  7. Spawn the agent.
- Each error path is handled locally (log + updateTask + onTaskTerminal), but the pattern is repeated 3 times (lines 416–434, 465–481), violating DRY

**Impact:**
- **Readability:** The reader must track 7 sequential preconditions, making the function's intended flow opaque
- **Testing:** To unit-test one precondition, must mock all previous ones
- **Error Uniformity:** Some errors call `onTaskTerminal()` (repo error), others don't (claim failure), creating inconsistent error semantics

**Recommendation:**
Extract a `ChecklistRunner` or refactor as a validation pipeline:
```typescript
async _processQueuedTask(raw: Record<string, unknown>, statusMap: Map<string, string>): Promise<void> {
  const preconditions = [
    async () => ({ ok: true, task: this._mapQueuedTask(raw) }),
    async (task) => this._checkAndBlockDeps(task.id, ...) ? { ok: false } : { ok: true },
    async (task) => this.resolveRepoPath(task.repo) ? { ok: true, repoPath } : { ok: false, error: '...' },
    async (task) => this.claimTask(task.id) ? { ok: true } : { ok: false },
    async (task, repoPath) => { /* setup worktree */ },
  ];
  
  for (const precondition of preconditions) {
    const result = await precondition(...);
    if (!result.ok) {
      logger.warn(`Precondition failed: ${result.error}`);
      if (result.shouldTerminal) await onTaskTerminal(...);
      return;
    }
  }
  
  this._spawnAgent(...);
}
```

**Effort:** M  
**Confidence:** Medium

---

## Summary Table

| Finding | File | Lines | Severity | Type |
|---------|------|-------|----------|------|
| F-t4-cleanfn-1 | run-agent.ts | 738–789 | Critical | Monolithic orchestrator |
| F-t4-cleanfn-2 | completion.ts | 550–655 | Critical | Mixed responsibilities (task sequencing + mutation + state) |
| F-t4-cleanfn-3 | SprintPipeline.tsx | 38–484 | High | 14+ subscriptions, 20+ callbacks, multiple concerns |
| F-t4-cleanfn-4 | agent-manager/index.ts | 512–604 | High | Drain loop conflates 3 independent phases |
| F-t4-cleanfn-5 | run-agent.ts | 364–446 | High | Validation + mutation + cleanup + assembly |
| F-t4-cleanfn-6 | prompt-composer.ts | 650–682 | Medium | Discriminated union type safety issue |
| F-t4-cleanfn-7 | sprint-queries.ts | 355–455 | Medium | Multiple responsibilities in update transaction |
| F-t4-cleanfn-8 | agent-manager/index.ts | 400–489 | Medium | Checklist-style orchestration with repetitive error handling |

## Recommendations by Priority

1. **Critical — Refactor `runAgent()` phase isolation** (F-t4-cleanfn-1): Extract phase runners to make testing and error recovery possible.
2. **Critical — Decompose `resolveSuccess()` workflow** (F-t4-cleanfn-2): Split into orchestrators (prep) + classifiers (analyze) + executors (apply).
3. **High — Extract `SprintPipeline` sub-components** (F-t4-cleanfn-3): Move layout, selection, and overlay logic into separate components with focused responsibilities.
4. **High — Refactor `_drainLoop()` phases** (F-t4-cleanfn-4): Separate dependency refresh, precondition checks, and task claiming into testable units.


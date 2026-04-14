# Single Responsibility Principle Audit — Team 2 Clean Code
**Audit Date:** 2026-04-14

## Overall Health Summary

The codebase exhibits mixed SRP compliance. While many modules (especially services and utilities) are narrowly scoped, several files bundle 3–4 unrelated concerns into a single unit. The most problematic areas are: (1) **completion.ts**, which orchestrates validation, commit detection, rebase, auto-merge, and transition logic; (2) **useSingleTaskReviewActions**, which owns UI state, confirmation modal state, freshness polling, and 6 distinct review actions; (3) **useReviewPartnerActions**, which manages message persistence to localStorage, WebSocket streaming, store mutations, and subscription lifecycle; and (4) **sprint-local.ts**, which handles 11 different handler registrations across task CRUD, validation, workflow instantiation, and logging. The hook layer shows a pattern of action-aggregation hooks that bundle state management with IPC orchestration.

---

## F-t2-srp-1: completion.ts Lacks Clear Phase Separation

**Severity:** High  
**Category:** Single Responsibility  
**Location:** `src/main/agent-manager/completion.ts:98–420`  
**Evidence:**  
The `resolveSuccess()` function (line 401) chains together 5 sequential concerns: (1) worktree existence verification, (2) branch detection, (3) auto-commit, (4) rebase orchestration, (5) commit presence checking, and (6) task state transition + auto-merge. Each sub-step is a separate operation with its own error handling and guard clauses. Example:
```typescript
const worktreeExists = await verifyWorktreeExists(taskId, worktreePath, repo, logger, onTaskTerminal)
if (!worktreeExists) return
const branch = await detectAgentBranch(taskId, worktreePath, repo, logger, onTaskTerminal)
if (!branch) return
await autoCommitPendingChanges(...)
const rebaseOutcome = await rebaseOnMain(...)
const hasCommits = await verifyCommitsExist(...)
if (!hasCommits) return
await transitionTaskToReview(...)
```
These are distinct phases with orthogonal reasons to change: (a) worktree lifecycle rules, (b) commit validation logic, (c) git rebase policy, (d) auto-merge rules, (e) task status transitions. Currently, all live in one 20-line orchestrator.

**Impact:**  
Adding a new phase (e.g., "lint the code before rebase") requires modifying `resolveSuccess`. Testing individual phases in isolation is difficult because the function is a chained pipeline with early exits. If rebase policy changes, it's not obvious that `resolveSuccess` is affected.

**Recommendation:**  
Extract each phase into a separate, well-named function that returns a clear result type. Example:
```typescript
interface ResolveSuccessPhase1Result { worktreePath: string }
interface ResolveSuccessPhase2Result { branch: string }
```
Each phase owns its own guards and error handling. Then compose them in `resolveSuccess` as a thin orchestrator that calls each phase in sequence.

**Effort:** M  
**Confidence:** High  

---

## F-t2-srp-2: useSingleTaskReviewActions Owns State + Polling + 6 Actions + Modals

**Severity:** High  
**Category:** Single Responsibility  
**Location:** `src/renderer/src/hooks/useSingleTaskReviewActions.ts:41–257`  
**Evidence:**  
This hook owns: (1) component-level state (`mergeStrategy`, `actionInFlight`, `freshness`), (2) confirmation modal state via `useConfirm()`, (3) prompt modal state via `useTextareaPrompt()`, (4) freshness polling via `useEffect`, (5) 6 distinct action implementations (`shipIt`, `mergeLocally`, `createPr`, `requestRevision`, `rebase`, `discard`), and (6) next-task navigation logic (`getNextReviewTaskId`). The hook is 250+ lines with overlapping state mutations and multiple conditional branches per action.

Example: the `shipIt` action (line 66) not only executes a merge—it also manages `actionInFlight` state, confirms with the user, calls `setFreshness` indirectly, updates the store, navigates to the next task, reloads data, and shows toasts. That's 6 different concerns in one function.

**Impact:**  
- **Testability:** Testing `shipIt` in isolation requires mocking 8+ dependencies and setting up the full hook state.
- **Reusability:** `getNextReviewTaskId` cannot be reused without importing the whole hook.
- **Maintenance:** Changing the confirm dialog style or adding a new review action requires editing a 250-line file.
- **Cognitive load:** Developers must understand the interaction between `actionInFlight`, `mergeStrategy`, and `freshness` state to safely add a feature.

**Recommendation:**  
Split into smaller hooks:
1. `useReviewActionState()` — owns `mergeStrategy`, `actionInFlight`, `freshness` state.
2. `useReviewActionModals()` — owns `useConfirm()` and `useTextareaPrompt()`.
3. `useShipItAction()`, `useMergeLocallyAction()`, etc. — each owns one action with its side effects.
4. `useReviewTaskNavigation()` — owns the `getNextReviewTaskId` logic and task selection.
5. `useReviewFreshness()` — owns the polling effect.

Then compose them back together in a higher-level hook if needed.

**Effort:** L  
**Confidence:** High  

---

## F-t2-srp-3: useBatchReviewActions Repeats Action Boilerplate with No Abstraction

**Severity:** Medium  
**Category:** Single Responsibility  
**Location:** `src/renderer/src/hooks/useBatchReviewActions.ts:14–137`  
**Evidence:**  
The hook implements 4 nearly-identical functions: `batchMergeLocally`, `batchShipIt`, `batchCreatePr`, `batchDiscard`. Each function:
1. Loops over tasks
2. Calls a `window.api.review.*` method
3. Counts successes and failures
4. Clears the batch
5. Reloads data
6. Shows a toast with the counts

The loop-count-toast pattern is duplicated 4 times with only the API method changing. Additionally, the hook mixes two concerns: (a) batch operation logic (looping, counting) and (b) action-specific retry/error handling.

**Impact:**  
- Adding a 5th batch action requires copying and pasting ~20 lines of boilerplate.
- A bug in the counting logic or toast formatting must be fixed 4 places.
- Hard to reuse the counting/reporting pattern elsewhere.

**Recommendation:**  
Extract a generic batch action executor:
```typescript
async function executeBatchAction<T>(
  tasks: T[],
  operation: (task: T) => Promise<{ success: boolean }>
): Promise<{ succeeded: number; failed: number }>
```
Then define each action as a simple task mapper:
```typescript
const batchMergeLocally = (tasks) => executeBatchAction(tasks, t => window.api.review.mergeLocally(...))
```

**Effort:** S  
**Confidence:** High  

---

## F-t2-srp-4: completion.ts + resolveFailure Mix Task State Mutation with Retry Logic

**Severity:** Medium  
**Category:** Single Responsibility  
**Location:** `src/main/agent-manager/completion.ts:422–472`  
**Evidence:**  
The `resolveFailure()` function (line 422) owns two distinct concerns: (1) **failure classification** (line 426: `classifyFailureReason(notes)`), and (2) **retry policy** (exponential backoff calculation, terminal status determination). It then mutates task state based on retry policy. Three different reasons-to-change are bundled here:
- Classification rules change → update `classifyFailureReason()`
- Backoff strategy changes (e.g., capped exponential → linear) → modify lines 443
- Terminal retry limit changes → modify line 429

**Impact:**  
- Changing how failures are classified doesn't warrant a release, but touching this file risks breaking retry logic.
- Retry policy cannot be tested independently of failure classification.
- If a new failure reason needs special retry handling (e.g., "network timeout" retries instantly), the function must grow more conditional logic.

**Recommendation:**  
Extract two modules:
1. `failure-classifier.ts` — owns `classifyFailureReason()` (already exists but not used here in isolation)
2. `retry-policy.ts` — owns `calculateRetryBackoff()` and `isTerminal()` logic
Then `resolveFailure()` becomes: classify → apply policy → mutate task.

**Effort:** S  
**Confidence:** High  

---

## F-t2-srp-5: useReviewPartnerActions Owns Message Persistence + Streaming + Store Mutations

**Severity:** High  
**Category:** Single Responsibility  
**Location:** `src/renderer/src/hooks/useReviewPartnerActions.ts:9–210`  
**Evidence:**  
The hook owns three distinct concerns:
1. **localStorage persistence** (lines 9–29: `saveMessages()` function manages LRU eviction, max message caps, and JSON serialization)
2. **Chat streaming and subscription management** (lines 87–173: manages `onChatChunk` subscriptions, unsubscribe cleanup, stream IDs)
3. **Store mutations** (lines 46–85, 87–173: calls `useReviewPartnerStore.setState()` to update `reviewByTask`, `messagesByTask`, `activeStreamByTask`)

The `sendMessage()` function (line 87) alone is 87 lines and does: validate state → add UI message → subscribe to chunks → handle chunk updates → persist to localStorage → unsubscribe on done. That's a pipeline with 5+ stages.

**Impact:**  
- Changing localStorage structure requires understanding the chunk streaming logic.
- Testing message persistence logic requires mocking the entire IPC streaming infrastructure.
- Cannot reuse `saveMessages()` for a different chat feature (e.g., conversation history export).
- Adding a new metadata field to messages requires touching 4 different setState call sites.

**Recommendation:**  
Split into 3 modules:
1. `ReviewPartnerMessageStorage` — owns `saveMessages()`, LRU logic, localStorage contract.
2. `ReviewPartnerChatStream` — owns subscription lifecycle, chunk accumulation, stream ID tracking.
3. `useReviewPartnerActions()` — orchestrates storage + streaming, calls store mutations.

**Effort:** M  
**Confidence:** High  

---

## F-t2-srp-6: sprint-local.ts Registers 11 Handlers Across 4 Domains

**Severity:** High  
**Category:** Single Responsibility  
**Location:** `src/main/handlers/sprint-local.ts:50–205`  
**Evidence:**  
The file registers IPC handlers for: (1) task CRUD (`sprint:create`, `sprint:update`, `sprint:delete`, `sprint:claimTask`), (2) task workflows (`sprint:createWorkflow`, `sprint:instantiateWorkflow`), (3) validation (`sprint:validateDependencies`, `sprint:unblockTask`), (4) data inspection (`sprint:readLog`, `sprint:readSpecFile`, `sprint:getChanges`, `sprint:failureBreakdown`), (5) execution utilities (`sprint:generatePrompt`, `sprint:healthCheck`). Each handler calls a different service function.

The file reads like a dispatcher table with no unifying pattern. For example:
- Task creation (line 56) validates, creates, and notifies via `createTask()`
- Workflow creation (line 71) instantiates, logs errors, returns results
- Health checks (line 148) flag stuck tasks and return results
- Log reading (line 157) has its own validation and byte-offset logic

**Impact:**  
- Adding a new handler requires understanding the pattern and dependencies (validation service, task service, workflow engine, etc.).
- Difficult to share common logic (e.g., "validate task, then act") across handlers because each handler imports a different service.
- Hard to test handlers in isolation because they reach into many services.

**Recommendation:**  
Organize handlers by domain and extract handler-specific sub-modules:
```
sprint-local.ts (dispatcher only)
├── sprint-local-crud.ts (create, update, delete, claim)
├── sprint-local-workflow.ts (createWorkflow)
├── sprint-local-validation.ts (validateDependencies, unblockTask)
└── sprint-local-inspection.ts (readLog, readSpecFile, getChanges)
```
Each sub-module exports a function that registers its handlers.

**Effort:** M  
**Confidence:** High  

---

## F-t2-srp-7: useSingleTaskReviewActions Violates SRP in State Accessor Pattern

**Severity:** Medium  
**Category:** Single Responsibility  
**Location:** `src/renderer/src/hooks/useSingleTaskReviewActions.ts:41–56`  
**Evidence:**  
The hook extracts 13 individual fields from `useCodeReviewStore`, `useSprintTasks`, modal hooks, and `useGitHubStatus()`:
```typescript
const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
const selectTask = useCodeReviewStore((s) => s.selectTask)
const tasks = useSprintTasks((s) => s.tasks)
const loadData = useSprintTasks((s) => s.loadData)
const { confirm, confirmProps } = useConfirm()
const { prompt, promptProps } = useTextareaPrompt()
const { configured: ghConfigured } = useGitHubStatus()
```
The hook then derives the selected task via `tasks.find()` (line 46). This is a "relay" pattern: the hook exists mostly to extract and relay store state, not to provide a coherent abstraction. The confusion is evident: why would a caller use this hook instead of importing the stores directly? What does the hook guarantee?

**Impact:**  
- Unclear contract: is this hook a logical unit (e.g., "everything needed to review a task") or just a convenience aggregator?
- Hard to optimize re-renders because the hook creates new object references via `useEffect` (line 57).
- Mixes store selection with modal state, making it unclear which dependencies are stable.

**Recommendation:**  
Either: (a) make this a thin relay hook that only aggregates *related* state (e.g., "all state needed to review a single task"), with clear documentation, OR (b) split into focused hooks:
- `useReviewTaskSelection()` — return selectedTaskId, selectTask, tasks
- `useReviewUIModals()` — return confirmProps, promptProps
- Each caller imports what it needs.

**Effort:** S  
**Confidence:** Medium  

---

## F-t2-srp-8: dependency-service.ts Bundles Cycle Detection, Status Classification, and Block State Computation

**Severity:** Medium  
**Category:** Single Responsibility  
**Location:** `src/main/services/dependency-service.ts:144–307`  
**Evidence:**  
The file exports 6 functions with overlapping concerns:
- `detectCycle()` (line 144) — graph cycle detection
- `formatBlockedNote()` (line 177) — string formatting
- `stripBlockedNote()` (line 181) — string parsing
- `buildBlockedNotes()` (line 186) — note composition
- `checkTaskDependencies()` (line 197) — task-level block checking
- `checkEpicDependencies()` (line 222) — epic-level block checking
- `computeBlockState()` (line 277) — composites task + epic blocks

These functions span: graph algorithms, string utilities, status determination, and business logic composition. While each function is small, they represent 4 distinct domains bundled in one service file. Additionally, `checkTaskDependencies()` creates a temporary dependency index (line 206) instead of reusing the persistent `DependencyIndex` from context.

**Impact:**  
- String utilities (`formatBlockedNote`, `stripBlockedNote`) could be extracted to a shared utility module but are hidden here.
- Cycle detection logic is not readily discoverable because it's in a "dependency service" rather than a "graph" module.
- `computeBlockState()` calls two separate check functions instead of a unified block-state machine.

**Recommendation:**  
Reorganize as:
1. `dependency-index.ts` — the `DependencyIndex` interface and `createDependencyIndex()` (already there, no change)
2. `dependency-graph.ts` — `detectCycle()`
3. `blocked-notes.ts` — `formatBlockedNote()`, `stripBlockedNote()`, `buildBlockedNotes()`
4. `block-state.ts` — `checkTaskDependencies()`, `checkEpicDependencies()`, `computeBlockState()`

**Effort:** M  
**Confidence:** Medium  

---

## F-t2-srp-9: useSprintTaskActions Couples Task Mutations with UI Coordination + Confirm Modal

**Severity:** Medium  
**Category:** Single Responsibility  
**Location:** `src/renderer/src/hooks/useSprintTaskActions.ts:28–187`  
**Evidence:**  
The hook returns 8 actions and owns confirmation modal state. Each action mixes: (1) store mutation (e.g., `updateTask()`, `deleteTask()`), (2) UI coordination (e.g., `clearTaskIfSelected()`, `setSelectedTaskId()`), (3) async IPC calls (e.g., `window.api.agentManager.kill()`), and (4) user feedback (toasts). Example—`handleStop()`:
```typescript
const result = await window.api.agentManager.kill(task.id)
if (result.ok) {
  updateTask(task.id, { status: TASK_STATUS.CANCELLED })  // store mutation
  toast.success('Agent stopped')                           // feedback
} else {
  toast.error('Failed to stop agent')
}
```
The hook also manages task creation with background spec generation (lines 130–165), which introduces a third concern: long-running background jobs. The `createTask()` action calls `generateSpec()` asynchronously, tracks progress with `addGeneratingId()`, and shows a toast—all unrelated to the core task creation concern.

**Impact:**  
- Cannot reuse `handleStop` without also importing the entire store and notification system.
- Testing task creation requires understanding async spec generation lifecycle.
- Hard to add a new side effect (e.g., analytics tracking) without editing the action.

**Recommendation:**  
Split responsibilities:
1. `useTaskMutationActions()` — pure store mutation wrappers (`deleteTask`, `updateTask`)
2. `useTaskExecutionActions()` — IPC actions with result handling (`handleStop`, `handleRerun`, `handleRetry`)
3. `useTaskCreationWithSpec()` — task creation with background spec generation (side effect management)
4. Keep `confirmProps` in a separate `useConfirmationModal()` hook

**Effort:** M  
**Confidence:** High  

---

## F-t2-srp-10: completion.ts Delegates Differently Across resolveSuccess and resolveFailure

**Severity:** Low  
**Category:** Single Responsibility  
**Location:** `src/main/agent-manager/completion.ts:98–472`  
**Evidence:**  
The `resolveSuccess()` function (line 401) calls helper functions (`verifyWorktreeExists`, `detectAgentBranch`, etc.) for each sub-step, maintaining a clear delegation pattern. However, `resolveFailure()` (line 422) does NOT delegate—it inlines the retry backoff calculation and terminal status logic directly:
```typescript
const backoffMs = Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount))
const nextEligibleAt = new Date(Date.now() + backoffMs).toISOString()
```
This inconsistency suggests that `resolveFailure` and `resolveSuccess` were not designed together. The task transition logic (lines 454–463) is also duplicated across terminal and non-terminal paths.

**Impact:**  
- Inconsistent code patterns make the file harder to maintain.
- The retry backoff formula cannot be reused elsewhere (e.g., in tests, in a retry policy configuration).
- Changing backoff strategy requires hunting for all the places it's calculated.

**Recommendation:**  
Extract `calculateRetryBackoff()` as a standalone function (similar to how `rebaseOnMain()` is extracted). Apply the same delegation pattern in both `resolveSuccess()` and `resolveFailure()`.

**Effort:** S  
**Confidence:** Medium  

---

## Summary of Recommendations (Priority Order)

1. **High Priority:**
   - F-t2-srp-1: Break completion.ts into smaller phases
   - F-t2-srp-2: Split useSingleTaskReviewActions into focused hooks
   - F-t2-srp-5: Extract message storage and chat streaming from useReviewPartnerActions
   - F-t2-srp-6: Organize sprint-local.ts handlers by domain

2. **Medium Priority:**
   - F-t2-srp-3: Extract generic batch action executor
   - F-t2-srp-4: Create failure-classifier and retry-policy modules
   - F-t2-srp-8: Reorganize dependency-service into graph, notes, and block-state modules
   - F-t2-srp-9: Split useSprintTaskActions into mutation, execution, and creation hooks

3. **Low Priority:**
   - F-t2-srp-7: Clarify useSingleTaskReviewActions contract or split into relay hooks
   - F-t2-srp-10: Extract and reuse retry backoff calculation

---

## Files Not Flagged (Positive SRP Examples)

- **prompt-composer.ts** — thin dispatcher, each builder is independently testable
- **run-agent.ts** — clear phase separation (validate → spawn → consume → finalize)
- **useSprintPolling.ts** — single concern: adaptive polling frequency
- **useAutoReview.ts** — single concern: debounced auto-review trigger
- **useTaskFormState.ts** — single concern: form field aggregation and validation
- **useDashboardPolling.ts** — single concern: dashboard data polling
- **auto-review-service.ts** — single concern: auto-merge eligibility checking (not mixed with execution)


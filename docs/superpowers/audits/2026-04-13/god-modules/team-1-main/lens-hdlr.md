# Handler Registry & IPC Handler God Modules Audit
**Date:** 2026-04-13  
**Scope:** src/main/handlers/ + src/main/index.ts (registration entry point)  
**Focus:** Business logic embedded in handlers, mixed responsibilities, excessive handler length, God registrar patterns

---

## F-t1-hdlr-1: workbench:checkOperational — Orchestration Overload in Single Handler
**Severity:** High  
**Category:** Business Logic in Handler, Mixed Responsibilities  
**Location:** `src/main/handlers/workbench.ts:87–231`

**Evidence:**  
The `workbench:checkOperational` handler (145 lines) performs 5 independent operational checks inline:
1. **Auth validation** (checkAuthStatus + conditional logic for token expiry)
2. **Repo path resolution** (case-insensitive lookup + error messaging)
3. **Git status check** (execFileAsync to git status, parse output, interpret)
4. **Task conflict detection** (query listTasks, filter by repo & status, count)
5. **Agent slot availability** (query agent manager state, calculate availability)

Each check should be a separate service function, but instead they are orchestrated as inline conditional blocks with duplicated error handling.

**Impact:**  
- **Maintainability:** Tight coupling to auth-guard, git utilities, sprint-service, agent-manager within one handler. Changes to any check's logic require editing this handler.
- **Testability:** Cannot unit test individual check logic; must mock entire Electron event + IPC layer.
- **Reuse:** Auth check, task conflict check, slot availability — all duplicated patterns across the codebase (e.g., `checkAuthStatus` also used in review.ts). Handler doesn't expose composable pieces.

**Recommendation:**  
Extract to `src/main/services/workbench-checks-service.ts`:
```typescript
// Each check becomes a pure function returning { status, message, ... }
export function checkAuthStatus(): AuthCheckResult
export function checkRepoPath(repo: string): RepoCheckResult
export function checkGitClean(repoPath: string): Promise<GitCheckResult>
export function checkTaskConflicts(repo: string): TaskConflictCheckResult
export function checkAgentSlots(am?: AgentManager): SlotsCheckResult

// Handler becomes a thin orchestrator
safeHandle('workbench:checkOperational', async (_e, { repo }) => {
  return {
    auth: checkAuthStatus(),
    repoPath: checkRepoPath(repo),
    gitClean: await checkGitClean(getRepoPath(repo)),
    noConflict: checkTaskConflicts(repo),
    slotsAvailable: checkAgentSlots(am)
  }
})
```
**Effort:** M  
**Confidence:** High

---

## F-t1-hdlr-2: review:checkAutoReview — Rule Engine Logic Embedded in Handler
**Severity:** High  
**Category:** Business Logic in Handler  
**Location:** `src/main/handlers/review.ts:238–320`

**Evidence:**  
The handler inlines git diff parsing and rule evaluation:
- Executes `git diff --numstat`, parses raw output into file summaries (lines 275–301)
- Loads auto-review rules from settings, applies conditional logic (lines 252–305)
- Calls separate `evaluateAutoReviewRules` service but orchestrates data transformation within the handler

The numstat parsing logic (split by tab, handle '-' for binary files, extract path) is not in a shared utility — it's duplicated in this handler AND in review-merge-service.ts (`parseNumstat`).

**Impact:**  
- **Duplication:** Same git diff parsing appears in review.ts (lines 275–301) AND review-merge-service.ts (`parseNumstat` lines 18). Future changes to numstat format require coordinating edits across files.
- **Testability:** Cannot test rule-evaluation logic without git worktree + mocked settings.
- **Maintainability:** Rule evaluation mixed with git I/O and data transformation; hard to reason about the core logic.

**Recommendation:**  
Extract to `src/main/services/auto-review-service.ts`:
```typescript
export async function checkAutoReviewRules(
  taskId: string,
  worktreePath: string,
  env: NodeJS.ProcessEnv
): Promise<{ shouldAutoMerge: boolean; shouldAutoApprove: boolean; matchedRule: string | null }>

// Handler becomes:
safeHandle('review:checkAutoReview', async (_e, { taskId }) => {
  const task = getTask(taskId)
  if (!task?.worktree_path) return { shouldAutoMerge: false, shouldAutoApprove: false, matchedRule: null }
  return checkAutoReviewRules(taskId, task.worktree_path, env)
})
```
**Effort:** M  
**Confidence:** High

---

## F-t1-hdlr-3: review.ts — Multiple Validation Utilities Localized to Handler File
**Severity:** Medium  
**Category:** Mixed Responsibilities, Validation Logic in Handler  
**Location:** `src/main/handlers/review.ts:34–103`

**Evidence:**  
Review handlers define and use three validation utilities inline:
- `getRepoConfig()` (lines 34–38) — settings lookup
- `validateGitRef()` (lines 49–53) — regex validation
- `validateWorktreePath()` (lines 72–83) — path containment check
- `validateFilePath()` (lines 92–102) — path traversal prevention
- `getWorktreeBase()` (lines 59–63) — config resolution

These are handler-local utilities but represent core security/validation concerns used by multiple handlers (`review:getDiff`, `review:getCommits`, `review:getFileDiff`, `review:checkFreshness`).

**Impact:**  
- **Reuse:** Other handlers (e.g., agent-handlers, workbench) also need to validate git refs and worktree paths but cannot access these utilities.
- **Consistency:** If a new handler needs to validate a git ref, the developer might duplicate the pattern instead of finding a shared location.
- **Maintenance:** Future updates to path validation logic (e.g., symlink handling like in ide-fs-handlers) won't propagate to review handlers.

**Recommendation:**  
Move to `src/main/validation/review-paths.ts`:
```typescript
export interface RepoConfig { ... }
export function getRepoConfig(repoName: string): RepoConfig | null
export function validateGitRef(ref: string): void
export function validateWorktreePath(path: string): void
export function validateFilePath(path: string): void
export function getWorktreeBase(): string
```
Import and reuse in review.ts, agent-handlers.ts, and future handlers.

**Effort:** S  
**Confidence:** High

---

## F-t1-hdlr-4: workbench:chatStream — Prompt Building and Streaming State Management in Handler
**Severity:** Medium  
**Category:** Mixed Responsibilities, Stream Orchestration  
**Location:** `src/main/handlers/workbench.ts:252–330`

**Evidence:**  
Handler manages:
1. **Repo validation** (getRepoPath lookup, fail-fast message to renderer)
2. **Prompt construction** (buildChatPrompt with form context and repo path)
3. **Stream lifecycle** (runSdkStreaming call, error handling, chunk batching via try-catch over e.sender.send)
4. **Tool restrictions** (getCopilotSdkOptions to filter to Read/Grep/Glob)
5. **Chunk routing** (e.sender.send for chunks, toolUse events, completion/error frames)

While review-assistant.ts extracted `handleChatStream` as a pure function, workbench.ts inlines all of this. The only structured piece is the stream ID generation (`copilot-${Date.now()}`), but no abstraction layer over the prompt/options/stream pattern.

**Impact:**  
- **Consistency:** Two similar streaming handlers (workbench:chatStream and review:chatStream in review-assistant.ts) have different internal structures. The review version is testable (pure function); workbench is not.
- **Error handling:** try-catch blocks wrap e.sender.send calls — if the window closes, errors are silently caught. Same pattern appears in both, suggesting shared error handling logic.
- **Tool restrictions:** getCopilotSdkOptions logic is buried in handler; hard to reuse or test tool permission policy changes.

**Recommendation:**  
Extract to `src/main/handlers/workbench-chat-service.ts` to mirror review-assistant.ts:
```typescript
export function buildWorkbenchChatDeps(...): ChatStreamDeps

export async function handleWorkbenchChatStream(
  deps: ChatStreamDeps,
  input: { formContext: ...; messages: ... },
  sender: WebContents | null
): Promise<{ streamId: string }>

// Handler:
safeHandle('workbench:chatStream', async (e, input) => {
  return handleWorkbenchChatStream(chatDeps, input, e.sender)
})
```
**Effort:** M  
**Confidence:** Medium

---

## F-t1-hdlr-5: sprint-local.ts — Task State Transition Logic Mixed in Handler Calls
**Severity:** Medium  
**Category:** Business Logic in Handler, State Machine Concerns  
**Location:** `src/main/handlers/sprint-local.ts:87–109`

**Evidence:**  
The `sprint:update` handler contains state transition orchestration:
- Validates patch fields via UPDATE_ALLOWLIST (line 89)
- Routes `status === 'queued'` to `prepareQueueTransition()` (lines 96–98)
- Calls `updateTask()` (line 104)
- Fires terminal callback for terminal statuses (lines 105–106)

This mirrors logic in sprint-batch-handlers.ts:registerSprintBatchHandlers (lines 59–91), where spec validation is duplicated:
```typescript
if (filtered.status === 'queued') {
  // validate spec quality
  const specText = (filtered.spec as string) ?? task.spec ?? null
  await validateTaskSpec({ title: task.title, repo: task.repo, spec: specText, context: 'queue' })
}
```

The pattern is: validate → patch → notify terminal. But each handler has slightly different logic (batch handler validates spec; sprint:update does not).

**Impact:**  
- **Duplication:** Queuing logic (batch and single update) should be identical but diverges slightly. Maintenance risk if either changes.
- **Testability:** Cannot test state transition rules in isolation; must set up full task, patch, and IPC mocks.
- **Clarity:** Unclear which handler is the "source of truth" for update semantics.

**Recommendation:**  
Create `src/main/services/task-update-orchestrator.ts`:
```typescript
export async function orchestrateTaskUpdate(
  taskId: string,
  patch: Record<string, unknown>,
  options: { validateSpec?: boolean; onTerminal?: (status: string) => void }
): Promise<UpdateResult>
  // Handles: patch validation, state transitions, spec validation, terminal notification
  // Called by both sprint-local and sprint-batch handlers

// Handlers become thin:
safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
  return orchestrateTaskUpdate(id, patch, {
    validateSpec: false,
    onTerminal: deps.onStatusTerminal
  })
})
```
**Effort:** M  
**Confidence:** Medium

---

## F-t1-hdlr-6: review.ts — Excessive Query and Parse Logic for Operational Checks
**Severity:** Medium  
**Category:** Business Logic in Handler, Query Orchestration  
**Location:** `src/main/handlers/review.ts:112–229`

**Evidence:**  
Query handlers (`review:getDiff`, `review:getCommits`, `review:getFileDiff`, `review:checkFreshness`) blend git operations with parsing:
- `review:getDiff` executes TWO git commands (numstat + full patch), then parses patch into a file map (lines 117–145)
- `review:getCommits` runs git log, then parses output into structured objects (lines 148–169)
- `review:checkFreshness` runs multiple git commands to fetch, check refs, count commits (lines 188–229)

Each handler is a query handler, but they perform non-trivial post-processing (e.g., patch parsing). This couples handler responsibility to data structure decisions.

**Impact:**  
- **Brittleness:** If the patch format changes or the file map structure needs to evolve, the handler must change. Service layer logic becomes part of the IPC boundary.
- **Reuse:** If another feature (e.g., a batch review tool) needs the same parsed diffs, it must either duplicate logic or call these handlers through IPC.

**Recommendation:**  
Move git operations + parsing to a dedicated service:
```typescript
// src/main/services/review-diff-service.ts
export interface ParsedDiff { files: Array<{ path: string; patch: string; ... }> }
export async function getDiffWithPatch(
  worktreePath: string,
  base: string,
  env: NodeJS.ProcessEnv
): Promise<ParsedDiff>

// Handler becomes:
safeHandle('review:getDiff', async (_e, { worktreePath, base }) => {
  validateGitRef(base)
  validateWorktreePath(worktreePath)
  return getDiffWithPatch(worktreePath, base, env)
})
```
**Effort:** M  
**Confidence:** Medium

---

## F-t1-hdlr-7: handler/registry.ts — Registration Does Not Validate Handler Contract
**Severity:** Low  
**Category:** God Registrar (Minor), Type Safety  
**Location:** `src/main/handlers/registry.ts:53–106`

**Evidence:**  
The `registerAllHandlers()` function unconditionally imports and calls all 20+ handler registration functions without validating:
1. **Dependency injection:** Handlers receive partial AppHandlerDeps; some are optional (agentManager, reviewService). No compile-time check that handlers use only their declared dependencies.
2. **Ordering:** No dependency ordering validation. If a handler registration relies on another handler being registered first (e.g., setting global state), it's not enforced.
3. **IPC channel mapping:** No static check that each `safeHandle(channel, ...)` corresponds to a declared channel in src/shared/ipc-channels/.

The registrar is not a "God module" in the sense of mixing business logic, but it is a high-touch point where adding a new handler type requires:
- Import the registration function
- Call it with the right dependencies
- Hope there are no ordering issues

**Impact:**  
- **Maintainability:** Low, since it's mostly a list of imports + calls. But adding new handlers requires manual coordination.
- **Type safety:** No verification that handlers match their IPC channel definitions.

**Recommendation:**  
Add a handler registry type system (low priority):
```typescript
interface HandlerRegistration {
  name: string
  register: (deps: AppHandlerDeps) => void
  requiredDeps: (keyof AppHandlerDeps)[]
}

const handlers: HandlerRegistration[] = [
  { name: 'agent', register: registerAgentHandlers, requiredDeps: ['repo'] },
  // ...
]

export function registerAllHandlers(deps: AppHandlerDeps): void {
  for (const { name, register, requiredDeps } of handlers) {
    const missing = requiredDeps.filter(k => !deps[k])
    if (missing.length > 0) {
      logger.warn(`Handler ${name} requires missing deps: ${missing.join(', ')}`)
    }
    register(deps)
  }
}
```
**Effort:** S  
**Confidence:** Low

---

## F-t1-hdlr-8: review.ts + review-assistant.ts — Duplicated Auto-Review Entry Point
**Severity:** Low  
**Category:** Mixed Responsibilities, Duplicate Concerns  
**Location:** `src/main/handlers/review.ts:238–320` vs. `src/main/handlers/review-assistant.ts:17–24`

**Evidence:**  
Two handlers handle auto-review:
1. **review.ts:checkAutoReview** — checks if a task matches auto-review rules (inline logic)
2. **review-assistant.ts:handleAutoReview** — calls `svc.reviewChanges(taskId, { force })` (service delegation)

The first is a "check if eligible" query; the second is "perform auto-review". But the naming suggests overlap, and the handler logic diverges (one parses settings, one calls service). A renderer calling both in sequence would hit two different code paths for "auto-review" concerns.

**Impact:**  
- **Clarity:** Unclear which handler to call for auto-review; requires reading both implementations.
- **Future maintenance:** If auto-review logic changes, it's unclear which handler should be updated.

**Recommendation:**  
Consolidate naming or clarify purpose:
- Rename `review:checkAutoReview` → `review:canAutoMerge` (query intent)
- Keep `review:autoReview` for the action (service call)
- Add a comment in both handlers clarifying the relationship.

**Effort:** S  
**Confidence:** Low

---

## Summary

| ID | Category | Severity | Effort | Status |
|---|----------|----------|--------|--------|
| F-t1-hdlr-1 | Orchestration Overload | High | M | Strong recommendation for extraction |
| F-t1-hdlr-2 | Business Logic in Handler | High | M | Strong recommendation for extraction |
| F-t1-hdlr-3 | Validation Utility Localization | Medium | S | Extract to shared validation module |
| F-t1-hdlr-4 | Stream Orchestration | Medium | M | Mirror review-assistant.ts pattern |
| F-t1-hdlr-5 | State Transition Logic | Medium | M | Consolidate update orchestration |
| F-t1-hdlr-6 | Query + Parse Logic | Medium | M | Move parsing to service layer |
| F-t1-hdlr-7 | Registrar Type Safety | Low | S | Optional enhancement |
| F-t1-hdlr-8 | Naming Clarity | Low | S | Documentation + naming improvement |

**Overall Assessment:**  
Handlers are mostly **thin wrappers** that validate input and delegate to services. However, **2 critical findings** (F-t1-hdlr-1, F-t1-hdlr-2) show substantial business logic embedded in handlers. The remaining issues are **refactoring opportunities** to reduce duplication and improve testability. The codebase does NOT have a "God registrar" problem — registry.ts is a straightforward orchestrator.

---


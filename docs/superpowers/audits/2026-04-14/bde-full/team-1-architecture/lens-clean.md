# Clean Code Audit — BDE Agent Manager & Frontend

**Executive Summary:** The codebase demonstrates strong architectural discipline with clear separation of concerns, but suffers from three primary clean code violations: (1) **resolution functions doing too much** (mixing classification, state mutation, and notification in single functions), (2) **multiple parameter objects that obscure intent** (verbose deps bags passed through 5+ function layers), (3) **repetitive cleanup/error handling code** scattered across unwind paths. The agent lifecycle is broken into logical phases, but phase boundaries leak concerns and create cognitive load. Frontend state management is well-isolated in stores but hydration logic is deeply nested with side-effect coupling. No single violation is catastrophic, but the cumulative friction when debugging or modifying completion/resolution flows is significant.

---

## F-t1-clean-1: resolveAgentExit Violates Single Responsibility
**Severity:** High
**Category:** Clean Code
**Location:** `src/main/agent-manager/run-agent.ts:545-612`
**Evidence:** Function does four distinct things: (1) classifies agent exit outcome via `classifyExit()`, (2) mutates task status in DB based on classification, (3) routes to either fast-fail handling, success resolution, or failure resolution, (4) manages async callbacks for terminal notification. Lines 559-611 contain three separate if/else branches with different mutation logic, all within the same function scope.
**Impact:** When debugging why a task transitioned to 'error' vs 'failed' vs 'queued', you must trace through this 67-line function. Changes to one branch risk breaking another. Adding new exit classifications (e.g., 'timeout-requeue') requires modifying this function plus the dependent resolution logic. Callers cannot easily test the exit classification in isolation from the DB mutation.
**Recommendation:** Extract a pure function `classifyAndDescribeExit(agent, task, exitCode)` → `{ action: 'fast-fail-exhausted' | 'fast-fail-requeue' | 'normal'; taskUpdate: Record<string, unknown> }`. Let `resolveAgentExit` focus solely on routing to the appropriate resolution handler. The classification logic, notes generation, and mutation specs live in a single testable function.
**Effort:** M
**Confidence:** High

---

## F-t1-clean-2: RunAgentDeps Parameter Bag Hides Intent
**Severity:** Medium
**Category:** Clean Code
**Location:** `src/main/agent-manager/run-agent.ts:43-70` (definition), used in `spawnAndWireAgent`, `handleSpawnFailure`, `validateTaskForRun`, `assembleRunContext`
**Evidence:** `RunAgentDeps = RunAgentSpawnDeps & RunAgentDataDeps & RunAgentEventDeps` composes three interfaces, totaling 7 parameters (activeAgents, defaultModel, logger, onTaskTerminal, onSpawnSuccess, onSpawnFailure, repo). Functions take the full bag but use only 2-3 fields. For example, `validateTaskForRun` needs only `{logger, repo, onTaskTerminal}`, but receives the entire union. Callers must mentally map which fields each function actually touches.
**Impact:** New code reading `spawnAndWireAgent(task, prompt, worktree, repoPath, effectiveModel, deps)` cannot quickly tell what `deps` contains. A reviewer adding a field to `RunAgentDataDeps` doesn't immediately see which functions will implicitly use it. The intersected interface type masks the real dependencies.
**Recommendation:** Use narrower, named interfaces at call sites. Instead of `spawnAndWireAgent(..., deps: RunAgentDeps)`, accept `spawnAndWireAgent(..., { activeAgents, defaultModel, logger, repo, onSpawnSuccess })`. This makes the dependency contract explicit at the call site. If code truly needs the full bag, name it `FullAgentDeps` and document why.
**Effort:** M
**Confidence:** High

---

## F-t1-clean-3: Repeated Cleanup/Error Handling Pattern
**Severity:** Medium
**Category:** Clean Code
**Location:** `src/main/agent-manager/run-agent.ts:232-244` (validateTaskForRun), lines 373-384 (handleSpawnFailure), lines 682-691 (finalizeAgentRun), and `src/main/agent-manager/completion.ts:249-256` (verifyWorktreeExists)
**Evidence:** Identical try/catch pattern for worktree cleanup appears 4+ times with copy-pasted error handling:
```typescript
try {
  await cleanupWorktree({ repoPath, worktreePath, branch, logger })
} catch (cleanupErr) {
  logger.warn(`[module] Stale worktree ... ${worktree.worktreePath} — manual cleanup needed: ${cleanupErr}`)
}
```
Each occurrence has slightly different context variable names (`cleanupErr`, `err instanceof Error ? err.stack ?? err.message : String(err)`) and message formatting, creating opportunities for inconsistency.
**Impact:** When you update the cleanup error message to be more actionable, you must find and update all 4 sites. If one site is missed, some error paths show stale guidance. New developers adding a worktree cleanup call likely copy the pattern, amplifying the duplication.
**Recommendation:** Extract a helper: `logCleanupWarning(taskId: string, worktreePath: string, err: unknown, logger: Logger)`. All cleanup failure paths call this function, ensuring consistent messaging and centralized logging policy.
**Effort:** S
**Confidence:** High

---

## F-t1-clean-4: consumeMessages Returns Overloaded Result Object
**Severity:** Medium
**Category:** Clean Code
**Location:** `src/main/agent-manager/run-agent.ts:73-78` (ConsumeMessagesResult definition), lines 153-206 (consumeMessages implementation)
**Evidence:** `ConsumeMessagesResult` has four fields: `exitCode`, `lastAgentOutput`, `streamError` (optional), and `pendingPlaygroundPaths` (array). The function returns different field combinations depending on the error path: (1) normal completion has all fields, (2) stream error path sets `streamError` but `lastAgentOutput` may be incomplete, (3) playground paths are accumulated even on error. Callers must check multiple fields and understand the invariants (e.g., "if streamError is set, exitCode is undefined").
**Impact:** In `finalizeAgentRun` (line 762), you see `exitCode, lastAgentOutput, streamError, pendingPlaygroundPaths` destructured, but the code never checks `streamError` — the comment explains the semantics instead (line 756-758). A reader must cross-reference documentation to understand which field combinations are valid.
**Recommendation:** Split into two results: `{ outcome: 'success' | 'stream-error'; exitCode?: number; lastAgentOutput: string; pendingPlaygroundPaths: string[] } | { outcome: 'stream-error'; error: Error; lastAgentOutput: string; pendingPlaygroundPaths: string[] }`. Callers use `if (result.outcome === 'stream-error')` instead of checking `streamError?.message`.
**Effort:** M
**Confidence:** Medium

---

## F-t1-clean-5: resolveSuccess/resolveFailure Bifurcated but Share Logic
**Severity:** Medium
**Category:** Clean Code
**Location:** `src/main/agent-manager/completion.ts:392-411` (resolveSuccess), lines 413-463 (resolveFailure)
**Evidence:** Two exported functions handle the post-agent-completion decision. `resolveSuccess` orchestrates a sequence of guards and updates (verify worktree, detect branch, commit, rebase, verify commits, transition to review). `resolveFailure` is simpler but also mutates task state and returns a boolean to indicate terminal vs. retry. They are called from the same parent function (`resolveAgentExit`) but take different parameter shapes and have different semantics. `resolveSuccess` returns `Promise<void>` (fire-and-forget mutation), while `resolveFailure` returns `boolean` (queries whether the retry budget is exhausted). The caller must understand both signatures to know when to fire `onTaskTerminal`.
**Impact:** New code paths (e.g., handling a specific failure case) require deciding: do I call `resolveSuccess`, `resolveFailure`, or introduce a third function? There's no clear contract. If you want to add a post-success hook, you must edit `resolveSuccess` directly, which conflates success orchestration with your new hook.
**Recommendation:** Create a single `resolveCompletion(task, exitCode, lastOutput, ...)` function that encapsulates the entire post-run decision tree. It returns `{ terminal: boolean; finalStatus: 'done' | 'review' | 'failed' | 'error'; notes?: string }`. Both success and failure paths are cases in this function. The caller doesn't need to understand two separate functions.
**Effort:** L
**Confidence:** High

---

## F-t1-clean-6: Nested Loops in sprintTasks Store Hydration
**Severity:** Low–Medium
**Category:** Clean Code
**Location:** `src/renderer/src/stores/sprintTasks.ts:93-143` (loadData method)
**Evidence:** The `loadData` function has 5 levels of nesting:
1. `set((state) => {` (Zustand updater)
2. `const now = Date.now()` (start local mutations)
3. Loop over `nextPendingMap` to expire old updates (3 lines)
4. Build `currentTaskMap` via `new Map(state.tasks.map(...))`
5. Loop `for (const task of incoming)` → check pending → merge or use server data
6. Nested ternary: `pending ? (localTask && now - pending.ts <= ... ? merge : use server) : use server`

The cognitive load to understand the merge logic requires holding multiple variables in mind: `incoming`, `currentFingerprint`, `nextPending`, `currentTaskMap`, `mergedById`, `tempId`.
**Impact:** When debugging a UI state issue where the wrong version of a task is shown, tracing through this function is tedious. If you want to add a new merge rule (e.g., "also preserve local `notes` field"), you must understand the entire merge strategy and the expiry TTL interaction.
**Recommendation:** Extract helper functions: `expirePendingUpdates(pendingUpdates, ttl, now)` and `mergeTaskWithPending(task, pending, local, now, ttl)`. The main loop becomes: `for (const task of incoming) { merged.set(task.id, mergeTaskWithPending(...)) }`. Side effect: better testability of the merge logic in isolation.
**Effort:** M
**Confidence:** Medium

---

## F-t1-clean-7: Magic String 'epic:' Prefix Violates DRY
**Severity:** Low
**Category:** Clean Code
**Location:** `src/main/services/dependency-service.ts:177-190` (formatBlockedNote, stripBlockedNote, buildBlockedNotes functions)
**Evidence:** The string `'[auto-block] '` is defined as `BLOCK_PREFIX` constant (line 175), but the epic-level blocking prefix `'epic:'` is hardcoded in `computeBlockState` (line 301, not shown but referenced in comments). Different modules use different prefixes with no central registry. If you want to add a new blocking type (e.g., 'cycle-block'), you must grep for all hardcoded prefix strings.
**Impact:** Brittle: if code strips `[auto-block] ` but later adds a new prefix, the old prefix-stripping logic is orphaned. A new developer won't know to add it. Inconsistent: some prefixes are defined as constants, others are inlined.
**Recommendation:** Export a `BlockReasons` enum or constant map: `{ autoBlock: '[auto-block] ', epic: 'epic:', cycle: 'cycle: ' }`. Use these constants everywhere. Update `stripBlockedNote` to strip all known prefixes, or make it prefix-agnostic.
**Effort:** S
**Confidence:** High

---

## F-t1-clean-8: CodeReviewView Command Registration Uses Duplicate Filters
**Severity:** Low
**Category:** Clean Code
**Location:** `src/renderer/src/views/CodeReviewView.tsx:31-95`
**Evidence:** Two command objects (`review-next` and `review-prev`) both perform the same filtering and sorting: `tasks.filter((t) => t.status === 'review').sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())`. The filter and sort are identical; only the navigation logic (`currentIndex + 1` vs. `currentIndex - 1`) differs. This is 30+ lines of duplication.
**Impact:** If the filter criteria change (e.g., "only include review tasks from my repo"), you must update both commands. If the sort order changes, same story. Hard to maintain a single source of truth.
**Recommendation:** Extract `getReviewTasks(tasks)` that returns the sorted/filtered list. Both command actions call this, then navigate. If you later add a third command (e.g., 'review-jump-to'), it automatically uses the same filter/sort.
**Effort:** S
**Confidence:** High

---

## F-t1-clean-9: classifyFailureReason Registry Pattern Not Extensible
**Severity:** Low
**Category:** Clean Code
**Location:** `src/main/agent-manager/failure-classifier.ts:5-36`
**Evidence:** Failure patterns are registered via imperative calls to `registerFailurePattern()` (lines 11-30). The registry is a module-level array (`failurePatternRegistry`). If external code wants to add a new pattern (e.g., custom domain-specific failure), it must import and call `registerFailurePattern()`. The function `classifyFailureReason()` iterates the array on every call, so the cost is O(n) and grows with more patterns. No way to bulk-register or disable patterns.
**Impact:** Not a major issue, but the imperative registration pattern is a code smell. If a test wants to isolate failure classification from the global registry, it cannot. If you want to add conditional patterns (e.g., "only classify 'OOM' if running on Linux"), the current structure doesn't support it.
**Recommendation:** Minor refactor: export `getFailurePatternRegistry()` to allow tests to mock it. Consider a declarative approach if more flexibility is needed, but current implementation is acceptable.
**Effort:** S
**Confidence:** Low

---

## F-t1-clean-10: Terminal Handler Callback Coupling
**Severity:** Low
**Category:** Clean Code
**Location:** `src/main/agent-manager/terminal-handler.ts:68-104`
**Evidence:** `executeTerminal` and `handleTaskTerminal` are split, but the interface requires callers to pass `onTaskTerminal` as a parameter to every function. This callback is used for dependency resolution AND for optional config hook (`config.onStatusTerminal`). The logic is: if `config.onStatusTerminal` is set, use it (side effect config path); otherwise, call `resolveTerminalDependents()` with the callback. This is a strategy pattern but the strategy is buried in conditional logic rather than made explicit.
**Impact:** Low, because the code is small and the intent is clear with comments. But it couples the terminal resolution logic to the callback dispatch, making it hard to test one without the other.
**Recommendation:** This is acceptable as-is, but could be slightly cleaner: extract `getTerminalStrategy(config)` that returns either `configHook` or `resolveDependentsStrategy`, then call the strategy. Minimal gain, so low priority.
**Effort:** S
**Confidence:** Low

---

## Summary

The agent-manager and completion flow are architecturally sound, but suffer from **high-friction operational complexity**:

1. **Most impactful:** Bifurcated resolve (success/failure) and overloaded result objects (`ConsumeMessagesResult`, `resolveAgentExit` doing 4 things).
2. **Friction points:** Parameter bags hiding intent, duplicated cleanup/error patterns, nested merge logic.
3. **Maintainability:** No central definition of failure reason prefixes, duplicate filter/sort logic in views.

Recommend prioritizing **F-t1-clean-1** (resolveAgentExit refactor) and **F-t1-clean-2** (RunAgentDeps clarification) as these appear frequently in debugging sessions. **F-t1-clean-3** (cleanup helper) is quick-win impact on consistency.


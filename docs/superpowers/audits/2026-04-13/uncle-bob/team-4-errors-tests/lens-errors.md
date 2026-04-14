# Clean Code Error Handling Audit — Team 4 (Errors & Tests)
**Date:** 2026-04-13  
**Auditor:** Claude Code  
**Focus:** Uncle Bob's Clean Code Chapter 7 principles — error handling

---

## F-t4-errors-1: Silent Catch Block Swallows Git Diagnostics
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/completion.ts:191-193`  
**Evidence:**
```typescript
} catch {
  // If rev-list fails, assume commits exist and continue
}
```
**Impact:** When `git rev-list` fails (e.g., due to permission errors, corrupted repo, network issues), the exception is silently swallowed with a misleading comment. The caller returns `true` (assuming commits exist) when the actual git error signal is lost. Downstream logic gates on this boolean, so a genuine failure becomes a false positive that cascades through the completion flow.

**Recommendation:** Either (1) propagate the error with context, (2) log it with task ID + error details, or (3) return a Result type `{ ok: boolean; error?: string }` so callers can decide handling. Never return a business-logic boolean that conceals error state.

**Effort:** S  
**Confidence:** High

---

## F-t4-errors-2: Bare Catch Block Without Error Context in Critical Path
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/run-agent.ts:650, 661`  
**Evidence:**
```typescript
try {
  prompt = await validateAndPreparePrompt(task, worktree, repoPath, deps)
} catch {
  return // Early exit — validation failed and cleaned up
}

try {
  const result = await spawnAndWireAgent(...)
} catch {
  return // Early exit — spawn failed and cleaned up
}
```
**Impact:** Two critical agent lifecycle phases catch and return silently. The comments claim "cleaned up" but provide no evidence of cleanup — no logged error, no error emission, no context about which validation/spawn step failed. If a developer adds cleanup logic later, they won't know where to add it. Callers of `runAgent()` get no indication of why it failed.

**Recommendation:** All three statements inside these catch blocks are already in the function body — use them. Log the error with task ID + reason before returning. Example: `catch (err) { logError(logger, '[run-agent] validation failed', err); return }`.

**Effort:** S  
**Confidence:** High

---

## F-t4-errors-3: Fire-and-Forget Promise Chain with Swallowed Rejection
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/run-agent.ts:464-466`  
**Evidence:**
```typescript
createAgentRecord({
  // ... fields ...
}).catch((err) =>
  logger.warn(`[agent-manager] Failed to create agent record for ${agentRunId}: ${err}`)
)
```
**Impact:** A critical operation (persisting agent metadata to SQLite) fails silently. The `.catch()` logs a warning but does not re-throw, and the caller has no way to know the DB write failed. If downstream code reads this agent record (status queries, cost tracking), it retrieves stale or missing data. The agent runs but its metadata is lost.

**Recommendation:** Decide: (1) Is this operation critical? If yes, throw or await + try/catch so the caller can handle failure. (2) If non-critical, wrap in a separate async task with explicit error boundary and logging that includes stack trace + surrounding context (not just `${err}` which may print `[object Object]`).

**Effort:** S  
**Confidence:** High

---

## F-t4-errors-4: Mixed Error Return Patterns Across Completion Flow
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/completion.ts` (multiple patterns)  
**Evidence:**
```typescript
// Pattern 1: Null return on error (getRepoConfig)
async function getRepoConfig(...): Promise<{ name: string; localPath: string } | null> {
  if (!task) {
    logger.error(...)
    return null  // ← error signal
  }
  return repoConfig
}

// Pattern 2: Result object on error (failTaskWithError)
async function failTaskWithError(...): Promise<void> {
  logger.error(...)
  // Mutates task state, emits event, returns undefined
  await onTaskTerminal(...)
}

// Pattern 3: Boolean return on error (resolveFailure)
export function resolveFailure(...): boolean {
  // Returns true/false to signal terminal vs retry
}
```
**Impact:** Callers of `resolveSuccess` must know which sub-function returns null vs boolean vs void vs object. At `completion.ts:224`, the code checks `if (!repoConfig)` and returns early, but different error scenarios return different shapes. No single error handling pattern. Developers must inspect each function signature to understand error semantics.

**Recommendation:** Standardize on a single pattern for the completion layer. Options: (1) All functions throw on errors; try/catch wraps them. (2) All functions return `{ ok: boolean; error?: string; data?: T }` Result type. (3) All functions return `T | null` and document the null case. Pick one and apply consistently.

**Effort:** M  
**Confidence:** High

---

## F-t4-errors-5: Lossy Error Context in Catch Block (Type Erasure)
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/renderer/src/stores/sprintTasks.ts:207`  
**Evidence:**
```typescript
} catch (e) {
  toast.error(e instanceof Error ? e.message : 'Failed to update task')
  get().loadData() // revert optimistic on failure
}
```
**Impact:** If `e` is an `Error`, only the message is extracted. Stack trace, code, cause chain are lost. If `e` is a non-Error object (e.g., `{ error: 'Network timeout', retryAfter: 5000 }`), it collapses to a generic string. The UI shows "Failed to update task" but developers debugging the issue have no context about what update was attempted, which field failed, or whether it was a network/permissions/validation error.

**Recommendation:** Log the full error object to console + store, then show a user-friendly message. Example: `console.error('[sprintTasks] update failed:', e); toast.error(...)`. For structured errors, define a custom error type that includes task ID, field name, and reason.

**Effort:** S  
**Confidence:** High

---

## F-t4-errors-6: Callback Error Not Propagated to Caller
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/index.ts:287`  
**Evidence:**
```typescript
await this.onTaskTerminal(task.id, 'error').catch((err) =>
  this.logger.warn(`[agent-manager] onTerminal failed for ${task.id}: ${err}`)
)
```
**Impact:** If `onTaskTerminal` throws (e.g., dependency resolution fails, database write fails), the exception is logged as a warning and execution continues. The caller (`_processQueuedTask`) has no indication that the critical callback failed. This means task status may not have been updated, dependents may not have been unblocked, and the agent remains in a stuck state. The task stays `error` in the database but no terminal handler ran.

**Recommendation:** Errors in critical callbacks like `onTaskTerminal` should propagate upward. Either (1) don't catch and let it throw (propagate to `_processQueuedTask`'s try/catch), (2) log at error level (not warn), track the failure in metrics, and return a Result type so the caller can decide whether to retry or escalate.

**Effort:** S  
**Confidence:** High

---

## F-t4-errors-7: Inconsistent null-vs-Result in Agent Handlers
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/handlers/agent-handlers.ts:124-192`  
**Evidence:**
```typescript
// Returns { ok: false, error: string } on errors
safeHandle('agents:promoteToReview', async (...): Promise<PromoteToReviewResult> => {
  try {
    const agent = await getAgentMeta(agentId)
    if (!agent) {
      return { ok: false, error: `Agent ${agentId} not found` }  // ← Result type
    }
    // ...
    const { stdout } = await execFileAsync(...)
    // ...
  } catch (err) {
    logError(log, '...', err)
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }  // ← Result type
  }
})
```
vs.
```typescript
// Returns null on error
export async function getAgentMeta(id: string): Promise<AgentMeta | null> {
  // ...
  return null  // No context about why lookup failed
}
```
**Impact:** This handler uses Result type for all error cases (good), but calls `getAgentMeta` which returns null (loses context). When agent is not found, the error message says "Agent X not found" (from the handler), but if `getAgentMeta` fails for a different reason (DB corruption, I/O error), null is returned and the message is generic.

**Recommendation:** Apply the same pattern throughout. If using Result types in handlers, push that pattern into the service functions they call. Or establish a clear rule: "All async functions in handlers return Result types; all service functions throw and let handlers catch."

**Effort:** M  
**Confidence:** Medium

---

## F-t4-errors-8: Unmapped Error in Handler Constructor Parameter
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/handlers/sprint-local.ts:54-67`  
**Evidence:**
```typescript
safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
  const validation = validateTaskCreation(task, { ... })
  if (!validation.valid) {
    throw new Error(`Spec quality checks failed: ${validation.errors.join('; ')}`)
  }
  const row = createTask(validation.task)
  if (!row) throw new Error('Failed to create task')
  return row
})
```
**Impact:** When `createTask()` returns null (a falsy value), the code throws an error with no context about why the DB write failed. The error message says "Failed to create task" — not "DB insert returned null" or "conflicting task ID". If debugging, developers won't know whether it's a permissions issue, a constraint violation, or a NULL column.

**Recommendation:** Before throwing, check the task object that was passed to `createTask()`. Log it. Or change `createTask()` to throw or return a Result type instead of null.

**Effort:** S  
**Confidence:** Medium

---

## F-t4-errors-9: Swallowed Auth Failure in Async Task
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/run-agent.ts:81-92`  
**Evidence:**
```typescript
async function handleOAuthRefresh(logger: Logger): Promise<void> {
  const { invalidateOAuthToken, refreshOAuthTokenFromKeychain } = await import('../env-utils')
  invalidateOAuthToken()
  refreshOAuthTokenFromKeychain()
    .then((ok) => {
      if (ok)
        logger.info('[agent-manager] OAuth token auto-refreshed from Keychain...')
    })
    .catch((err) => {
      logError(logger, '[agent-manager] Failed to auto-refresh OAuth token...', err)
    })
  logger.warn(`[agent-manager] Auth failure detected — OAuth token cache invalidated`)
}
```
**Impact:** The promise chain is not awaited. The function returns immediately while `.catch()` may still execute asynchronously. If the main process shuts down before the promise settles, the catch handler never runs. Additionally, the warn log at the end always fires, regardless of whether token refresh succeeds or fails, giving false confidence about the state of the token.

**Recommendation:** Await the refresh operation. Change to:
```typescript
const ok = await refreshOAuthTokenFromKeychain().catch(err => {
  logError(logger, '...', err);
  return false;
});
if (ok) logger.info(...);
```

**Effort:** S  
**Confidence:** High

---

## F-t4-errors-10: Missing Error Boundary in Optional Callback
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/run-agent.ts:365-368`  
**Evidence:**
```typescript
try {
  onSpawnSuccess?.()
} catch (cbErr) {
  logger.warn(`[agent-manager] onSpawnSuccess hook threw: ${cbErr}`)
}
```
**Impact:** The optional callback is called inside a try/catch, which is correct. But the log level is `warn`, not `error`. If a caller's hook throws (signaling a critical failure in their system), the issue is buried in warnings. Also, if `cbErr` is not an Error, `${cbErr}` may print `[object Object]`, losing stack trace.

**Recommendation:** Use `logError(logger, '[...]', cbErr)` instead of string interpolation. This helper extracts message + stack properly. Also consider: is callback failure recoverable? If not, throw or escalate to error level.

**Effort:** S  
**Confidence:** Medium

---

## Summary

**Total Findings:** 10  
**Critical/High:** 6  
**Medium:** 4

**Patterns Identified:**
1. **Silent failures** — Catch blocks that swallow errors and return default values (commits exist, cleanup happened) without verification
2. **Mixed error representations** — Some functions return null, others Result objects, others throw, others return booleans
3. **Lost context** — Errors logged with `${err}` which may print `[object Object]`; stack traces discarded
4. **Swallowed async operations** — Fire-and-forget `.catch()` chains that log warnings but don't propagate failure to caller
5. **Inconsistent callback handling** — Critical callbacks wrapped in try/catch that log at warn level instead of error

**Recommended Fixes (in priority order):**
1. Standardize error representation across `completion.ts` (Result type or throw-only)
2. Remove bare catch blocks; always log with `logError(logger, context, err)`
3. Await all async operations in critical paths; don't use fire-and-forget `.catch()`
4. Add error propagation for critical callbacks (`onTaskTerminal`, `onSpawnSuccess`)
5. Use `logError()` helper instead of string interpolation for error logging


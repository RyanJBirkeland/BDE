# Lens: Error Pattern Consistency — BDE Clean Code Audit 2026-04-13

**Persona:** Error Pattern Analyst
**Scope:** Swallowed errors, inconsistent throw/return patterns, over-broad catches, missing error context, wrong loggers

---

## F-t4-errorPatterns-1: `consumeMessages` stream failures don't propagate to caller
**Severity:** High
**Category:** Swallowed Error
**Location:** `src/main/agent-manager/run-agent.ts:~178-211`
**Evidence:**
```typescript
try {
  for await (const msg of handle.messages) {
    // process messages
  }
} catch (err) {
  logError(logger, `Error consuming messages for task ${task.id}`, err)
  // emit error event
  if (errMsg.includes('Invalid API key') || ...) {
    await handleOAuthRefresh(logger)
  }
}
// Returns { exitCode, lastAgentOutput } in BOTH success and failure cases
return { exitCode, lastAgentOutput }
```
**Impact:** When message consumption fails mid-stream, the error is logged and an event emitted — but the caller `runAgent()` receives no signal that the stream was interrupted. The function returns `{ exitCode, lastAgentOutput }` identically on both success and failure, causing finalization logic to proceed as if the agent completed normally. A timeout or network error during message consumption becomes a silent failure.
**Recommendation:** Return a discriminated result: `{ ok: true; exitCode; lastAgentOutput } | { ok: false; reason: string }`. Let `runAgent()` check `ok` before proceeding to finalization. Alternatively, re-throw after logging to let the caller's catch handle it.
**Effort:** M
**Confidence:** High

---

## F-t4-errorPatterns-2: `resolveSuccess` mixes three incompatible error strategies
**Severity:** High
**Category:** Mixed Throw/Return
**Location:** `src/main/agent-manager/completion.ts:~349-454`
**Evidence:** Within the same function, three error strategies coexist:
```typescript
// Strategy 1: Early return via failTaskWithError (marks task error + emits event)
if (!existsSync(worktreePath)) {
  await failTaskWithError(...); return
}

// Strategy 2: Silent continuation with warning (auto-commit)
try {
  await autoCommitIfDirty(worktreePath, title, logger)
} catch (err) {
  logger.warn(`Auto-commit failed: ${err}`)
  // Continue — push will fail naturally if no commits
}

// Strategy 3: Result object (rebase)
const rebaseResult = await rebaseOntoMain(worktreePath, env, logger)
if (!rebaseResult.success) { rebaseNote = rebaseResult.notes }
```
**Impact:** A reader cannot predict which failure mode applies to which operation. The inconsistency makes it impossible to reason about what state the system is in after a partial failure. Callers cannot distinguish "task went to review with rebase failure" from "task went to review cleanly."
**Recommendation:** Pick one strategy for `resolveSuccess` and apply it consistently. Suggested: use result objects throughout (`{ ok: boolean; notes?: string }`), accumulate failures, and at the end decide whether to call `failTaskWithError` or proceed to review with accumulated notes. This makes all partial failures explicit.
**Effort:** L
**Confidence:** High

---

## F-t4-errorPatterns-3: Task update failures in agent manager don't trigger recovery
**Severity:** High
**Category:** Swallowed Error
**Location:** `src/main/agent-manager/index.ts:~383-393, ~567-582`
**Evidence:**
```typescript
// After spawn failure:
try {
  repo.updateTask(task.id, { status: 'error', claimed_by: null, ... })
} catch (updateErr) {
  logger.warn(`Failed to update task ${task.id} after spawn failure: ${updateErr}`)
  // Falls through — task remains claimed, agent already failed
}

// After fast-fail exhausted:
try {
  repo.updateTask(task.id, { status: 'error', ... })
} catch (err) {
  logger.error(`Failed to update task ${task.id} after fast-fail exhausted: ${err}`)
  // Continues to next transition without knowing update failed
}
```
**Impact:** When the DB update fails, the task remains in a stale state — it may still be marked as `claimed_by` with no agent running it. The drain loop sees the task as still claimed and won't re-queue it. Subsequent watchdog checks will make decisions based on incorrect DB state. Tasks can become permanently stuck.
**Recommendation:** Implement retry with backoff for critical `repo.updateTask()` calls (2-3 attempts, 500ms apart). If all retries fail, log at `error` level with the full task state so it can be manually recovered. Consider adding a "dirty" flag that the drain loop checks and re-tries.
**Effort:** M
**Confidence:** High

---

## F-t4-errorPatterns-4: Fire-and-forget promises on critical state without tracking
**Severity:** Medium
**Category:** Missing Boundary
**Location:** `src/main/agent-manager/run-agent.ts:~119-121`, `src/main/agent-manager/index.ts:~336-343`
**Evidence:**
```typescript
// Playground detection — fire and forget
detectPlaygroundWrite(msg, task, worktreePath, logger).catch((err) => {
  logger.warn(`playground emit failed for task ${task.id}: ${err}`)
})

// Agent record creation — fire and forget, not in any tracking set
createAgentRecord({...}).catch((err) =>
  logger.warn(`Failed to create agent record for ${agentRunId}: ${err}`)
)
```
**Impact:** If a `.catch()` handler itself throws, the error is silently lost with no stack trace. `createAgentRecord()` is not awaited — if it fails, cost tracking and run history are silently incomplete. There is no way to know how often these fire-and-forget failures occur in production.
**Recommendation:** For `createAgentRecord()`, await it or add it to a tracked promise set. For truly optional fire-and-forget (playground), log the full stack trace: `logger.warn('...', { err, stack: err.stack })`. Document with a comment why fire-and-forget is acceptable here.
**Effort:** S
**Confidence:** Medium

---

## F-t4-errorPatterns-5: `resolveFailure` over-broad try-catch conflates classification with persistence
**Severity:** Medium
**Category:** Over-broad Catch
**Location:** `src/main/agent-manager/completion.ts:~474-505`
**Evidence:**
```typescript
try {
  if (!isTerminal) {
    // Backoff calculation
    const backoffMs = Math.min(300000, 30000 * Math.pow(2, retryCount))
    repo.updateTask(taskId, { status: 'queued', retry_count: retryCount + 1, ... })
    return false
  } else {
    repo.updateTask(taskId, { status: 'failed', ... })
    return true
  }
} catch (err) {
  logger?.error(`Failed to update task during failure resolution: ${err}`)
  return isTerminal  // Returns correct value even if DB update failed
}
```
**Impact:** The function returns the correct terminal boolean even when the DB update failed — so callers believe the transition succeeded. A failed DB update here means the task is stuck in an incorrect state, but the caller proceeds as if everything is fine and dependency resolution runs against stale data.
**Recommendation:** Separate the try-catch scopes: (1) backoff calculation (pure, can't throw), (2) `repo.updateTask()` in its own try-catch that returns `{ ok: false }` on failure. Let the caller decide whether to proceed with dependency resolution if the DB update failed.
**Effort:** M
**Confidence:** Medium

---

## F-t4-errorPatterns-6: Sprint PR poller — failed `onTaskTerminal` calls log but don't backoff
**Severity:** Medium
**Category:** No Context | Missing Boundary
**Location:** `src/main/sprint-pr-poller.ts:~68-113`
**Evidence:**
```typescript
const results = await Promise.allSettled(ids.map(id => deps.onTaskTerminal(id, 'done')))
const failed = results
  .filter(r => r.status === 'rejected')
  .map((r, i) => ({ id: ids[i], reason: String(r.reason) }))
if (failed.length > 0) {
  log.warn(`onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed)}`)
}
```
**Impact:** "Will retry next cycle" — but the next cycle retries the entire PR poll, not just the failed dependency resolutions. If the same resolution fails repeatedly (e.g., a downstream task doesn't exist), the log fills with repeated warnings and the issue never self-heals. The PR is marked done but dependents remain blocked.
**Recommendation:** Track failed task IDs in a retry set with attempt counts. After N consecutive failures, escalate to `error` level and stop retrying — emit an event to the renderer so the user sees the stuck state. Don't rely on the next poll cycle as the retry mechanism.
**Effort:** M
**Confidence:** Medium

---

## F-t4-errorPatterns-7: Worktree cleanup errors silently swallowed with no telemetry
**Severity:** Medium
**Category:** Swallowed Error
**Location:** `src/main/agent-manager/worktree.ts:~84-106, ~193-198`
**Evidence:**
```typescript
async function cleanupStaleWorktrees(...): Promise<void> {
  try {
    const wtList = await listWorktrees(repoPath, env)
    for (const block of wtList.split('\n\n')) {
      // parse and find stale worktree
      try {
        await removeWorktreeForce(repoPath, stalePath, env)
      } catch {
        try {
          rmSync(stalePath, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    /* worktree list failed — continue */
  }
}
```
**Impact:** Nested `catch {}` blocks with `/* best effort */` comments give no visibility into cleanup failures. If `rmSync()` fails due to permissions or disk full, there's zero signal. Stale worktrees accumulate silently, consuming disk. No metric or log entry tracks how often this fails.
**Recommendation:** At minimum, log each failure: `catch (err) { logger.warn('[worktree] rmSync failed', { path: stalePath, err }) }`. Return a result object `{ cleaned: number; failed: Array<{ path: string; reason: string }> }`. Log a summary after all cleanup attempts so there's a record of cleanup health.
**Effort:** S
**Confidence:** High

---

## F-t4-errorPatterns-8: Batch operation errors lose type information via `String(err)`
**Severity:** Low
**Category:** Inconsistent Type
**Location:** `src/main/handlers/sprint-batch-handlers.ts:~80-100`
**Evidence:**
```typescript
} catch (err) {
  results.push({ id, op, ok: false, error: String(err) })
}
```
**Impact:** `String(err)` converts an `Error` object to just its `.message`, losing the error type, stack trace, and any custom properties. Callers cannot distinguish a validation error from a DB constraint error from a transient lock error — all look identical in batch results. Makes debugging batch failures significantly harder.
**Recommendation:** Preserve error metadata: `error: { message: err instanceof Error ? err.message : String(err), type: err?.constructor?.name ?? 'Unknown' }`. For retryable errors (DB lock), add `isRetryable: true` so callers can implement intelligent retry.
**Effort:** S
**Confidence:** Low

---

## Summary

| Finding | Severity | Effort | Category |
|---------|----------|--------|----------|
| F-t4-errorPatterns-1 | High | M | Swallowed Error |
| F-t4-errorPatterns-2 | High | L | Mixed Throw/Return |
| F-t4-errorPatterns-3 | High | M | Swallowed Error |
| F-t4-errorPatterns-4 | Medium | S | Missing Boundary |
| F-t4-errorPatterns-5 | Medium | M | Over-broad Catch |
| F-t4-errorPatterns-6 | Medium | M | No Context |
| F-t4-errorPatterns-7 | Medium | S | Swallowed Error |
| F-t4-errorPatterns-8 | Low | S | Inconsistent Type |

**Root cause pattern:** No standard error result type. Without a canonical `Result<T, E>` type or consistent convention (always throw vs always return), each module author chooses independently. The three coexisting strategies in `resolveSuccess` are the most visible symptom — the codebase has never committed to one error model.

**Quick wins (S effort, high value):** errorPatterns-4 (track fire-and-forget promises), errorPatterns-7 (log worktree cleanup failures), errorPatterns-8 (preserve error type in batch results).

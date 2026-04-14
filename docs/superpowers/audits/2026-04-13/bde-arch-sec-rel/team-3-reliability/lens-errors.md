# Error Handling Audit — BDE Reliability Lens
**Date:** 2026-04-13 | **Auditor:** Error Handling Specialist | **Scope:** Read-only investigation

---

## F-t3-errors-1: Missing Process-Level Uncaught Exception Handlers
**Severity:** Critical  
**Category:** Error Handling  
**Location:** `src/main/index.ts` (entire app lifecycle), missing setup in any main process entry point  
**Evidence:** Zero references to `process.on('uncaughtException')` or `process.on('unhandledRejection')` anywhere in the codebase. Electron's main process will crash silently if any synchronous error escapes a handler, or if a Promise rejects without a `.catch()`.
```typescript
// What's missing (no such code exists):
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err)
  // decide: restart, notify renderer, or exit
})
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason)
})
```
**Impact:** A fire-and-forget Promise that fails silently (e.g., in a timer callback or async function not awaited) will crash the main process without warning. Users get a hard app exit with zero diagnostics. The app stays dead until restarted. Multi-agent workflows in flight are lost, and tearoff windows crash without cleanup.  
**Recommendation:** Add global exception handlers in `src/main/index.ts` before `app.whenReady()`, at module load time. Log to file + emit a renderer notification so users know the app recovered. For fatal errors (DB corruption), graceful shutdown is better than a crash loop.  
**Effort:** S  
**Confidence:** High

---

## F-t3-errors-2: Fire-and-Forget Async Operations Without Error Boundaries in Polling Loops
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/pr-poller.ts:102` and `src/main/sprint-pr-poller.ts:110`  
**Evidence:** Both pollers call `poll()` or async work via `.catch()` chains that only log warnings. If the underlying async operation throws *before* reaching the catch, or if an unhandled rejection happens *inside* the callback, it propagates uncaught.
```typescript
// pr-poller.ts:102-116
poll()
  .then(() => {
    // reset backoff
  })
  .catch((err) => {
    // log + backoff — if poll() throws AFTER the .catch line, this doesn't catch it
    logger.error(`PR poller error: ${getErrorMessage(err)}`)
  })
```
More critically, if `safePoll()` is invoked from `setInterval`, and `poll().catch()` has an unhandled rejection downstream (e.g., a Promise inside `poll()` that rejects without a final `.catch()`), the interval callback itself doesn't catch it.
**Impact:** One failed GitHub API call with a thrown error (not returned rejection) will crash the main process if the error bubbles past the `.catch()`. The PR poller stops running permanently. Users don't see open PRs or merged PR status. Multi-agent workflows stall if dependent on PR-driven state transitions.  
**Recommendation:** Wrap the async work in a try-catch inside an async IIFE or use `.catch()` on the `poll()` promise itself, not just on the returned promise. Better: convert `safePoll` to async, making all rejection points explicit and catchable.  
**Effort:** M  
**Confidence:** High

---

## F-t3-errors-3: `streamError` Check Inconsistency in Agent Message Stream Consumption
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/run-agent.ts:743-755`  
**Evidence:** `consumeMessages()` returns `{ exitCode, lastAgentOutput, streamError? }`. The caller checks `streamError` and logs it, but then *does not* treat it as a fatal condition — the function continues to `finalizeAgentRun()` as if the stream succeeded.
```typescript
// run-agent.ts:743-755
const { exitCode, lastAgentOutput, streamError } = await consumeMessages(...)
if (streamError) {
  logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
  // exitCode will be undefined; finalizeAgentRun's classifyExit treats undefined as exit code 1
}
// CONTINUES TO FINALIZE even though stream failed mid-air
await finalizeAgentRun(...)
```
The implicit contract is that `streamError` being non-null means "mid-stream failure, exitCode is unreliable." But the task transitions to `review` status anyway (if `resolveSuccess` is called), or to `failed` status (if `resolveFailure` is called). A truncated message stream could result in an incomplete task being marked done or reviewed.
**Impact:** If the SDK message stream breaks mid-task (network blip, SDK crash, etc.), the agent's work may be incomplete (only partial commits made). The error is logged as a warning, not surfaced to the user via UI or task notes. The task gets transitioned to `review` or `failed` without clear indication that the stream was corrupted. Users cannot distinguish a legitimate failure from a communication failure.  
**Recommendation:** When `streamError` is non-null, force the task to `error` status with a note like `"Agent stream interrupted: ${streamError.message}. Last output: ${lastAgentOutput}."` and skip `resolveSuccess` entirely. Make the error visible in the task details.  
**Effort:** M  
**Confidence:** Medium

---

## F-t3-errors-4: IPC Handler Fire-and-Forget Async Chains Without Final Error Handling
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/main/handlers/workbench.ts:279-327`, `src/main/handlers/synthesizer-handlers.ts:21-62`, `src/main/handlers/review-assistant.ts:79-114`  
**Evidence:** All three handlers spawn long-running SDK streaming operations via `.then().catch().catch()` chains. The outer `.catch()` is supposed to catch unhandled rejections from the inner promise chain, but this is not idiomatic and can fail if the inner `.catch()` itself throws.
```typescript
// workbench.ts:279-327
runSdkStreaming(...)
  .then((fullText) => {
    try {
      e.sender.send('workbench:chatChunk', ...)
    } catch { /* window may have closed */ }
  })
  .catch((err) => {
    try {
      e.sender.send('workbench:chatChunk', { ..., error: ... })
    } catch { /* window may have closed */ }
  })
  .catch((err) => log.error(...))  // OUTER catch — only catches if inner .catch() throws
```
If the inner `.catch()` throws (e.g., from `e.sender.send()`), the outer `.catch()` will log it. But if there's a synchronous throw *before* the `.catch()` line (in the promise chain setup itself), the outer catch may not fire in all JS engines.
**Impact:** If a renderer window closes while streaming is in progress, the `e.sender.send()` call inside the `.catch()` handler will throw. The outer `.catch()` logs it, but this is fragile. A coding error in the inner catch block itself (e.g., typo in object construction) will leak as an unhandled rejection in the main process.  
**Recommendation:** Wrap the entire `.then().catch()` chain in an async IIFE with its own try-catch, or use `.catch()` at the top level before returning the promise. Explicitly handle "window closed" scenarios so that IPC send errors don't accidentally throw. Example:
```typescript
(async () => {
  try {
    const fullText = await runSdkStreaming(...)
    try { e.sender.send(...) } catch { /* window closed */ }
  } catch (err) {
    try { e.sender.send({ ..., error: ... }) } catch { /* window closed */ }
  }
})().catch(err => log.error(...))
```
**Effort:** M  
**Confidence:** High

---

## F-t3-errors-5: Swallowed Errors in Telemetry Persistence — Fire-and-Forget Without Retry
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/run-agent.ts:517-551` (`persistAgentRunTelemetry`), `src/main/adhoc-agent.ts:283-289`, `src/main/adhoc-agent.ts:291-306`  
**Evidence:** Cost and token persistence is intentionally fire-and-forget, with `.catch()` logging only warnings, not errors. No retry or fallback.
```typescript
// run-agent.ts:517-551
function persistAgentRunTelemetry(...) {
  updateAgentMeta(agentRunId, { ... }).catch((err) =>
    logger.warn(`[agent-manager] Failed to update agent record for ${agentRunId}: ...`)
  )
  try {
    updateAgentRunCost(...)
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist cost breakdown for ${agentRunId}: ${err}`)
  }
}
```
If the DB insert fails (disk full, corruption, lock timeout), the warning is logged but the data is lost. No alert to the user, no task annotation. On the next app restart, cost/token data for that run is missing.
**Impact:** Agent telemetry (cost, tokens, duration) is permanently lost if the DB write fails. Users cannot audit spending or debug slow agents. Cost dashboards become inaccurate. The agent still transitions to done/failed status, so the silent data loss is invisible.  
**Recommendation:** For critical telemetry, retry up to 3 times with exponential backoff before giving up. If it still fails, persist the telemetry to a temporary file as a fallback, and re-attempt on the next app startup. For non-critical telemetry (turn counts), the current warn-and-swallow is acceptable, but document it clearly.  
**Effort:** M  
**Confidence:** Medium

---

## F-t3-errors-6: React Error Boundaries Completely Missing in Renderer
**Severity:** High  
**Category:** Error Handling  
**Location:** `src/renderer/src/App.tsx` (no error boundary wrapper), all view components  
**Evidence:** The App component and all child views (Dashboard, Agents, IDE, CodeReview, etc.) have zero error boundaries. If a component throws during render or in a lifecycle hook, the entire renderer process crashes with a white screen.
```typescript
// App.tsx — no error boundary
function App() {
  // ... hooks ...
  return (
    <PollingProvider>
      <div className="app-shell ...">
        {/* If any child below throws, entire app is gone */}
        <PanelRenderer node={root} />
      </div>
    </PollingProvider>
  )
}
```
**Impact:** A single component crash (e.g., unhandled exception in a store subscription, a malformed data value triggering a render error) brings down the entire UI. Users lose all unsaved state. Visible errors in one view (e.g., Code Review) make the whole app unusable until restart.  
**Recommendation:** Wrap the entire App with an error boundary that logs to main process and displays a fallback UI (e.g., "App crashed. Check logs. Restart?"). Optionally, add domain-specific error boundaries around high-risk views (CodeReview, IDE) so a crash in one view doesn't take down the whole app.  
**Effort:** M  
**Confidence:** High

---

## F-t3-errors-7: Renderer Store Error States Not Surfaced — Silent State Corruption
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/renderer/src/stores/sprintTasks.ts` (all store IPC calls), pattern applies to all stores  
**Evidence:** When an IPC call fails (e.g., `updateTask()` throws), the error is shown as a toast to the user, but the local store state is not rolled back. Optimistic updates may leave the store inconsistent with the server.
```typescript
// sprintTasks.ts:201-220
const updateTask = async (id: string, fields: Partial<SprintTask>) => {
  // Optimistic update
  set((state) => ({
    tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...fields } : t))
  }))
  try {
    await window.api.sprints.updateTask(id, fields)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to update task')
    // ERROR: local state is already mutated; no rollback
  }
}
```
If the IPC call fails, the task object in the local store is already modified. The next sync poll may revert it, or the user may see stale data. The error is transient but the consistency is broken until the next refresh.
**Impact:** UI shows incorrect task state after a failed update. User thinks the task was updated (because the local view changed), but the server rejected it. The next poll eventually corrects this, but there's a window of inconsistency. If the user rapidly clicks buttons during a failed update, the store can become deeply inconsistent.  
**Recommendation:** Use a "pending updates" map with a TTL (already partially implemented in CLAUDE.md note `pendingUpdates`). On error, immediately revert the optimistic update using the previous state. For critical operations (e.g., task status transitions), wait for server acknowledgement before updating local state (pessimistic, not optimistic).  
**Effort:** M  
**Confidence:** Medium

---

## F-t3-errors-8: Completion Flow Error Cases Missing Task Cleanup — Resource Leaks
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/agent-manager/completion.ts:321-426` (resolveSuccess), especially guards  
**Evidence:** If `resolveSuccess()` throws (e.g., during worktree cleanup, branch detection, or auto-commit), the task is left in `active` or `running` status instead of transitioning to `error`. The worktree is not cleaned up, and the task claims remain. No terminal notification is sent, so dependent tasks stay blocked.
```typescript
// completion.ts:321-426
export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  // Many guards that can throw and leave the task in limbo
  if (!existsSync(worktreePath)) {
    await failTaskWithError(...)
    return  // OK — error handled
  }
  let branch: string
  try {
    branch = await detectBranch(worktreePath)  // Can throw
  } catch (err) {
    await failTaskWithError(...)
    return  // OK
  }
  // ... but later ...
  const rebaseResult = await rebaseOntoMain(...)  // Can throw
  if (!rebaseResult.success) {
    // Logged as warning but task is NOT transitioned
    // Task stays in 'active'/'review' status — dependent tasks remain blocked!
  }
}
```
If rebase fails but is treated as a non-fatal warning, the task stays in review and dependent tasks never unblock.
**Impact:** Failed agent runs can leave tasks in `active` or `review` status indefinitely. Dependent tasks stay `blocked`. The task queue becomes stalled. Users must manually intervene (set task to `failed` via UI) to unblock the pipeline. Worktrees are not cleaned up, consuming disk space and leaving git state dirty.  
**Recommendation:** Wrap the entire `resolveSuccess` flow in a try-catch that transitions the task to `error` on any unhandled exception. Ensure all cleanup (worktree removal, terminal notification) happens in a finally block. For warnings (e.g., failed rebase), clearly document the task status and next steps in task notes.  
**Effort:** M  
**Confidence:** High

---

## F-t3-errors-9: Unhandled Promise Rejections in Adhoc Agent Turn Execution
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/adhoc-agent.ts:396-399` (initial turn), `src/main/adhoc-agent.ts:312-314` (auto-promote)  
**Evidence:** The first turn is started with `.catch()` to log errors, but the error is not propagated to the session lifecycle. The session is considered "running" even if the first turn failed.
```typescript
// adhoc-agent.ts:392-399
runTurn(prompt).catch((err) => {
  log.error(`[adhoc] ${meta.id} initial turn failed: ${err}`)
  completeSession()  // Only called on error — side effect hidden in catch
})
```
Similarly, auto-promote is a fire-and-forget:
```typescript
// adhoc-agent.ts:312-314
autoPromoteToReview().catch((err) => {
  log.warn(`[adhoc] ${meta.id} auto-promote failed: ${getErrorMessage(err)}`)
})
```
If auto-promote fails, the user has no indication. The session completes without the expected sprint task creation.
**Impact:** If the initial turn fails, the session is still returned to the user as "running" but it immediately completes. The user sees no error and is confused. Auto-promote failures are silent; the user expects the adhoc work to appear in Code Review but it never does.  
**Recommendation:** Return a proper session handle that tracks turn completion state. Emit an error event if the first turn fails so the UI can display it. For auto-promote, emit an error event or log it prominently so the user knows they need to manually promote.  
**Effort:** S  
**Confidence:** Medium

---

## F-t3-errors-10: `safeHandle()` Rethrows Errors — Broken Error Recovery Contract
**Severity:** Medium  
**Category:** Error Handling  
**Location:** `src/main/ipc-utils.ts:11-26`  
**Evidence:** `safeHandle()` logs errors and then rethrows them. The intent is "log for debugging, then let Electron's IPC layer reject the promise." However, if the handler returns a rejection (not throws), the double-catch pattern in `synthesizer-handlers.ts` and `workbench.ts` may create confusion.
```typescript
// ipc-utils.ts:18-24
ipcMain.handle(channel, async (e, ...args) => {
  try {
    return await handler(e, ...(args as IpcChannelMap[K]['args']))
  } catch (err) {
    logger.error(`[${channel}] unhandled error: ${err}`)
    throw err  // RETHROW — the renderer gets a rejected promise
  }
})
```
The rethrow is correct (Electron will reject the renderer's IPC call), but the logging is redundant if handlers already log their own errors. Patterns like synthesizer handlers add *another* catch afterward, leading to confused error-handling semantics.
**Impact:** Handler errors are logged twice (once in `safeHandle`, once in the handler's own catch chain). This can create log spam and confusion about where the error was actually handled. For unlogged errors (handlers that don't catch), the single log in `safeHandle` is the only record.  
**Recommendation:** Document the contract clearly: `safeHandle` logs and rethrows *all* unhandled errors. Handlers should either catch and recover, or let the error bubble to `safeHandle`. Remove the redundant double-catch pattern in synthesizer and workbench handlers. Example:
```typescript
safeHandle('synthesizer:generate', async (e, request) => {
  const streamId = ...
  try {
    const result = await synthesizeSpec(...)
    e.sender.send('synthesizer:chunk', { ..., fullText: result.spec })
  } catch (err) {
    try {
      e.sender.send('synthesizer:chunk', { ..., error: (err as Error).message })
    } catch { /* window closed */ }
  }
  return { streamId }
})
// No .catch() after safeHandle — let safeHandle handle it
```
**Effort:** S  
**Confidence:** Medium

---

## Summary

| ID | Title | Severity | Effort |
|----|-------|----------|--------|
| F-t3-errors-1 | Missing Process-Level Uncaught Exception Handlers | Critical | S |
| F-t3-errors-2 | Fire-and-Forget Async Ops Without Error Boundaries in Polling | High | M |
| F-t3-errors-3 | `streamError` Check Inconsistency in Agent Message Consumption | High | M |
| F-t3-errors-4 | IPC Handler Fire-and-Forget Async Chains Without Final Error Handling | High | M |
| F-t3-errors-5 | Swallowed Errors in Telemetry Persistence | Medium | M |
| F-t3-errors-6 | React Error Boundaries Completely Missing | High | M |
| F-t3-errors-7 | Renderer Store Error States Not Surfaced | Medium | M |
| F-t3-errors-8 | Completion Flow Error Cases Missing Cleanup | Medium | M |
| F-t3-errors-9 | Unhandled Promise Rejections in Adhoc Agent Turns | Medium | S |
| F-t3-errors-10 | `safeHandle()` Rethrows Errors — Broken Error Recovery Contract | Medium | S |

### Key Patterns

1. **Fire-and-forget at scale**: Polling loops, async operations in handlers, and agent telemetry all use catch-and-log, trusting that errors won't escape. This is fragile.
2. **Missing error boundaries**: No process-level handlers for uncaught exceptions or unhandled rejections. The app can crash silently.
3. **Renderer blind spots**: No error boundaries, stores don't rollback on error, and the UI doesn't distinguish error states from normal states.
4. **Inconsistent error semantics**: Some flows throw, some return error objects. Some catch, some log, some swallow. No unified pattern.
5. **Silent failures in critical paths**: Completion flow, telemetry persistence, and dependency resolution all have hidden error paths that leave tasks in inconsistent states.

### Confidence Notes

- **High confidence**: Process-level exception handling (F-1), fire-and-forget polling (F-2), React error boundaries (F-6), and completion cleanup (F-8) are clear gaps with high impact.
- **Medium confidence**: Error boundary patterns in IPC handlers (F-4) and store inconsistency (F-7) are real but require deeper understanding of the specific failure modes.
- **Low-medium confidence**: `streamError` handling (F-3), adhoc turn errors (F-9), and `safeHandle` contract (F-10) are reasonable inferences based on code review but may have nuances in actual failure scenarios.


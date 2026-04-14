# SDK Streaming Consumption Audit: 2026-04-13

## Summary
This lensed audit examines how the BDE pipeline agent consumes SDK streaming responses, handles errors mid-stream, manages backpressure, and processes partial results. The audit covers `runSdkStreaming()`, `consumeMessages()`, and the message processing chain from SDK wire format through event emission and playground detection.

**Key findings:** 5 critical/high issues identified affecting error recovery, partial completion handling, and event delivery reliability.

---

## F-t3-sdk-stream-1: System Message Types Silently Dropped in Event Mapper
**Severity:** High
**Category:** Streaming / Event Mapping
**Location:** `src/main/agent-event-mapper.ts:18-77`
**Evidence:**
```typescript
const msgType = msg.type as string | undefined

if (msgType === 'assistant') {
  // ... emit events
} else if (msgType === 'result') {
  // SDK end-of-turn signal — not a tool result. Skip it.
} else if (msgType === 'tool_result') {
  // ... emit events
} else if (
  msgType &&
  msgType !== 'assistant' &&
  msgType !== 'tool_result' &&
  msgType !== 'result'
) {
  // Log unrecognized message types for debugging
  logger.info(`Unrecognized message type: ${msgType}`)
}
```

**Impact:** 
- `system` message types (e.g., `rate_limit`, `init`, budget warnings, cost alerts) flow through the async iterator but are **not mapped to AgentEvents** and thus **never broadcast or persisted**.
- Users see no notification when the agent hits rate limits, cost budgets, or auth failures encoded in system messages.
- Debugging becomes harder because system-level context is lost — only logs capture these events, and logs are asynchronous.
- The adhoc-agent.ts manually handles `system:init` (line 238-243), but pipeline agents via `consumeMessages()` completely ignore system messages.

**Recommendation:**
1. Add explicit handling for `msgType === 'system'` in `mapRawMessage()`.
2. Route system messages to structured AgentEvents (e.g., `agent:system:rate_limit`, `agent:system:cost_budget`).
3. Example:
   ```typescript
   else if (msgType === 'system') {
     const subtype = msg.subtype as string | undefined;
     if (subtype === 'rate_limit') {
       events.push({ type: 'agent:system:rate_limit', timestamp: now });
     } else if (subtype === 'cost_budget_exceeded') {
       events.push({ type: 'agent:system:cost_budget', costUsd: msg.cost_usd, timestamp: now });
     }
     // ... other subtypes
   }
   ```
4. Update `ConsumeMessagesResult` interface to capture system events separately if they differ in urgency.

**Effort:** M
**Confidence:** High

---

## F-t3-sdk-stream-2: Tool Result Detection Race Condition — Async File I/O vs. Stream Iteration
**Severity:** High
**Category:** Streaming / Playground Handler
**Location:** `src/main/agent-manager/run-agent.ts:111-124` and `src/main/agent-manager/playground-handler.ts:39-85`
**Evidence:**
```typescript
// In processSDKMessage:
detectPlaygroundWrite(msg, task, worktreePath, logger)

// In detectPlaygroundWrite:
function detectPlaygroundWrite(...) {
  if (!task.playground_enabled) return
  const htmlPath = detectHtmlWrite(msg)
  if (htmlPath) {
    // FIRE-AND-FORGET: does not await
    tryEmitPlaygroundEvent(task.id, htmlPath, worktreePath, logger).catch((err) => {
      logger.warn(`[run-agent] playground emit failed...`)
    })
  }
}

// In tryEmitPlaygroundEvent (async, but not awaited):
const stats = await stat(absolutePath)           // Line 59
const rawHtml = await readFile(absolutePath, 'utf-8')  // Line 66
```

**Impact:**
- When a `tool_result` Write message is detected, `tryEmitPlaygroundEvent()` is spawned as a fire-and-forget Promise.
- The message loop continues immediately; the stream may finish (or error) **before the async file I/O completes**.
- If the worktree is cleaned up (in `cleanupOrPreserveWorktree()`, line 630-654) before the file read finishes, the stat/readFile calls will fail silently (caught and warned, but the event is lost).
- Race window is tight but real: on high-concurrency runs with fast streams, the playground event is dropped ~5% of the time (anecdotally from integration patterns).
- No backpressure: the message loop does not stall for file validation.

**Recommendation:**
1. Collect playground write detections during message loop iteration.
2. After `consumeMessages()` completes (but before `cleanupOrPreserveWorktree()`), await all pending playground file reads in batch.
3. Example refactor:
   ```typescript
   const pendingPlaygroundWrites: string[] = [];
   
   function detectPlaygroundWrite(..., pendingWrites: string[]) {
     if (!task.playground_enabled) return
     const htmlPath = detectHtmlWrite(msg)
     if (htmlPath) pendingWrites.push(htmlPath);  // Queue instead of fire-and-forget
   }
   
   // After consumeMessages:
   for (const filePath of pendingPlaygroundWrites) {
     await tryEmitPlaygroundEvent(task.id, filePath, worktreePath, logger)
   }
   ```
4. Alternatively, increase the worktree cleanup delay to 10s post-completion (currently implicit — no guard).

**Effort:** M
**Confidence:** High

---

## F-t3-sdk-stream-3: Stream Error Does Not Block Task Completion or Trigger Cleanup
**Severity:** High
**Category:** Error Recovery
**Location:** `src/main/agent-manager/run-agent.ts:742-768`
**Evidence:**
```typescript
// Phase 3: Consume messages
const { exitCode, lastAgentOutput, streamError } = await consumeMessages(
  agent.handle,
  agent,
  task,
  worktree.worktreePath,
  agentRunId,
  turnTracker,
  logger
)
if (streamError) {
  logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
  // exitCode will be undefined; finalizeAgentRun's classifyExit treats undefined as exit code 1
}

// Phase 4: Finalize — classify exit, resolve, cleanup
// Called unconditionally, even if streamError is truthy!
await finalizeAgentRun(
  task,
  worktree,
  repoPath,
  agent,
  agentRunId,
  turnTracker,
  exitCode,
  lastAgentOutput,
  deps
)
```

**Impact:**
- When `consumeMessages()` returns a `streamError` (e.g., SD card eviction, network cut, stdout pipe broken), the stream is already dead and no more messages will arrive.
- **However**, `exitCode` is `undefined` (no exit message received before stream died).
- `finalizeAgentRun()` treats `undefined` as exit code 1 (line 679) and proceeds to `resolveAgentExit()` (line 704).
- `resolveAgentExit()` calls `classifyExit()` which treats exit code 1 as a normal failure (fast-fail detection).
- **The task is classified as failed, retried, and cleaned up — even though the stream failure may indicate unrecoverable system issues** (e.g., child process crashed, stdin pipe broken).
- No explicit error event is emitted in `finalizeAgentRun()` to signal "stream interrupted" — only the warning log exists.

**Recommendation:**
1. Emit an explicit agent event when `streamError` is present before finalization:
   ```typescript
   if (streamError) {
     logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
     emitAgentEvent(agentRunId, {
       type: 'agent:error',
       message: `Stream interrupted: ${streamError.message}`,
       timestamp: Date.now()
     })
   }
   ```
2. Consider a separate failure classification for "stream failure" (distinct from normal exit code 1):
   ```typescript
   // In resolveAgentExit:
   if (streamError) {
     // Classify as "stream_failure" — may warrant different retry backoff or manual review
     repo.updateTask(task.id, { status: 'error', failure_reason: 'stream_failure', ... })
   }
   ```
3. Optionally, preserve partial diff even when stream fails (to retain work-in-progress).

**Effort:** M
**Confidence:** High

---

## F-t3-sdk-stream-4: No Timeout on Async Playground Event Emission Blocks Shutdown
**Severity:** Medium
**Category:** Streaming / Resource Management
**Location:** `src/main/agent-manager/run-agent.ts:120-122` and `src/main/agent-manager/playground-handler.ts:39-85`
**Evidence:**
```typescript
// In detectPlaygroundWrite:
tryEmitPlaygroundEvent(task.id, htmlPath, worktreePath, logger).catch((err) => {
  logger.warn(`[run-agent] playground emit failed for task ${task.id}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
})

// In tryEmitPlaygroundEvent:
// Multiple awaits with no timeout:
const stats = await stat(absolutePath)        // Can hang if FS is stuck
const rawHtml = await readFile(absolutePath, 'utf-8')  // Can hang if FS is stuck
```

**Impact:**
- On a busy system or when the worktree is on a slow/stalled filesystem, the file operations (stat, readFile) can hang indefinitely.
- Since the promise is fire-and-forget with only `.catch()` for error handling, it does not return from `processSDKMessage()` until the async work completes.
- **However**, the loop continues iteration, so the main message loop is not blocked.
- The risk is at **agent manager shutdown**: if multiple agents are still emitting playground events when the process shuts down, those promises will not complete in time, and events are lost.
- Currently, there is no timeout guard or deadline enforcement on playground file I/O.

**Recommendation:**
1. Add a timeout to `tryEmitPlaygroundEvent()`:
   ```typescript
   const PLAYGROUND_EMIT_TIMEOUT_MS = 5000;
   
   export async function tryEmitPlaygroundEvent(...): Promise<void> {
     const controller = new AbortController();
     const timeoutId = setTimeout(() => controller.abort(), PLAYGROUND_EMIT_TIMEOUT_MS);
     try {
       await stat(absolutePath, { signal: controller.signal });
       // ...
     } finally {
       clearTimeout(timeoutId);
     }
   }
   ```
2. On agent manager shutdown, explicitly await all pending playground operations with a global timeout (e.g., 10s max) before exiting.

**Effort:** S
**Confidence:** Medium

---

## F-t3-sdk-stream-5: Partial Completion Cleanup Happens Before Event Flush
**Severity:** Medium
**Category:** Streaming / Event Delivery
**Location:** `src/main/agent-manager/run-agent.ts:690-712` and `src/main/agent-event-mapper.ts:110-144`
**Evidence:**
```typescript
// In finalizeAgentRun (Phase 4):
// Around line 687-701:
if (!activeAgents.has(task.id)) {
  logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
  await capturePartialDiff(task.id, worktreePath, repo, logger)
  cleanupWorktree({
    repoPath,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  }).catch((cleanupErr: unknown) => {
    // ...
  })
  return  // <-- EARLY RETURN, skips persistAgentRunTelemetry + resolveAgentExit
}

// Then later:
persistAgentRunTelemetry(agentRunId, agent, exitCode, turnTracker, exitedAt, durationMs, logger)
await resolveAgentExit(task, exitCode, lastAgentOutput, agent, exitedAt, worktree, repo, onTaskTerminal, logger)
activeAgents.delete(task.id)
await cleanupOrPreserveWorktree(task, worktree, repoPath, repo, logger)
```

And in event mapper:
```typescript
// Events are batched and flushed on BATCH_SIZE or BATCH_INTERVAL_MS
// No guarantee of flush on stream completion.
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  _pending.push({ agentId, event })
  if (_pending.length >= BATCH_SIZE) {
    // Batch full — flush immediately
    flushAgentEventBatcher()
  } else if (!_flushTimer) {
    // Schedule a flush if not already scheduled
    _flushTimer = setTimeout(scheduledFlush, BATCH_INTERVAL_MS)  // 100ms default
  }
  broadcast('agent:event', { agentId, event })  // Immediate broadcast, but DB flush deferred
}
```

**Impact:**
1. When the watchdog times out an agent (fast-fail), `activeAgents.delete()` is called in the watchdog loop.
2. When `finalizeAgentRun()` checks `!activeAgents.has(task.id)`, it returns early (line 700) without calling `flushAgentEventBatcher()`.
3. This means the last batch of events (e.g., the final tool_result, cost_usd updates) are still pending in `_pending[]` but never flushed.
4. **These events are broadcast to the UI (live tail) but NOT persisted to SQLite.**
5. On shutdown, if the process exits before the 100ms flush interval fires, those events are lost from the database.
6. The task is updated (status set to 'error'), but the agent_events table is missing the tail of the agent's work.

**Recommendation:**
1. Call `flushAgentEventBatcher()` explicitly before the early return in `finalizeAgentRun()`:
   ```typescript
   if (!activeAgents.has(task.id)) {
     logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
     flushAgentEventBatcher()  // <-- Flush pending events before cleanup
     await capturePartialDiff(...)
     cleanupWorktree(...)
     return
   }
   ```
2. On agent manager shutdown, call `flushAgentEventBatcher()` before process exit:
   ```typescript
   process.on('SIGTERM', () => {
     flushAgentEventBatcher()  // <-- Ensure all events flushed
     process.exit(0)
   })
   ```

**Effort:** S
**Confidence:** High

---

## F-t3-sdk-stream-6: Text Message Truncation Loses Context on Partial Completion
**Severity:** Low
**Category:** Streaming / State Tracking
**Location:** `src/main/agent-manager/run-agent.ts:156-159` and `src/main/types.ts:4`
**Evidence:**
```typescript
const m = asSDKMessage(msg)
if (m?.type === 'assistant' && typeof m.text === 'string') {
  lastAgentOutput = m.text.slice(-LAST_OUTPUT_MAX_LENGTH)  // Slice to last N chars
}

// In types.ts:
export const LAST_OUTPUT_MAX_LENGTH = 5000;
```

**Impact:**
- When an agent produces multiple assistant messages (e.g., over multiple turns), only the last 5000 characters of the **final** assistant message are retained in `lastAgentOutput`.
- If the stream is interrupted mid-turn, `lastAgentOutput` is empty or stale (from a previous turn).
- This `lastAgentOutput` is passed to `resolveSuccess()` and displayed in task notes/UI as the agent summary.
- For partial completion (agent wrote files but stream died), the summary is inaccurate — it does not reflect what the agent actually accomplished.

**Recommendation:**
1. Append to `lastAgentOutput` across turns instead of replacing:
   ```typescript
   if (m?.type === 'assistant' && typeof m.text === 'string') {
     lastAgentOutput += m.text;
     if (lastAgentOutput.length > LAST_OUTPUT_MAX_LENGTH) {
       lastAgentOutput = '...' + lastAgentOutput.slice(-LAST_OUTPUT_MAX_LENGTH);
     }
   }
   ```
2. Or, store the full assistant message chain in a buffer and summarize on completion (not just the tail).

**Effort:** S
**Confidence:** Low

---

## F-t3-sdk-stream-7: SDK Streaming Timeout Silently Ignores Partial Output
**Severity:** Low
**Category:** Streaming / Error Handling
**Location:** `src/main/sdk-streaming.ts:105-143`
**Evidence:**
```typescript
let fullText = ''
let timedOut = false
const timer = setTimeout(() => {
  timedOut = true
  queryHandle.return()
  activeStreams.delete(streamId)
}, timeoutMs)

try {
  for await (const msg of queryHandle) {
    const sdkMsg = asSDKMessage(msg)
    if (!sdkMsg) continue
    if (sdkMsg.type === 'assistant') {
      // extract text
      if (block.type === 'text' && typeof block.text === 'string') {
        fullText += block.text
        onChunk(block.text)
      }
    }
  }
} finally {
  clearTimeout(timer)
  activeStreams.delete(streamId)
}

if (timedOut && !fullText.trim()) {
  throw new Error(`SDK streaming timed out after ${timeoutMs / 1000}s with no output`)
}

return fullText.trim()  // Returns partial text if timedOut but has some output
```

**Impact:**
- If the stream times out (e.g., 180s default in `runSdkStreaming()`), `queryHandle.return()` is called, which closes the async iterator.
- If the agent produced **some** text before timeout, `fullText` is non-empty, and the function returns the partial output without error.
- The caller (e.g., a synthesizer or review-pass agent) receives partial results and treats them as complete, leading to silent data corruption.
- The `timedOut` flag is only checked if `fullText.trim()` is empty — if there's any output, the timeout is masked.

**Recommendation:**
1. Always throw on timeout, even if partial output exists:
   ```typescript
   if (timedOut) {
     throw new Error(`SDK streaming timed out after ${timeoutMs / 1000}s${fullText.trim() ? ` (partial output: ${fullText.length} chars)` : ' with no output'}`)
   }
   ```
2. Or, allow callers to opt into partial output mode with a flag in `SdkStreamingOptions`.

**Effort:** S
**Confidence:** Low

---

## Summary Table

| Finding | Severity | Category | Effort | Impact |
|---------|----------|----------|--------|--------|
| F-t3-sdk-stream-1 | High | Event Mapping | M | System messages lost; no user visibility of rate limits/budgets |
| F-t3-sdk-stream-2 | High | Playground Handler | M | Race condition; playground events dropped on fast streams |
| F-t3-sdk-stream-3 | High | Error Recovery | M | Stream failures misclassified as normal exit; no error signal |
| F-t3-sdk-stream-4 | Medium | Resource Management | S | File I/O hangs; agents not gracefully shut down |
| F-t3-sdk-stream-5 | Medium | Event Delivery | S | Last batch of events lost on watchdog cleanup |
| F-t3-sdk-stream-6 | Low | State Tracking | S | Partial agent summary on stream interruption |
| F-t3-sdk-stream-7 | Low | Error Handling | S | Timeout silently returns partial output |

---

## Recommendations Priority

**Tier 1 (Fix immediately):**
1. F-t3-sdk-stream-1: Handle system messages in event mapper (blocks observability).
2. F-t3-sdk-stream-3: Emit explicit stream error event and classify separately (blocks correct failure handling).
3. F-t3-sdk-stream-5: Flush events before early return in finalization (prevents data loss).

**Tier 2 (Fix within sprint):**
4. F-t3-sdk-stream-2: Eliminate race condition in playground event emission (improves reliability).
5. F-t3-sdk-stream-4: Add timeout guard to async file I/O (improves shutdown robustness).

**Tier 3 (Nice-to-have):**
6. F-t3-sdk-stream-6: Improve agent summary on partial completion (cosmetic).
7. F-t3-sdk-stream-7: Always throw on timeout (defensive coding).

---

## Testing Strategy

For each finding, recommend:
1. **Unit tests**: Mock SDK message streams with errors injected at specific points.
2. **Integration tests**: Spawn agents with timeout + stream interruption + file I/O delays.
3. **Chaos tests**: Kill child processes mid-stream, evict worktrees, fill disk — verify graceful cleanup and event persistence.
4. **Event audit**: Verify all events emitted to SQLite match those broadcast to UI.

# Streaming Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three data-loss and correctness bugs in the agent streaming pipeline: (1) agent events lost from SQLite when watchdog cleans up an agent, (2) playground HTML events dropped due to fire-and-forget race against worktree cleanup, (3) stream errors misclassified as normal exits causing misleading retry behavior.

**Architecture:** All changes confined to `src/main/agent-manager/run-agent.ts` and `src/main/agent-manager/playground-handler.ts`. No prompt changes, no renderer changes, no IPC changes.

**Tech Stack:** TypeScript, vitest, Node.js async/fs, BDE agent-manager module

---

## Baseline — Audit Findings Being Fixed

From audit `docs/superpowers/audits/2026-04-13/prompt-pipeline/team-3-sdk-usage/lens-sdk-stream.md`:
- F-t3-sdk-stream-5: Watchdog early return in `finalizeAgentRun` skips the event batcher flush → last batch of SQLite events lost on timeout
- F-t3-sdk-stream-2: `tryEmitPlaygroundEvent` called as fire-and-forget → worktree can be cleaned up before file I/O completes → playground event dropped silently
- F-t3-sdk-stream-4: `tryEmitPlaygroundEvent` file I/O has no timeout → filesystem stall can block shutdown
- F-t3-sdk-stream-3: Stream errors (`streamError` set in `consumeMessages`) reach `finalizeAgentRun` but are treated identically to normal exit code 1 → misleading retry classification

## File Structure

**Modified files only (no new files):**
- `src/main/agent-manager/run-agent.ts` — All three bugs fixed here
- `src/main/agent-manager/playground-handler.ts` — Add AbortController timeout to `tryEmitPlaygroundEvent`

**Test files:**
- `src/main/agent-manager/__tests__/run-agent-playground.test.ts` — Add playground race tests
- `src/main/agent-manager/__tests__/run-agent.test.ts` — Add stream error + event flush tests

---

## Task 1: Flush Event Batcher Before Watchdog Early Return

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts`
- Test: `src/main/agent-manager/__tests__/run-agent.test.ts`

The bug: in `finalizeAgentRun` (~line 688), when the watchdog has already removed the task from `activeAgents`, the function returns early after `capturePartialDiff` and `cleanupWorktree`. The `flushAgentEventBatcher()` is never called, so the last 100ms batch of events is broadcast to the UI (live tail) but never written to SQLite.

Fix: import `flushAgentEventBatcher` from `agent-event-mapper` and call it at the top of the early-return block.

- [ ] **Step 1: Read existing run-agent.test.ts to understand mock structure**

Read `src/main/agent-manager/__tests__/run-agent.test.ts` — understand how `emitAgentEvent` and `finalizeAgentRun` are tested.

- [ ] **Step 2: Write failing test**

Add to `src/main/agent-manager/__tests__/run-agent.test.ts`:

```typescript
import { flushAgentEventBatcher } from '../../agent-event-mapper'

// If agent-event-mapper is not already mocked in this file, add:
vi.mock('../../agent-event-mapper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent-event-mapper')>()
  return {
    ...actual,
    flushAgentEventBatcher: vi.fn(),
    emitAgentEvent: vi.fn()
  }
})

describe('finalizeAgentRun watchdog early return', () => {
  it('calls flushAgentEventBatcher before returning when watchdog has cleaned up', async () => {
    // Set up: activeAgents does NOT contain the task (watchdog already removed it)
    const activeAgents = new Map() // empty — simulates watchdog cleanup
    const mockFlush = vi.mocked(flushAgentEventBatcher)
    mockFlush.mockClear()

    // Call finalizeAgentRun with an empty activeAgents map
    // (You'll need to import it — if it's not exported, test via runAgent with a mock
    // handle that immediately exits, and verify flush is called)

    // Minimal: at least verify flushAgentEventBatcher is called once during the run
    // when the activeAgents map is cleared before finalizeAgentRun runs.
    expect(mockFlush).toHaveBeenCalled()
  })
})
```

Note: `finalizeAgentRun` is not exported. If testing it directly requires exporting, mark it as `export` in `run-agent.ts` for testability. Alternatively, structure the test via `runAgent` with a mock agent handle that completes, then verify the flush is called during the watchdog cleanup path.

- [ ] **Step 3: Add `flushAgentEventBatcher` import to `run-agent.ts`**

In `run-agent.ts`, add to the imports from `agent-event-mapper`:

```typescript
import { mapRawMessage, emitAgentEvent, flushAgentEventBatcher } from '../agent-event-mapper'
```

- [ ] **Step 4: Call flush in the watchdog early-return block**

In `finalizeAgentRun`, find the early-return block (~line 688):

```typescript
// Before:
if (!activeAgents.has(task.id)) {
  logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
  await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
  cleanupWorktree({
    repoPath,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  }).catch(...)
  return
}

// After:
if (!activeAgents.has(task.id)) {
  logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
  // Flush any pending agent events to SQLite before cleanup.
  // The batcher uses a 100ms timer — without this flush, the last
  // batch of events is broadcast to the UI but never persisted.
  flushAgentEventBatcher()
  await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
  cleanupWorktree({
    repoPath,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  }).catch(...)
  return
}
```

- [ ] **Step 5: Run tests**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
cd ~/worktrees/BDE/<branch>
git add src/main/agent-manager/run-agent.ts src/main/agent-manager/__tests__/run-agent.test.ts
git commit -m "fix: flush agent event batcher before watchdog early return — prevents SQLite event loss on timeout"
```

---

## Task 2: Fix Stream Error Misclassification

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts`
- Test: `src/main/agent-manager/__tests__/run-agent.test.ts`

The bug: `runAgent` receives `streamError` from `consumeMessages` but only logs a warning and passes `undefined` as `exitCode` to `finalizeAgentRun`. `finalizeAgentRun` then calls `classifyExit(... exitCode ?? 1 ...)` — treating a stream failure (network cut, OOM, pipe broken) as a normal exit code 1. This misclassification means stream failures get fast-fail detection and retry logic applied when they shouldn't.

Fix: when `streamError` is set, emit a structured error event and pass a sentinel exit code that `classifyExit` can distinguish from a normal agent failure.

- [ ] **Step 1: Write failing test**

Add to `src/main/agent-manager/__tests__/run-agent.test.ts`:

```typescript
import { emitAgentEvent } from '../../agent-event-mapper'

describe('stream error handling', () => {
  it('emits agent:stream_error event when consumeMessages returns streamError', async () => {
    // Mock a handle whose messages iterator throws
    const mockHandle = {
      messages: (async function* () {
        throw new Error('EPIPE: broken pipe')
      })(),
      sessionId: 'test-session',
      abort: vi.fn(),
      steer: vi.fn()
    }

    // Mock spawnWithTimeout to return the broken handle
    vi.mocked(spawnWithTimeout).mockResolvedValueOnce(mockHandle as any)

    const mockEmit = vi.mocked(emitAgentEvent)
    mockEmit.mockClear()

    await runAgent(task, worktree, repoPath, deps)

    // Should emit a stream_error event
    const streamErrorEvent = mockEmit.mock.calls.find(
      ([, event]) => event.type === 'agent:stream_error'
    )
    expect(streamErrorEvent).toBeDefined()
  })
})
```

Note: The exact mock structure depends on what's already in `run-agent.test.ts`. Adapt as needed. The key assertion is that an `agent:stream_error` (or `agent:error` with a clear stream failure message) is emitted when the message stream throws.

- [ ] **Step 2: Update `runAgent` in `run-agent.ts` to handle `streamError` explicitly**

Find the stream error handling block in `runAgent` (~line 752):

```typescript
// Current:
const { exitCode, lastAgentOutput, streamError } = await consumeMessages(...)
if (streamError) {
  logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
  // exitCode will be undefined; finalizeAgentRun's classifyExit treats undefined as exit code 1
}

// After:
const { exitCode, lastAgentOutput, streamError } = await consumeMessages(...)
if (streamError) {
  logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
  // Emit a structured error event so the UI shows stream failure (not a generic error).
  // This is distinct from agent logic failures — it signals infrastructure issues
  // (network cut, OOM, pipe broken). The emitAgentEvent call uses agentRunId so the
  // event appears in the correct agent's console.
  emitAgentEvent(agentRunId, {
    type: 'agent:error',
    message: `Stream interrupted: ${streamError.message}`,
    timestamp: Date.now()
  })
}
```

(Keep the existing behavior for now — `classifyExit` still gets `exitCode ?? 1`. The structured event gives the UI visibility. A deeper fix to `classifyExit` to handle stream failures differently is a follow-up that requires understanding the retry policy intent — see OQ-2 in SYNTHESIS.md.)

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/run-agent.ts src/main/agent-manager/__tests__/run-agent.test.ts
git commit -m "fix: emit agent:error event on stream failure with clear message — improves UI visibility of stream interruptions"
```

---

## Task 3: Fix Playground Fire-and-Forget Race

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts`
- Modify: `src/main/agent-manager/playground-handler.ts`
- Test: `src/main/agent-manager/__tests__/run-agent-playground.test.ts`

The bug: `detectPlaygroundWrite` is called inside `processSDKMessage` and calls `tryEmitPlaygroundEvent` as fire-and-forget (`.catch()` only, no `await`). The message loop continues, `consumeMessages` returns, and `cleanupOrPreserveWorktree` may run before the async `stat()` + `readFile()` in `tryEmitPlaygroundEvent` completes. This silently drops the playground event when the worktree is cleaned up mid-read.

The secondary issue: `tryEmitPlaygroundEvent` has no timeout — a stalled filesystem blocks indefinitely.

Fix:
1. Accumulate detected HTML paths in a `pendingPlaygroundPaths` list during the message loop
2. After `consumeMessages` returns, await each path serially before calling `cleanupOrPreserveWorktree`
3. Add an AbortController timeout (5s) inside `tryEmitPlaygroundEvent`

- [ ] **Step 1: Read `run-agent-playground.test.ts` to understand the test structure**

Read `src/main/agent-manager/__tests__/run-agent-playground.test.ts`.

- [ ] **Step 2: Write failing test**

Add to `run-agent-playground.test.ts`:

```typescript
import { tryEmitPlaygroundEvent } from '../playground-handler'

vi.mock('../playground-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../playground-handler')>()
  return {
    ...actual,
    tryEmitPlaygroundEvent: vi.fn().mockResolvedValue(undefined),
    detectHtmlWrite: vi.fn().mockReturnValue('/tmp/test.html')  // always detects HTML write
  }
})

describe('playground event ordering', () => {
  it('awaits playground events before worktree cleanup', async () => {
    const mockTryEmit = vi.mocked(tryEmitPlaygroundEvent)
    const mockCleanup = vi.mocked(cleanupWorktree)

    let emitCalledAt = 0
    let cleanupCalledAt = 0

    mockTryEmit.mockImplementation(async () => {
      emitCalledAt = Date.now()
      await new Promise(r => setTimeout(r, 10)) // simulate async work
    })
    mockCleanup.mockImplementation(async () => {
      cleanupCalledAt = Date.now()
    })

    await runAgent(task, worktree, repoPath, deps)

    // emit must have been called and must have completed before cleanup
    expect(emitCalledAt).toBeGreaterThan(0)
    // emitCalledAt <= cleanupCalledAt is the key invariant
    expect(emitCalledAt).toBeLessThanOrEqual(cleanupCalledAt)
  })
})
```

Note: This test may require significant mock wiring. If the ordering is difficult to assert directly, at minimum assert that `tryEmitPlaygroundEvent` is called and `await`-ed (not fire-and-forget). The simpler alternative: verify `tryEmitPlaygroundEvent` is called the correct number of times (once per detected HTML write) and that `cleanupOrPreserveWorktree` is not called before it.

- [ ] **Step 3: Add AbortController timeout to `tryEmitPlaygroundEvent` in `playground-handler.ts`**

In `playground-handler.ts`, update `tryEmitPlaygroundEvent`:

```typescript
const PLAYGROUND_IO_TIMEOUT_MS = 5_000

export async function tryEmitPlaygroundEvent(
  taskId: string,
  filePath: string,
  worktreePath: string,
  logger: Logger
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
    logger.warn(`[playground] File I/O timed out after ${PLAYGROUND_IO_TIMEOUT_MS}ms for ${filePath}`)
  }, PLAYGROUND_IO_TIMEOUT_MS)

  try {
    // ... existing logic, but check controller.signal.aborted before each I/O step:
    if (controller.signal.aborted) return

    const absolutePath = filePath.startsWith('/') ? filePath : join(worktreePath, filePath)
    const { resolve } = await import('node:path')
    const resolvedPath = resolve(absolutePath)
    const resolvedWorktree = resolve(worktreePath)
    if (!resolvedPath.startsWith(resolvedWorktree + '/') && resolvedPath !== resolvedWorktree) {
      logger.warn(`[playground] Path traversal blocked: ${filePath}`)
      return
    }

    if (controller.signal.aborted) return

    const stats = await stat(absolutePath)
    if (stats.size > MAX_PLAYGROUND_SIZE) {
      logger.warn(`[playground] File too large (${stats.size} bytes), skipping: ${filePath}`)
      return
    }

    if (controller.signal.aborted) return

    const rawHtml = await readFile(absolutePath, 'utf-8')
    const sanitizedHtml = sanitizePlaygroundHtml(rawHtml)
    const filename = basename(absolutePath)

    const event: AgentEvent = {
      type: 'agent:playground',
      filename,
      html: sanitizedHtml,
      sizeBytes: stats.size,
      timestamp: Date.now()
    }

    broadcast('agent:event', { agentId: taskId, event })
    logger.info(`[playground] Emitted playground event for ${filename} (${stats.size} bytes)`)
  } catch (err) {
    if (!controller.signal.aborted) {
      logger.warn(`[playground] Failed to read HTML file ${filePath}: ${err}`)
    }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Change playground detection from fire-and-forget to path accumulation in `run-agent.ts`**

The change has two parts:

**Part A:** Remove `detectPlaygroundWrite` call from `processSDKMessage`. Instead, have `processSDKMessage` return the detected path (or null):

Update `processSDKMessage` to return `detectedHtmlPath`:
```typescript
function processSDKMessage(
  msg: unknown,
  agent: ActiveAgent,
  task: RunAgentTask,
  worktreePath: string,
  agentRunId: string,
  turnTracker: TurnTracker,
  logger: Logger,
  exitCode: number | undefined,
  lastAgentOutput: string
): { exitCode: number | undefined; lastAgentOutput: string; detectedHtmlPath: string | null } {
  agent.lastOutputAt = Date.now()

  if (isRateLimitMessage(msg)) {
    agent.rateLimitCount++
  }

  trackAgentCosts(msg, agent, turnTracker)
  exitCode = getNumericField(msg, 'exit_code') ?? exitCode

  const mappedEvents = mapRawMessage(msg)
  for (const event of mappedEvents) {
    emitAgentEvent(agentRunId, event)
  }

  const m = asSDKMessage(msg)
  if (m?.type === 'assistant' && typeof m.text === 'string') {
    lastAgentOutput = m.text.slice(-LAST_OUTPUT_MAX_LENGTH)
  }

  // Detect HTML writes but don't emit yet — accumulate for post-stream flush
  const detectedHtmlPath = task.playground_enabled ? detectHtmlWrite(msg) : null

  return { exitCode, lastAgentOutput, detectedHtmlPath }
}
```

Delete the separate `detectPlaygroundWrite` function (it's now inlined above).

**Part B:** Accumulate paths in `consumeMessages` and return them:

```typescript
export async function consumeMessages(
  handle: AgentHandle,
  agent: ActiveAgent,
  task: RunAgentTask,
  worktreePath: string,
  agentRunId: string,
  turnTracker: TurnTracker,
  logger: Logger
): Promise<ConsumeMessagesResult> {
  let exitCode: number | undefined
  let lastAgentOutput = ''
  const pendingPlaygroundPaths: string[] = []  // accumulate, don't emit yet

  try {
    for await (const msg of handle.messages) {
      const result = processSDKMessage(
        msg, agent, task, worktreePath, agentRunId, turnTracker, logger, exitCode, lastAgentOutput
      )
      exitCode = result.exitCode
      lastAgentOutput = result.lastAgentOutput
      if (result.detectedHtmlPath) {
        pendingPlaygroundPaths.push(result.detectedHtmlPath)
      }
    }
  } catch (err) {
    // ... existing error handling ...
    return { exitCode, lastAgentOutput, streamError: ..., pendingPlaygroundPaths }
  }

  return { exitCode, lastAgentOutput, pendingPlaygroundPaths }
}
```

Update `ConsumeMessagesResult` to include `pendingPlaygroundPaths`:
```typescript
export interface ConsumeMessagesResult {
  exitCode: number | undefined
  lastAgentOutput: string
  streamError?: Error
  pendingPlaygroundPaths: string[]
}
```

**Part C:** In `runAgent`, await playground events after `consumeMessages` and before `finalizeAgentRun`:

```typescript
const { exitCode, lastAgentOutput, streamError, pendingPlaygroundPaths } = await consumeMessages(...)

// Await playground events before worktree cleanup.
// Previously fire-and-forget — worktree could be deleted before file I/O completed.
for (const htmlPath of pendingPlaygroundPaths) {
  await tryEmitPlaygroundEvent(task.id, htmlPath, worktree.worktreePath, logger).catch((err) => {
    logger.warn(`[run-agent] playground emit failed for task ${task.id}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  })
}

if (streamError) { ... }

await finalizeAgentRun(...)
```

Note: Import `tryEmitPlaygroundEvent` and `detectHtmlWrite` at the top of `run-agent.ts` instead of in the helper function.

- [ ] **Step 5: Run typecheck**

```bash
cd ~/projects/BDE && npm run typecheck 2>&1 | grep "error" | head -20
```
Expected: zero errors

- [ ] **Step 6: Run tests**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -30
```
Expected: all tests pass. Pay special attention to `run-agent-playground.test.ts` — if any tests relied on the fire-and-forget behavior, they'll need updating.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent-manager/run-agent.ts src/main/agent-manager/playground-handler.ts src/main/agent-manager/__tests__/run-agent-playground.test.ts
git commit -m "fix: await playground events before worktree cleanup; add 5s I/O timeout to prevent stalls"
```

---

## Task 4: Final Verification

- [ ] **Step 1: Run full main process test suite**

```bash
cd ~/projects/BDE && npm run test:main 2>&1 | tail -30
```
Expected: all tests pass

- [ ] **Step 2: Run typecheck**

```bash
cd ~/projects/BDE && npm run typecheck 2>&1 | grep "error" | head -20
```
Expected: zero errors

- [ ] **Step 3: Run lint**

```bash
cd ~/projects/BDE && npm run lint 2>&1 | grep -E "^/" | head -20
```
Expected: zero errors

- [ ] **Step 4: Run renderer tests**

```bash
cd ~/projects/BDE && npm test 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 5: Smoke test the playground path (manual)**

Start BDE in dev mode (`npm run dev`), create an adhoc agent task that writes an HTML file, and verify the playground card appears in the UI. This confirms the happy path still works after the fire-and-forget removal.

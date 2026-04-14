# run-agent.ts God Function Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `spawnAndWireAgent` (125 lines) and `finalizeAgentRun` (153 lines) into focused sub-functions, and fix the silent error swallow in `consumeMessages`.

**Architecture:** All extracted functions stay in `run-agent.ts` as module-level private functions (not exported). The public API surface is unchanged except `ConsumeMessagesResult` gains an optional `streamError` field. Four commits, one per logical concern.

**Tech Stack:** TypeScript, Vitest, Node.js (Electron main process)

---

## File Map

- **Modify:** `src/main/agent-manager/run-agent.ts` — all changes go here; file shrinks from 689 → ~450 lines
- **Modify:** `src/main/agent-manager/__tests__/run-agent.test.ts` — add one new test for `streamError`; existing tests are the regression harness for the refactor steps

---

## Worktree Setup

Before any code changes:

```bash
git worktree add -b chore/run-agent-decomp ~/worktrees/BDE/Users-ryan-projects-BDE/run-agent-decomp main
cd ~/worktrees/BDE/Users-ryan-projects-BDE/run-agent-decomp
```

All work below happens in the worktree.

---

## Task 1: Fix `consumeMessages` — add `streamError` to result type

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts:73-76` (interface), `lines 194-213` (catch block), `lines 665-675` (Phase 3 call site in `runAgent`)
- Modify: `src/main/agent-manager/__tests__/run-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Find the `consumeMessages` test block in `run-agent.test.ts` (search for `'consumeMessages'`). Add this test after existing `consumeMessages` tests:

```typescript
it('returns streamError when message stream throws a non-auth error', async () => {
  const { consumeMessages } = await import('../run-agent')
  const error = new Error('Stream closed unexpectedly')
  const handle = makeErrorHandle(error)
  const agent = { ...makeActiveAgent(), taskId: 'task-1' }
  const deps = makeDeps()
  const result = await consumeMessages(
    handle as any,
    agent,
    makeTask(),
    '/tmp/wt',
    'run-id-1',
    makeTurnTracker(),
    deps.logger
  )
  expect(result.streamError).toBeInstanceOf(Error)
  expect(result.streamError?.message).toBe('Stream closed unexpectedly')
  expect(result.exitCode).toBeUndefined()
})
```

> Note: `makeActiveAgent()` and `makeTurnTracker()` may need to be added as helpers if not already in the test file — check the existing test file for the pattern used for `ActiveAgent` and `TurnTracker` construction.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter=verbose run-agent.test.ts
```

Expected: FAIL — `result.streamError` is `undefined` (not yet implemented)

- [ ] **Step 3: Update the `ConsumeMessagesResult` interface**

In `run-agent.ts` at line 73:

```typescript
export interface ConsumeMessagesResult {
  exitCode: number | undefined
  lastAgentOutput: string
  streamError?: Error  // set if the message stream threw
}
```

- [ ] **Step 4: Update the `consumeMessages` catch block**

Replace the existing catch block (lines ~194–213) so it returns `streamError`:

```typescript
  } catch (err) {
    logError(logger, `[agent-manager] Error consuming messages for task ${task.id}`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    emitAgentEvent(agentRunId, {
      type: 'agent:error',
      message: errMsg,
      timestamp: Date.now()
    })
    if (
      errMsg.includes('Invalid API key') ||
      errMsg.includes('invalid_api_key') ||
      errMsg.includes('authentication')
    ) {
      await handleOAuthRefresh(logger)
    }
    return {
      exitCode,
      lastAgentOutput,
      streamError: err instanceof Error ? err : new Error(errMsg)
    }
  }
```

- [ ] **Step 5: Update Phase 3 call site in `runAgent`**

At line ~665, update destructuring and add a log when `streamError` is set:

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
```

- [ ] **Step 6: Run tests to verify passing**

```bash
npm test -- --reporter=verbose run-agent.test.ts
npm run typecheck
```

Expected: all tests pass, zero type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent-manager/run-agent.ts src/main/agent-manager/__tests__/run-agent.test.ts
git commit -m "fix: add streamError to ConsumeMessagesResult, propagate stream failures"
```

---

## Task 2: Extract `handleSpawnFailure` and `initializeAgentTracking` from `spawnAndWireAgent`

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts` — lines ~351–476 (`spawnAndWireAgent`)

This is a pure refactor — no behavior change. Existing tests are the regression harness.

- [ ] **Step 1: Run baseline tests before touching anything**

```bash
npm test -- --reporter=verbose run-agent.test.ts
```

Expected: all currently-passing tests pass. Note the count.

- [ ] **Step 2: Extract `handleSpawnFailure`**

Insert this private function immediately before `spawnAndWireAgent` (around line 350):

```typescript
/**
 * Handles a spawn failure: runs optional callback, emits error event,
 * updates task to error, triggers terminal handler, cleans up worktree,
 * then re-throws the original error.
 */
async function handleSpawnFailure(
  err: unknown,
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<never> {
  const { logger, repo, onTaskTerminal, onSpawnFailure } = deps
  try {
    onSpawnFailure?.()
  } catch (cbErr) {
    logger.warn(`[agent-manager] onSpawnFailure hook threw: ${cbErr}`)
  }
  logError(logger, `[agent-manager] spawnAgent failed for task ${task.id}`, err)
  const errMsg = err instanceof Error ? err.message : String(err)
  emitAgentEvent(task.id, {
    type: 'agent:error',
    message: `Spawn failed: ${errMsg}`,
    timestamp: Date.now()
  })
  try {
    repo.updateTask(task.id, {
      status: 'error',
      completed_at: nowIso(),
      notes: `Spawn failed: ${errMsg}`,
      claimed_by: null
    })
  } catch (updateErr) {
    logger.warn(
      `[agent-manager] Failed to update task ${task.id} after spawn failure: ${updateErr}`
    )
  }
  await onTaskTerminal(task.id, 'error')
  try {
    await cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
      logger
    })
  } catch (cleanupErr) {
    logger.warn(
      `[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${cleanupErr}`
    )
  }
  throw err
}
```

- [ ] **Step 3: Extract `initializeAgentTracking`**

Insert immediately after `handleSpawnFailure`:

```typescript
/**
 * Wires stderr, builds the ActiveAgent, registers it in the map,
 * persists agent_run_id, fires the agent record, and emits agent:started.
 */
function initializeAgentTracking(
  task: RunAgentTask,
  handle: AgentHandle,
  effectiveModel: string,
  worktree: { worktreePath: string; branch: string },
  prompt: string,
  activeAgents: Map<string, ActiveAgent>,
  repo: ISprintTaskRepository,
  logger: Logger
): { agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker } {
  const agentRunId = randomUUID()

  handle.onStderr = (line: string) => {
    emitAgentEvent(agentRunId, { type: 'agent:stderr', text: line, timestamp: Date.now() })
  }

  const agent: ActiveAgent = {
    taskId: task.id,
    agentRunId,
    handle,
    model: effectiveModel,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: task.max_runtime_ms ?? null,
    maxCostUsd: task.max_cost_usd ?? null
  }
  activeAgents.set(task.id, agent)
  const turnTracker = new TurnTracker(agentRunId)

  try {
    repo.updateTask(task.id, { agent_run_id: agentRunId })
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
  }

  createAgentRecord({
    id: agentRunId,
    pid: null,
    bin: 'claude',
    model: effectiveModel,
    repo: task.repo,
    repoPath: worktree.worktreePath,
    task: prompt,
    startedAt: new Date(agent.startedAt).toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
    source: 'bde',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    cacheRead: null,
    cacheCreate: null,
    sprintTaskId: task.id,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch
  }).catch((err) =>
    logger.warn(`[agent-manager] Failed to create agent record for ${agentRunId}: ${err}`)
  )

  emitAgentEvent(agentRunId, {
    type: 'agent:started',
    model: effectiveModel,
    timestamp: Date.now()
  })

  return { agent, agentRunId, turnTracker }
}
```

- [ ] **Step 4: Replace `spawnAndWireAgent` body with thin orchestrator**

Replace the entire body of `spawnAndWireAgent` (keeping the signature) with:

```typescript
async function spawnAndWireAgent(
  task: RunAgentTask,
  prompt: string,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  effectiveModel: string,
  deps: RunAgentDeps
): Promise<{ agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker }> {
  const { activeAgents, logger, repo, onSpawnSuccess } = deps

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout(prompt, worktree.worktreePath, effectiveModel, logger)
    try {
      onSpawnSuccess?.()
    } catch (cbErr) {
      logger.warn(`[agent-manager] onSpawnSuccess hook threw: ${cbErr}`)
    }
  } catch (err) {
    await handleSpawnFailure(err, task, worktree, repoPath, deps)
    throw err // unreachable — handleSpawnFailure always throws; satisfies TypeScript
  }

  return initializeAgentTracking(task, handle, effectiveModel, worktree, prompt, activeAgents, repo, logger)
}
```

- [ ] **Step 5: Run tests to verify no regression**

```bash
npm test -- --reporter=verbose run-agent.test.ts
npm run typecheck
```

Expected: same test count passes as Step 1 baseline.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/run-agent.ts
git commit -m "refactor: extract handleSpawnFailure and initializeAgentTracking from spawnAndWireAgent"
```

---

## Task 3: Extract `persistAgentRunTelemetry` and `resolveAgentExit` from `finalizeAgentRun`

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts` — lines ~482–635 (`finalizeAgentRun`)

Pure refactor — no behavior change.

- [ ] **Step 1: Run baseline**

```bash
npm test -- --reporter=verbose run-agent.test.ts
```

Note passing count.

- [ ] **Step 2: Extract `persistAgentRunTelemetry`**

Insert immediately before `finalizeAgentRun`:

```typescript
/**
 * Fire-and-forget: updates the agent_runs record and persists cost/token totals.
 * Non-blocking — failures are logged as warnings, not propagated.
 */
function persistAgentRunTelemetry(
  agentRunId: string,
  agent: ActiveAgent,
  exitCode: number | undefined,
  turnTracker: TurnTracker,
  exitedAt: number,
  durationMs: number,
  logger: Logger
): void {
  updateAgentMeta(agentRunId, {
    status: exitCode === 0 ? 'done' : 'failed',
    finishedAt: new Date(exitedAt).toISOString(),
    exitCode: exitCode ?? null,
    costUsd: agent.costUsd,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut
  }).catch((err) =>
    logger.warn(`[agent-manager] Failed to update agent record for ${agentRunId}: ${err}`)
  )

  try {
    const totals = turnTracker.totals()
    updateAgentRunCost(getDb(), agentRunId, {
      costUsd: agent.costUsd ?? 0,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      cacheRead: totals.cacheTokensRead,
      cacheCreate: totals.cacheTokensCreated,
      durationMs,
      numTurns: totals.turnCount
    })
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist cost breakdown for ${agentRunId}: ${err}`)
  }
}
```

- [ ] **Step 3: Extract `resolveAgentExit`**

Insert immediately after `persistAgentRunTelemetry`:

```typescript
/**
 * Classifies the agent exit (fast-fail vs normal) and drives the appropriate
 * task status transition and terminal notification.
 */
async function resolveAgentExit(
  task: RunAgentTask,
  exitCode: number | undefined,
  lastAgentOutput: string,
  agent: ActiveAgent,
  worktree: { worktreePath: string; branch: string },
  repo: ISprintTaskRepository,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  logger: Logger
): Promise<void> {
  const ffResult = classifyExit(agent.startedAt, Date.now(), exitCode ?? 1, task.fast_fail_count ?? 0)
  const now = nowIso()

  if (ffResult === 'fast-fail-exhausted') {
    try {
      repo.updateTask(task.id, {
        status: 'error',
        completed_at: now,
        notes:
          "Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/agent-manager.log for details. To retry: reset task status to 'queued' and clear claimed_by.",
        claimed_by: null,
        needs_review: true
      })
    } catch (err) {
      logger.error(
        `[agent-manager] Failed to update task ${task.id} after fast-fail exhausted: ${err}`
      )
    }
    await onTaskTerminal(task.id, 'error')
  } else if (ffResult === 'fast-fail-requeue') {
    try {
      repo.updateTask(task.id, {
        status: 'queued',
        fast_fail_count: (task.fast_fail_count ?? 0) + 1,
        claimed_by: null
      })
    } catch (err) {
      logger.error(`[agent-manager] Failed to requeue fast-fail task ${task.id}: ${err}`)
    }
  } else {
    try {
      const ghRepo = getGhRepo(task.repo) ?? task.repo
      await resolveSuccess(
        {
          taskId: task.id,
          worktreePath: worktree.worktreePath,
          title: task.title,
          ghRepo,
          onTaskTerminal,
          agentSummary: lastAgentOutput || null,
          retryCount: task.retry_count ?? 0,
          repo
        },
        logger
      )
    } catch (err) {
      logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)
      const isTerminal = resolveFailure(
        { taskId: task.id, retryCount: task.retry_count ?? 0, repo },
        logger
      )
      if (isTerminal) {
        await onTaskTerminal(task.id, 'failed')
      }
    }
  }
}
```

- [ ] **Step 4: Replace the matching sections in `finalizeAgentRun`**

In `finalizeAgentRun`, replace the block from "Update agent run record" through the end of the fast-fail/normal-exit if-else (lines ~525–610) with:

```typescript
  persistAgentRunTelemetry(agentRunId, agent, exitCode, turnTracker, exitedAt, durationMs, logger)
  await resolveAgentExit(task, exitCode, lastAgentOutput, agent, worktree, repo, onTaskTerminal, logger)
```

Keep everything before (emit `agent:completed`, watchdog check) and after (`activeAgents.delete`, worktree cleanup, final log) unchanged.

- [ ] **Step 5: Run tests**

```bash
npm test -- --reporter=verbose run-agent.test.ts
npm run typecheck
```

Expected: same passing count as Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/run-agent.ts
git commit -m "refactor: extract persistAgentRunTelemetry and resolveAgentExit from finalizeAgentRun"
```

---

## Task 4: Extract `cleanupOrPreserveWorktree` from `finalizeAgentRun`

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts` — worktree cleanup block near end of `finalizeAgentRun` (~lines 615–633)

Pure refactor.

- [ ] **Step 1: Extract `cleanupOrPreserveWorktree`**

Insert immediately after `resolveAgentExit`:

```typescript
/**
 * Preserves the worktree if the task moved to 'review' status;
 * otherwise captures a partial diff and removes the worktree.
 */
async function cleanupOrPreserveWorktree(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  repo: ISprintTaskRepository,
  logger: Logger
): Promise<void> {
  const currentTask = repo.getTask(task.id)
  if (currentTask?.status !== 'review') {
    await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
    cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch
    }).catch((err: unknown) => {
      logger.warn(
        `[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${err}`
      )
    })
  } else {
    logger.info(
      `[agent-manager] Preserving worktree for review task ${task.id} at ${worktree.worktreePath}`
    )
  }
}
```

- [ ] **Step 2: Replace the inline cleanup block in `finalizeAgentRun`**

Replace the 15-line worktree-cleanup block (from `const currentTask = repo.getTask(task.id)` through the closing `}`) with:

```typescript
  await cleanupOrPreserveWorktree(task, worktree, repoPath, repo, logger)
```

Also remove the `const { activeAgents, logger, repo, onTaskTerminal } = deps` destructuring if `activeAgents` is now the only field still used in the main body — check that `activeAgents` is still referenced for `.has()` and `.delete()` and keep it in the destructuring if so.

- [ ] **Step 3: Run full test suite**

```bash
npm test -- --reporter=verbose run-agent.test.ts
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 4: Run main-process tests**

```bash
npm run test:main
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/run-agent.ts
git commit -m "refactor: extract cleanupOrPreserveWorktree from finalizeAgentRun"
```

---

## Final Verification

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

All must pass before pushing. Expected final state: `run-agent.ts` is ~450 lines, `spawnAndWireAgent` is ~20 lines, `finalizeAgentRun` is ~25 lines, each a clear 4-step orchestrator.

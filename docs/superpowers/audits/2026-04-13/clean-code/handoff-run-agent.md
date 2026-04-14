# Handoff: `run-agent.ts` God Function Decomposition

**File:** `src/main/agent-manager/run-agent.ts`
**Current size:** 689 lines
**Goal:** Decompose `spawnAndWireAgent` (125 lines) and `finalizeAgentRun` (153 lines) into focused sub-functions; fix the silent error swallow in `consumeMessages`

---

## Current State

The top-level `runAgent()` function is already well-structured — it's a 4-phase orchestrator:
```
Phase 1: validateAndPreparePrompt()  → prompt string
Phase 2: spawnAndWireAgent()         → { agent, agentRunId, turnTracker }
Phase 3: consumeMessages()           → { exitCode, lastAgentOutput }
Phase 4: finalizeAgentRun()          → void
```

The problem is **inside** phases 2 and 4. These two functions are each doing 4-5 distinct things inline.

---

## Problem 1: `spawnAndWireAgent` (lines ~351–476, 125 lines)

### What it currently does
1. **Spawn** — calls `spawnWithTimeout()`, handles spawn failure (emit error event, update task to error, call onTaskTerminal, cleanup worktree, re-throw)
2. **Wire stderr** — attaches `handle.onStderr` callback
3. **Build ActiveAgent** — constructs the `ActiveAgent` object and adds to `activeAgents` map
4. **Persist agent_run_id** — `repo.updateTask(task.id, { agent_run_id: agentRunId })`
5. **Create agent record** — fire-and-forget `createAgentRecord()` with 18 fields
6. **Emit agent:started event**
7. **Return** `{ agent, agentRunId, turnTracker }`

### Target decomposition

```typescript
// Extract spawn failure handler (the 40-line catch block)
async function handleSpawnFailure(
  err: unknown,
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<never> {
  const { logger, repo, onTaskTerminal, onSpawnFailure } = deps
  try { onSpawnFailure?.() } catch (cbErr) {
    logger.warn(`[agent-manager] onSpawnFailure hook threw: ${cbErr}`)
  }
  logError(logger, `[agent-manager] spawnAgent failed for task ${task.id}`, err)
  const errMsg = err instanceof Error ? err.message : String(err)
  emitAgentEvent(task.id, { type: 'agent:error', message: `Spawn failed: ${errMsg}`, timestamp: Date.now() })
  try {
    repo.updateTask(task.id, { status: 'error', completed_at: nowIso(), notes: `Spawn failed: ${errMsg}`, claimed_by: null })
  } catch (updateErr) {
    logger.warn(`[agent-manager] Failed to update task ${task.id} after spawn failure: ${updateErr}`)
  }
  await onTaskTerminal(task.id, 'error')
  try {
    await cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch, logger })
  } catch (cleanupErr) {
    logger.warn(`[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${cleanupErr}`)
  }
  throw err
}

// Extract agent record + event initialization
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
    taskId: task.id, agentRunId, handle, model: effectiveModel,
    startedAt: Date.now(), lastOutputAt: Date.now(),
    rateLimitCount: 0, costUsd: 0, tokensIn: 0, tokensOut: 0,
    maxRuntimeMs: task.max_runtime_ms ?? null, maxCostUsd: task.max_cost_usd ?? null
  }
  activeAgents.set(task.id, agent)
  const turnTracker = new TurnTracker(agentRunId)

  // Persist agent_run_id
  try {
    repo.updateTask(task.id, { agent_run_id: agentRunId })
  } catch (err) {
    logger.warn(`[agent-manager] Failed to persist agent_run_id for task ${task.id}: ${err}`)
  }

  // Create agent record (fire-and-forget — non-critical telemetry)
  createAgentRecord({
    id: agentRunId, pid: null, bin: 'claude', model: effectiveModel,
    repo: task.repo, repoPath: worktree.worktreePath, task: prompt,
    startedAt: new Date(agent.startedAt).toISOString(), finishedAt: null,
    exitCode: null, status: 'running', source: 'bde', costUsd: null,
    tokensIn: null, tokensOut: null, cacheRead: null, cacheCreate: null,
    sprintTaskId: task.id, worktreePath: worktree.worktreePath, branch: worktree.branch
  }).catch((err) => logger.warn(`[agent-manager] Failed to create agent record for ${agentRunId}: ${err}`))

  emitAgentEvent(agentRunId, { type: 'agent:started', model: effectiveModel, timestamp: Date.now() })

  return { agent, agentRunId, turnTracker }
}

// Simplified spawnAndWireAgent becomes:
async function spawnAndWireAgent(
  task, prompt, worktree, repoPath, effectiveModel, deps
): Promise<{ agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker }> {
  const { activeAgents, logger, repo, onSpawnSuccess } = deps

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout(prompt, worktree.worktreePath, effectiveModel, logger)
    try { onSpawnSuccess?.() } catch (cbErr) {
      logger.warn(`[agent-manager] onSpawnSuccess hook threw: ${cbErr}`)
    }
  } catch (err) {
    await handleSpawnFailure(err, task, worktree, repoPath, deps)
    throw err // unreachable but satisfies TypeScript
  }

  return initializeAgentTracking(task, handle, effectiveModel, worktree, prompt, activeAgents, repo, logger)
}
```

**Net result:** `spawnAndWireAgent` goes from 125 lines to ~20 lines of readable orchestration.

---

## Problem 2: `finalizeAgentRun` (lines ~482–635, 153 lines)

### What it currently does
1. **Emit completion event** — `agent:completed` with cost/token/duration
2. **Watchdog early-exit guard** — if watchdog already cleaned up, capture diff + cleanup worktree and return
3. **Update agent run record** — fire-and-forget `updateAgentMeta()`
4. **Persist cost breakdown** — `updateAgentRunCost()` with token totals
5. **Classify exit** — `classifyExit()` → `fast-fail-exhausted` | `fast-fail-requeue` | normal
6. **Handle fast-fail-exhausted** — update task to error, call onTaskTerminal
7. **Handle fast-fail-requeue** — update task to queued
8. **Handle normal exit** — `resolveSuccess()`, fallback to `resolveFailure()` + onTaskTerminal
9. **Remove from activeAgents**
10. **Conditional worktree cleanup** — preserve for review tasks, cleanup otherwise

### Target decomposition

```typescript
// Extract telemetry persistence (fire-and-forget, non-blocking)
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
  }).catch((err) => logger.warn(`[agent-manager] Failed to update agent record for ${agentRunId}: ${err}`))

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

// Extract exit classification + task resolution
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
        status: 'error', completed_at: now,
        notes: "Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/agent-manager.log for details. To retry: reset task status to 'queued' and clear claimed_by.",
        claimed_by: null, needs_review: true
      })
    } catch (err) {
      logger.error(`[agent-manager] Failed to update task ${task.id} after fast-fail exhausted: ${err}`)
    }
    await onTaskTerminal(task.id, 'error')
  } else if (ffResult === 'fast-fail-requeue') {
    try {
      repo.updateTask(task.id, { status: 'queued', fast_fail_count: (task.fast_fail_count ?? 0) + 1, claimed_by: null })
    } catch (err) {
      logger.error(`[agent-manager] Failed to requeue fast-fail task ${task.id}: ${err}`)
    }
  } else {
    try {
      const ghRepo = getGhRepo(task.repo) ?? task.repo
      await resolveSuccess({ taskId: task.id, worktreePath: worktree.worktreePath, title: task.title, ghRepo, onTaskTerminal, agentSummary: lastAgentOutput || null, retryCount: task.retry_count ?? 0, repo }, logger)
    } catch (err) {
      logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)
      const isTerminal = resolveFailure({ taskId: task.id, retryCount: task.retry_count ?? 0, repo }, logger)
      if (isTerminal) await onTaskTerminal(task.id, 'failed')
    }
  }
}

// Extract worktree conditional cleanup
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
    cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
      .catch((err: unknown) => {
        logger.warn(`[agent-manager] Stale worktree for task ${task.id} at ${worktree.worktreePath} — manual cleanup needed: ${err}`)
      })
  } else {
    logger.info(`[agent-manager] Preserving worktree for review task ${task.id} at ${worktree.worktreePath}`)
  }
}

// Simplified finalizeAgentRun becomes:
async function finalizeAgentRun(task, worktree, repoPath, agent, agentRunId, turnTracker, exitCode, lastAgentOutput, deps): Promise<void> {
  const { activeAgents, logger, repo, onTaskTerminal } = deps
  const exitedAt = Date.now()
  const durationMs = exitedAt - agent.startedAt

  emitAgentEvent(agentRunId, { type: 'agent:completed', exitCode: exitCode ?? 0, costUsd: agent.costUsd, tokensIn: agent.tokensIn, tokensOut: agent.tokensOut, durationMs, timestamp: exitedAt })

  // Watchdog already cleaned up
  if (!activeAgents.has(task.id)) {
    logger.info(`[agent-manager] Agent ${task.id} already cleaned up by watchdog`)
    await capturePartialDiff(task.id, worktree.worktreePath, repo, logger)
    cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch })
      .catch((err: unknown) => logger.warn(`[agent-manager] Stale worktree for task ${task.id}: ${err}`))
    return
  }

  persistAgentRunTelemetry(agentRunId, agent, exitCode, turnTracker, exitedAt, durationMs, logger)
  await resolveAgentExit(task, exitCode, lastAgentOutput, agent, worktree, repo, onTaskTerminal, logger)

  activeAgents.delete(task.id)
  await cleanupOrPreserveWorktree(task, worktree, repoPath, repo, logger)

  logger.info(`[agent-manager] Agent completed for task ${task.id}`)
}
```

**Net result:** `finalizeAgentRun` goes from 153 lines to ~25 lines of readable orchestration.

---

## Problem 3: `consumeMessages` swallows stream errors (existing bug, fix while here)

**Current behavior:** Stream failures log + emit an error event but return `{ exitCode: undefined, lastAgentOutput: '' }` — identical to a successful stream. `finalizeAgentRun` cannot distinguish "agent exited normally" from "stream broke mid-run."

**Fix:** Return a discriminated result:

```typescript
export interface ConsumeMessagesResult {
  exitCode: number | undefined
  lastAgentOutput: string
  streamError?: Error  // NEW: set if the message stream threw
}

// In consumeMessages catch block:
} catch (err) {
  logError(logger, `[agent-manager] Error consuming messages for task ${task.id}`, err)
  const errMsg = err instanceof Error ? err.message : String(err)
  emitAgentEvent(agentRunId, { type: 'agent:error', message: errMsg, timestamp: Date.now() })
  if (errMsg.includes('Invalid API key') || errMsg.includes('invalid_api_key') || errMsg.includes('authentication')) {
    await handleOAuthRefresh(logger)
  }
  return { exitCode, lastAgentOutput, streamError: err instanceof Error ? err : new Error(errMsg) }
}
```

In `runAgent()` (Phase 3), after `consumeMessages`:
```typescript
const { exitCode, lastAgentOutput, streamError } = await consumeMessages(...)
if (streamError) {
  // Stream broke — treat as agent failure (classify via fast-fail logic)
  logger.warn(`[agent-manager] Message stream failed for task ${task.id}: ${streamError.message}`)
  // exitCode will be undefined; finalizeAgentRun's classifyExit will treat as exit code 1
}
```

This is a behavior change but a correct one — stream failures should follow the same retry/failure path as other exits.

---

## File placement

All three extracted functions can stay in `run-agent.ts` as module-level private functions (not exported). The file will shrink from 689 lines to ~450 with clearer phase boundaries.

If preferred, the extracted functions can move to a new `run-agent-phases.ts` file and be imported. This is optional — the main goal is function-level clarity, not file count.

---

## Testing

```bash
npm run typecheck
npm test
npm run test:main
```

Test file: `src/main/agent-manager/__tests__/run-agent.test.ts` (if exists). The exported interface `ConsumeMessagesResult` changes shape — if tests check the return type, update them to expect the optional `streamError` field.

The `runAgent` function signature is unchanged. `consumeMessages` signature is unchanged but return type gains `streamError`. `validateTaskForRun`, `fetchUpstreamContext`, `readPriorScratchpad`, `assembleRunContext` are already well-extracted — don't touch them.

---

## Commit Plan

1. `fix: add streamError to ConsumeMessagesResult, propagate stream failures` ← do first (safe, additive)
2. `refactor: extract handleSpawnFailure and initializeAgentTracking from spawnAndWireAgent`
3. `refactor: extract persistAgentRunTelemetry and resolveAgentExit from finalizeAgentRun`
4. `refactor: extract cleanupOrPreserveWorktree from finalizeAgentRun`

---

## Worktree Setup

```bash
git worktree add -b chore/run-agent-decomp ~/worktrees/BDE/Users-ryan-projects-BDE/run-agent-decomp main
```

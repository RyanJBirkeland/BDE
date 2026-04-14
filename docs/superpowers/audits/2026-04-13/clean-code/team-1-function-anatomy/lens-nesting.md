# Nesting & Control Flow Lens - BDE Clean Code Audit
**Date:** 2026-04-13  
**Analyst:** Nesting & Flow Specialist  
**Scope:** Agent manager, completion handlers, sprint service handlers, event mapping

This lens identifies deep nesting, complex conditionals, early-return opportunities, and callback patterns that degrade readability and maintainability.

---

## F-t1-nesting-1: Multi-level guard nesting in resolveSuccess
**Severity:** High  
**Category:** Deep Nesting | Missing Guard Clause  
**Location:** `src/main/agent-manager/completion.ts:349-454`

**Evidence:**
```typescript
export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, onTaskTerminal, agentSummary, retryCount, repo } = opts
  const env = buildAgentEnv()

  // 0. Guard: worktree must still exist
  if (!existsSync(worktreePath)) {
    await failTaskWithError(...)
    return
  }

  // 1. Detect current branch
  let branch: string
  try {
    branch = await detectBranch(worktreePath)
  } catch (err) {
    await failTaskWithError(...)
    return
  }

  if (!branch) {
    await failTaskWithError(...)
    return
  }

  // 2. Auto-commit...
  try {
    await autoCommitIfDirty(...)
  } catch (err) {
    logger.warn(...)
  }

  // 3. Rebase...
  let rebaseNote: string | undefined
  let rebaseBaseSha: string | undefined
  let rebaseSucceeded = false
  try {
    const rebaseResult = await rebaseOntoMain(...)
    if (!rebaseResult.success) {
      rebaseNote = rebaseResult.notes
    } else {
      rebaseBaseSha = rebaseResult.baseSha
      rebaseSucceeded = true
    }
  } catch (err) {
    logger.warn(...)
    rebaseNote = 'Rebase onto main failed...'
  }

  // 4. Check commits
  const hasCommits = await hasCommitsAheadOfMain({...})
  if (!hasCommits) {
    return
  }

  // 5. Transition to review
  await transitionToReview({...})

  // 6. Auto-merge
  await attemptAutoMerge({...})
}
```

**Impact:** The function has 6 sequential if/try-catch blocks nested 1-2 levels deep. While early returns exit cleanly, each block must be mentally parsed for its success/failure path. The rebase block introduces conditional state assignment (3 variables) that's harder to reason about. A reader must scroll through 105 lines to understand the full happy path.

**Recommendation:**
Extract each step into named helper functions that either succeed or throw. This makes the happy path explicit:
```typescript
export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, onTaskTerminal, agentSummary, retryCount, repo } = opts
  const env = buildAgentEnv()

  const branch = await validateWorktreeAndBranch(taskId, worktreePath, repo, logger, onTaskTerminal)
  if (!branch) return // Early exit on guard failure

  await autoCommitIfDirty(worktreePath, title, logger)

  const rebaseInfo = await performRebase(taskId, worktreePath, env, logger)

  const hasCommits = await validateCommitsExist(taskId, branch, worktreePath, agentSummary, retryCount, repo, logger, onTaskTerminal)
  if (!hasCommits) return

  await transitionToReview({ taskId, worktreePath, ...rebaseInfo, repo, logger })
  await attemptAutoMerge({ taskId, title, branch, worktreePath, repo, logger, onTaskTerminal })
}

// Extracted: combine guards into one function
async function validateWorktreeAndBranch(...): Promise<string | null> {
  if (!existsSync(worktreePath)) {
    await failTaskWithError(...)
    return null
  }
  let branch: string
  try {
    branch = await detectBranch(worktreePath)
  } catch (err) {
    await failTaskWithError(...)
    return null
  }
  if (!branch) {
    await failTaskWithError(...)
    return null
  }
  return branch
}

// Extracted: rebase returns structured result
async function performRebase(...): Promise<{ note?: string; baseSha?: string; succeeded: boolean }> {
  try {
    const result = await rebaseOntoMain(...)
    return {
      note: result.success ? undefined : result.notes,
      baseSha: result.success ? result.baseSha : undefined,
      succeeded: result.success
    }
  } catch (err) {
    logger.warn(...)
    return {
      note: 'Rebase onto main failed — manual conflict resolution needed.',
      succeeded: false
    }
  }
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-nesting-2: Nested Promise.allSettled in sprint-pr-poller
**Severity:** Medium  
**Category:** Callback Pyramid | Deep Nesting  
**Location:** `src/main/sprint-pr-poller.ts:68-112`

**Evidence:**
```typescript
if (result.merged) {
  const ids = deps.markTaskDoneByPrNumber(prNumber)
  log.info(`[sprint-pr-poller] PR #${prNumber} merged...`)
  {
    const promises = ids.map((id) => {
      log.info(`[sprint-pr-poller] Calling onTaskTerminal(${id}, 'done')`)
      return Promise.resolve(deps.onTaskTerminal(id, 'done'))
    })
    const results = await Promise.allSettled(promises)
    const failed = results
      .map((r, i) =>
        r.status === 'rejected' ? { id: ids[i], reason: String(r.reason) } : null
      )
      .filter(Boolean)
    if (failed.length > 0) {
      log.warn(
        `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed)}`
      )
    }
  }
} else if (result.state === 'CLOSED') {
  const ids = deps.markTaskCancelledByPrNumber(prNumber)
  if (ids.length > 0) {
    log.info(`[sprint-pr-poller] PR #${prNumber} closed...`)
    {
      const promises = ids.map((id) =>
        Promise.resolve(deps.onTaskTerminal(id, 'cancelled'))
      )
      const results = await Promise.allSettled(promises)
      const failed = results
        .map((r, i) =>
          r.status === 'rejected' ? { id: ids[i], reason: String(r.reason) } : null
        )
        .filter(Boolean)
      if (failed.length > 0) {
        log.warn(
          `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed)}`
        )
      }
    }
  }
}
```

**Impact:** The block-scoped `{ ... }` creates unnecessary visual nesting and repetition. The pattern (map → allSettled → filter → warn) appears twice with identical logic, suggesting a missing abstraction. The nesting is 3-4 levels deep in places, making it hard to see the two cases are nearly identical.

**Recommendation:**
Extract the common pattern and deduplicate:
```typescript
async function notifyTaskTerminalBatch(
  ids: string[],
  status: 'done' | 'cancelled',
  onTaskTerminal: (id: string, status: string) => Promise<void>,
  log: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<void> {
  if (ids.length === 0) return

  const promises = ids.map((id) => Promise.resolve(onTaskTerminal(id, status)))
  const results = await Promise.allSettled(promises)
  const failed = results
    .map((r, i) => r.status === 'rejected' ? { id: ids[i], reason: String(r.reason) } : null)
    .filter(Boolean)
  
  if (failed.length > 0) {
    log.warn(
      `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed)}`
    )
  }
}

// In poll():
if (result.merged) {
  const ids = deps.markTaskDoneByPrNumber(prNumber)
  log.info(`[sprint-pr-poller] PR #${prNumber} merged...`)
  await notifyTaskTerminalBatch(ids, 'done', deps.onTaskTerminal, log)
} else if (result.state === 'CLOSED') {
  const ids = deps.markTaskCancelledByPrNumber(prNumber)
  log.info(`[sprint-pr-poller] PR #${prNumber} closed...`)
  await notifyTaskTerminalBatch(ids, 'cancelled', deps.onTaskTerminal, log)
}
```

**Effort:** S  
**Confidence:** High

---

## F-t1-nesting-3: Implicit guard pattern in spawnAndWireAgent
**Severity:** High  
**Category:** Deep Nesting | Missing Guard Clause  
**Location:** `src/main/agent-manager/run-agent.ts:351-476`

**Evidence:**
```typescript
async function spawnAndWireAgent(
  task: RunAgentTask,
  prompt: string,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  effectiveModel: string,
  deps: RunAgentDeps
): Promise<{ agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker }> {
  const { activeAgents, logger, repo, onTaskTerminal, onSpawnSuccess, onSpawnFailure } = deps

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout(prompt, worktree.worktreePath, effectiveModel, logger)
    try {
      onSpawnSuccess?.()
    } catch (cbErr) {
      logger.warn(`[agent-manager] onSpawnSuccess hook threw: ${cbErr}`)
    }
  } catch (err) {
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
      logger.warn(...)
    }
    await onTaskTerminal(task.id, 'error')
    try {
      await cleanupWorktree({...})
    } catch (cleanupErr) {
      logger.warn(...)
    }
    throw err
  }

  // ... 40 lines of successful initialization ...
}
```

**Impact:** The function has an enormous catch block (lines 369-407) that spans 38 lines with 3-4 nested try-catch blocks. The catch block calls multiple callbacks, updates the repo, emits events, and cleans up — all interspersed with error logging. The successful path is only reached after parsing through a wall of error handling. This is the "inside-out" anti-pattern where error recovery is more complex than the happy path.

**Recommendation:**
Extract the error path into a separate function that is called directly when spawn fails:
```typescript
async function spawnAndWireAgent(
  task: RunAgentTask,
  prompt: string,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  effectiveModel: string,
  deps: RunAgentDeps
): Promise<{ agent: ActiveAgent; agentRunId: string; turnTracker: TurnTracker }> {
  const { activeAgents, logger, repo, onTaskTerminal, onSpawnSuccess, onSpawnFailure } = deps

  let handle: AgentHandle
  try {
    handle = await spawnWithTimeout(prompt, worktree.worktreePath, effectiveModel, logger)
    tryCallback(onSpawnSuccess, logger)
  } catch (err) {
    await handleSpawnFailure(task, err, worktree, repoPath, repo, onTaskTerminal, onSpawnFailure, logger)
    throw err
  }

  // ... 40 lines of successful initialization ...
}

async function handleSpawnFailure(
  task: RunAgentTask,
  err: unknown,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  repo: ISprintTaskRepository,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  onSpawnFailure: (() => void) | undefined,
  logger: Logger
): Promise<void> {
  tryCallback(onSpawnFailure, logger)
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
    logger.warn(`[agent-manager] Failed to update task ${task.id} after spawn failure: ${updateErr}`)
  }
  
  await onTaskTerminal(task.id, 'error')
  
  try {
    await cleanupWorktree({ repoPath, worktreePath: worktree.worktreePath, branch: worktree.branch, logger })
  } catch (cleanupErr) {
    logger.warn(`[agent-manager] Stale worktree for task ${task.id} — manual cleanup needed: ${cleanupErr}`)
  }
}

function tryCallback(cb: (() => void) | undefined, logger: Logger): void {
  if (!cb) return
  try {
    cb()
  } catch (err) {
    logger.warn(`[agent-manager] Callback threw: ${err}`)
  }
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-nesting-4: Nested early returns in _processQueuedTask
**Severity:** Medium  
**Category:** Deep Nesting | Missing Guard Clause  
**Location:** `src/main/agent-manager/index.ts:348-437`

**Evidence:**
```typescript
async _processQueuedTask(
  raw: Record<string, unknown>,
  taskStatusMap: Map<string, string>
): Promise<void> {
  const taskId = raw.id as string
  if (this._processingTasks.has(taskId)) return
  this._processingTasks.add(taskId)
  try {
    const task = mapQueuedTask(raw, this.logger)
    if (!task) return // Skip tasks with invalid fields

    const rawDeps = raw.dependsOn ?? raw.depends_on
    if (rawDeps && checkAndBlockDeps(task.id, rawDeps, taskStatusMap, this.repo, this._depIndex, this.logger)) return

    const repoPath = this.resolveRepoPath(task.repo)
    if (!repoPath) {
      this.logger.warn(
        `[agent-manager] No repo path for "${task.repo}" — setting task ${task.id} to error`
      )
      try {
        this.repo.updateTask(task.id, {
          status: 'error',
          notes: `Repo "${task.repo}" is not configured...`,
          claimed_by: null
        })
      } catch (err) {
        this.logger.warn(
          `[agent-manager] Failed to update task ${task.id} after repo resolution failure: ${err}`
        )
      }
      await this.onTaskTerminal(task.id, 'error').catch((err) =>
        this.logger.warn(`[agent-manager] onTerminal failed for ${task.id}: ${err}`)
      )
      return
    }

    const claimed = this.claimTask(task.id)
    if (!claimed) {
      this.logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
      return
    }

    // Refresh snapshot: re-fetch statuses...
    try {
      const freshTasks = this.repo.getTasksWithDependencies()
      taskStatusMap.clear()
      for (const t of freshTasks) {
        taskStatusMap.set(t.id, t.status)
      }
    } catch {
      // non-fatal: stale map is better than aborting the drain
    }

    let wt: { worktreePath: string; branch: string }
    try {
      wt = await setupWorktree({...})
    } catch (err) {
      logError(this.logger, `[agent-manager] setupWorktree failed for task ${task.id}`, err)
      const errMsg = err instanceof Error ? err.message : String(err)
      const fullNote = `Worktree setup failed: ${errMsg}`
      const notes =
        fullNote.length > NOTES_MAX_LENGTH
          ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3))
          : fullNote
      this.repo.updateTask(task.id, {
        status: 'error',
        completed_at: nowIso(),
        notes,
        claimed_by: null
      })
      await this.onTaskTerminal(task.id, 'error').catch((err) =>
        this.logger.warn(`[agent-manager] onTerminal failed for ${task.id}: ${err}`)
      )
      return
    }

    this._spawnAgent(task, wt, repoPath)
  } finally {
    this._processingTasks.delete(taskId)
  }
}
```

**Impact:** The function has 5 early returns at different nesting levels (lines 354, 357, 360, 385, 432). Each return is guarded by an if statement, and some guards have side effects (updating task status, calling onTaskTerminal). The reader must track multiple exit points and their conditions. The "repo not found" handler (lines 362-382) is particularly dense with nested try-catch and error handling.

**Recommendation:**
Extract validation guards into separate boolean functions and reorder to exit early:
```typescript
async _processQueuedTask(
  raw: Record<string, unknown>,
  taskStatusMap: Map<string, string>
): Promise<void> {
  const taskId = raw.id as string
  if (this._processingTasks.has(taskId)) return
  this._processingTasks.add(taskId)
  
  try {
    const task = mapQueuedTask(raw, this.logger)
    if (!task) return

    if (checkAndBlockDeps(task.id, raw.dependsOn ?? raw.depends_on, taskStatusMap, this.repo, this._depIndex, this.logger)) {
      return
    }

    const repoPath = this.resolveRepoPath(task.repo)
    if (!repoPath) {
      await this._handleMissingRepo(task.id, task.repo)
      return
    }

    if (!this.claimTask(task.id)) {
      this.logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
      return
    }

    this._refreshTaskStatusMap(taskStatusMap)

    const wt = await this._setupWorktreeOrFail(task.id)
    if (!wt) return

    this._spawnAgent(task, wt, repoPath)
  } finally {
    this._processingTasks.delete(taskId)
  }
}

private async _handleMissingRepo(taskId: string, repo: string): Promise<void> {
  this.logger.warn(`[agent-manager] No repo path for "${repo}" — setting task ${taskId} to error`)
  try {
    this.repo.updateTask(taskId, {
      status: 'error',
      notes: `Repo "${repo}" is not configured in BDE settings. Add it in Settings > Repos, then reset this task to queued.`,
      claimed_by: null
    })
  } catch (err) {
    this.logger.warn(`[agent-manager] Failed to update task ${taskId} after repo resolution failure: ${err}`)
  }
  await this.onTaskTerminal(taskId, 'error').catch((err) =>
    this.logger.warn(`[agent-manager] onTerminal failed for ${taskId}: ${err}`)
  )
}

private async _setupWorktreeOrFail(taskId: string): Promise<{ worktreePath: string; branch: string } | null> {
  try {
    return await setupWorktree({...})
  } catch (err) {
    logError(this.logger, `[agent-manager] setupWorktree failed for task ${taskId}`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    const fullNote = `Worktree setup failed: ${errMsg}`
    const notes = fullNote.length > NOTES_MAX_LENGTH ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3)) : fullNote
    this.repo.updateTask(taskId, {
      status: 'error',
      completed_at: nowIso(),
      notes,
      claimed_by: null
    })
    await this.onTaskTerminal(taskId, 'error').catch((err) =>
      this.logger.warn(`[agent-manager] onTerminal failed for ${taskId}: ${err}`)
    )
    return null
  }
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-nesting-5: Nested conditionals in batch handler update logic
**Severity:** Medium  
**Category:** Deep Nesting | Complex Boolean  
**Location:** `src/main/handlers/sprint-batch-handlers.ts:42-84`

**Evidence:**
```typescript
try {
  if (op === 'update') {
    if (!patch || typeof patch !== 'object') {
      results.push({
        id,
        op: 'update',
        ok: false,
        error: 'patch object required for update'
      })
      continue
    }
    const filtered: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (GENERAL_PATCH_FIELDS.has(k)) filtered[k] = v
    }
    if (Object.keys(filtered).length === 0) {
      results.push({ id, op: 'update', ok: false, error: 'No valid fields to update' })
      continue
    }

    // If transitioning to queued, validate spec quality
    if (filtered.status === 'queued') {
      const task = getTask(id)
      if (task) {
        try {
          const specText = (filtered.spec as string) ?? task.spec ?? null
          await validateTaskSpec({
            title: task.title,
            repo: task.repo,
            spec: specText,
            context: 'queue'
          })
        } catch (err) {
          results.push({
            id,
            op: 'update',
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
          continue
        }
      }
    }

    // updateTask (service) handles notifySprintMutation internally
    const updated = updateTask(id, filtered)
    if (
      updated &&
      filtered.status &&
      typeof filtered.status === 'string' &&
      TERMINAL_STATUSES.has(filtered.status)
    ) {
      deps.onStatusTerminal(id, filtered.status)
    }
    results.push({
      id,
      op: 'update',
      ok: !!updated,
      error: updated ? undefined : 'Task not found'
    })
  } else if (op === 'delete') {
    // deleteTask (service) handles notifySprintMutation internally
    deleteTask(id)
    results.push({ id, op: 'delete', ok: true })
  } else {
    results.push({ id, op, ok: false, error: `Unknown operation: ${op}` })
  }
} catch (err) {
  results.push({ id, op, ok: false, error: String(err) })
}
```

**Impact:** 4 levels of nesting: try-if-if-if-if. Multiple conditional checks (not patch, filtered.length === 0, filtered.status === 'queued', task exists) create a branching pyramid. The terminal status check uses a complex boolean (`updated && filtered.status && typeof filtered.status === 'string' && TERMINAL_STATUSES.has(filtered.status)`). Early continues are used, but they're buried in the middle of logic.

**Recommendation:**
Extract validation and guard checks to the top level:
```typescript
try {
  if (op === 'update') {
    const validationResult = validateUpdateOperation(id, patch, filtered)
    if (!validationResult.ok) {
      results.push(validationResult)
      continue
    }

    const filteredPatch = validationResult.patch!
    
    // Only validate spec on queued transition
    if (filteredPatch.status === 'queued') {
      const specError = await validateSpecIfQueued(id, filteredPatch)
      if (specError) {
        results.push(specError)
        continue
      }
    }

    const updated = updateTask(id, filteredPatch)
    const isTerminalUpdate = isTerminalStatus(updated, filteredPatch.status)
    
    if (isTerminalUpdate) {
      deps.onStatusTerminal(id, filteredPatch.status as string)
    }

    results.push({
      id,
      op: 'update',
      ok: !!updated,
      error: updated ? undefined : 'Task not found'
    })
  } else if (op === 'delete') {
    // ...
  }
} catch (err) {
  results.push({ id, op, ok: false, error: String(err) })
}

// Extract validators
function validateUpdateOperation(id: string, patch: unknown, filtered: Record<string, unknown>) {
  if (!patch || typeof patch !== 'object') {
    return { ok: false, id, op: 'update' as const, error: 'patch object required for update' }
  }
  if (Object.keys(filtered).length === 0) {
    return { ok: false, id, op: 'update' as const, error: 'No valid fields to update' }
  }
  return { ok: true, patch: filtered }
}

async function validateSpecIfQueued(id: string, patch: Record<string, unknown>) {
  if (patch.status !== 'queued') return null
  
  const task = getTask(id)
  if (!task) return null

  try {
    const specText = (patch.spec as string) ?? task.spec ?? null
    await validateTaskSpec({ title: task.title, repo: task.repo, spec: specText, context: 'queue' })
    return null
  } catch (err) {
    return {
      ok: false,
      id,
      op: 'update' as const,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function isTerminalStatus(updated: unknown, status: unknown): boolean {
  return updated && typeof status === 'string' && TERMINAL_STATUSES.has(status)
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-nesting-6: Deeply nested task classification in classifyFailureReason
**Severity:** Low  
**Category:** Complex Boolean | Deep Nesting  
**Location:** `src/main/agent-manager/completion.ts:287-347`

**Evidence:**
```typescript
export function classifyFailureReason(notes: string | undefined): FailureReason {
  if (!notes) return 'unknown'

  const lowerNotes = notes.toLowerCase()

  // Auth failures
  if (
    lowerNotes.includes('invalid api key') ||
    lowerNotes.includes('authentication failed') ||
    lowerNotes.includes('unauthorized') ||
    lowerNotes.includes('token expired') ||
    lowerNotes.includes('invalid token')
  ) {
    return 'auth'
  }

  // Timeout failures
  if (
    lowerNotes.includes('exceeded maximum runtime') ||
    lowerNotes.includes('timeout') ||
    lowerNotes.includes('timed out') ||
    lowerNotes.includes('watchdog')
  ) {
    return 'timeout'
  }

  // Test failures
  if (
    lowerNotes.includes('npm test failed') ||
    lowerNotes.includes('test failed') ||
    lowerNotes.includes('vitest failed') ||
    lowerNotes.includes('jest failed') ||
    lowerNotes.includes('tests failed')
  ) {
    return 'test_failure'
  }

  // ... 3 more similar blocks ...

  return 'unknown'
}
```

**Impact:** While individual if-statements are not deeply nested, the function has 6 sequential if-clauses with multi-line boolean conditions (5-6 OR'd conditions each). Each clause tests the same string independently, making the logic repetitive. A new failure type requires scanning through all existing blocks and then adding a new one.

**Recommendation:**
Extract the pattern matching into a data-driven structure:
```typescript
const FAILURE_PATTERNS: Array<{ type: FailureReason; keywords: string[] }> = [
  {
    type: 'auth',
    keywords: ['invalid api key', 'authentication failed', 'unauthorized', 'token expired', 'invalid token']
  },
  {
    type: 'timeout',
    keywords: ['exceeded maximum runtime', 'timeout', 'timed out', 'watchdog']
  },
  {
    type: 'test_failure',
    keywords: ['npm test failed', 'test failed', 'vitest failed', 'jest failed', 'tests failed']
  },
  {
    type: 'compilation',
    keywords: ['compilation error', 'compilation failed', 'tsc failed', 'typescript error', 'type error', 'build failed']
  },
  {
    type: 'spawn',
    keywords: ['spawn failed', 'failed to spawn', 'enoent', 'command not found']
  }
]

export function classifyFailureReason(notes: string | undefined): FailureReason {
  if (!notes) return 'unknown'
  
  const lowerNotes = notes.toLowerCase()
  for (const { type, keywords } of FAILURE_PATTERNS) {
    if (keywords.some((kw) => lowerNotes.includes(kw))) {
      return type
    }
  }
  return 'unknown'
}
```

**Effort:** S  
**Confidence:** High

---

## F-t1-nesting-7: Sequential task status filter in SprintPipeline
**Severity:** Medium  
**Category:** Missing Guard Clause | Arrow Anti-Pattern  
**Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:172-183`

**Evidence:**
```typescript
const conflictingTasks = useMemo(
  () =>
    tasks.filter(
      (t) =>
        t.pr_url &&
        t.pr_number &&
        t.pr_mergeable_state === 'dirty' &&
        (t.status === 'active' || t.status === 'done')
    ),
  [tasks]
)
```

**Impact:** While not deeply nested, the filter predicate has 4 conditions (2 truthy checks, 1 equality, 1 OR). The logic drifts rightward with the OR subclause, and the predicate mixes null-checks with status checks without logical grouping. Extracting named predicates would clarify intent.

**Recommendation:**
Extract the predicate into a named function:
```typescript
const isConflictingTask = (t: SprintTask): boolean => {
  const hasPrMetadata = !!t.pr_url && !!t.pr_number
  const hasMergeConflict = t.pr_mergeable_state === 'dirty'
  const isActiveOrDone = t.status === 'active' || t.status === 'done'
  return hasPrMetadata && hasMergeConflict && isActiveOrDone
}

const conflictingTasks = useMemo(
  () => tasks.filter(isConflictingTask),
  [tasks]
)
```

**Effort:** S  
**Confidence:** Medium

---

## Summary

| ID | Severity | Category | File | Issue |
|---|---|---|---|---|
| F-t1-nesting-1 | High | Deep Nesting | completion.ts | Multi-level guard nesting in resolveSuccess (6 blocks, 105 lines) |
| F-t1-nesting-2 | Medium | Callback Pyramid | sprint-pr-poller.ts | Duplicated Promise.allSettled pattern (2 branches, 3-4 level nesting) |
| F-t1-nesting-3 | High | Deep Nesting | run-agent.ts | Massive catch block in spawnAndWireAgent (38 lines, nested error recovery) |
| F-t1-nesting-4 | Medium | Deep Nesting | index.ts | 5 early returns in _processQueuedTask (multiple exit points, nested guards) |
| F-t1-nesting-5 | Medium | Deep Nesting | sprint-batch-handlers.ts | Nested conditionals in batch update (4 levels, complex boolean) |
| F-t1-nesting-6 | Low | Complex Boolean | completion.ts | 6 parallel if-clauses in classifyFailureReason (repetitive pattern matching) |
| F-t1-nesting-7 | Medium | Arrow Anti-Pattern | SprintPipeline.tsx | Complex filter predicate with OR logic (rightward drift) |

**High-priority targets:** F-t1-nesting-1 and F-t1-nesting-3 represent the highest readability impact. Both combine deep nesting with extensive error handling that obscures the happy path.

**Quick wins:** F-t1-nesting-2, F-t1-nesting-6, and F-t1-nesting-7 can be refactored in 1-2 hours each with high confidence.


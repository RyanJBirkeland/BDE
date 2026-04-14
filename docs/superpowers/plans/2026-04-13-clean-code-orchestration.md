# Clean Code: Agent Orchestration Decomposition Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose BDE's remaining agent orchestration god-classes and god-functions into focused, testable units following Uncle Bob's Clean Code principles.

**Architecture:** Incremental extraction — pull focused functions out of existing files without changing behavior. Each extraction is independently testable. Existing public interfaces remain stable.

**Tech Stack:** TypeScript, Electron main process, @anthropic-ai/claude-agent-sdk, Vitest.

---

## Already Completed

These tasks from the original plan are fully done. Preserved for historical reference only.

### Phase 1 Refactor (PR #679): `AgentManagerImpl` extractions

- **`mapQueuedTask()` and `checkAndBlockDeps()`** extracted to `src/main/agent-manager/task-mapper.ts`. `_processQueuedTask()` now imports and calls them — no inline logic remains.
- **`CircuitBreaker` class** extracted to `src/main/agent-manager/circuit-breaker.ts`. `AgentManagerImpl` holds a `_circuitBreaker` field and exposes backward-compat accessors (`_consecutiveSpawnFailures`, `_circuitOpenUntil`, `_isCircuitOpen`, `_recordSpawnSuccess`, `_recordSpawnFailure`).
- **`handleWatchdogVerdict()`** extracted to `src/main/agent-manager/watchdog-handler.ts`. `_watchdogLoop()` now calls it.
- **`RunAgentSpawnDeps` / `RunAgentDataDeps` / `RunAgentEventDeps`** interfaces extracted in `run-agent.ts`. `RunAgentDeps` is now a composed intersection type.

### `run-agent.ts` four-phase decomposition

`runAgent()` is a thin orchestrator calling:
- `validateAndPreparePrompt()` → calls `validateTaskForRun()` + `assembleRunContext()`
- `spawnAndWireAgent()` — spawn + wire
- `consumeMessages()` — exported, delegates to `processSDKMessage()`
- `finalizeAgentRun()` — classify exit, resolve, cleanup

### `completion.ts` decomposition

`resolveSuccess()` calls named helpers: `detectBranch()`, `autoCommitIfDirty()` (now in `git-operations.ts`), `rebaseOntoMain()`, `hasCommitsAheadOfMain()`, `transitionToReview()`, `attemptAutoMerge()`, `failTaskWithError()`, `classifyFailureReason()`.

---

## Codebase State (as of 2026-04-13 audit)

### What the Phase 1 refactor did NOT do

1. **`_drainLoop()` inline dep refresh (~50 lines) is still inline** — `refreshDependencyIndex()` extraction described in old Task 1 was NOT done. The 50-line block still lives inline in `_drainLoop()` at `src/main/agent-manager/index.ts:418–459`.

2. **`validateDrainPreconditions()` extraction was NOT done** — the guard checks are still inline in `_drainLoop()`.

3. **`assembleRunContext()` still has inline upstream context fetch + scratchpad read** — `fetchUpstreamContext()` and `readPriorScratchpad()` extractions from old Task 2 were NOT done.

4. **`autoCommitIfDirty()` staging logic is NOT extracted** — `stageWithArtifactCleanup()` described in old Task 3 was NOT done. `autoCommitIfDirty()` (now in `git-operations.ts:403`) still has the staging + artifact cleanup inline (~45 lines).

5. **`task-state-service.ts` still imports from `handlers/sprint-validation-helpers.ts`** — the boundary inversion (service importing from handler layer) is still present at `src/main/services/task-state-service.ts:16`.

6. **`AppHandlerDeps` still has no `repo` field** — three handlers still construct `ISprintTaskRepository` independently:
   - `agent-handlers.ts:33`: `const repo = createSprintTaskRepository()` inside `registerAgentHandlers()`
   - `sprint-batch-handlers.ts:131`: `const repo = createSprintTaskRepository()` inside `sprint:batchImport` handler
   - `sprint-local.ts:69`: `const repo = createSprintTaskRepository()` inside `sprint:createWorkflow` handler

7. **`src/main/index.ts:174`** creates a _second_ `sprintTaskRepository` instance (`const sprintTaskRepository = createSprintTaskRepository()`) separate from the `repo` created at line 104. Two separate SQLite wrapper instances exist simultaneously.

### New issues revealed by Phase 1

- `AgentManagerImpl` is now ~846 lines (down from ~957). Still large but acceptable for an orchestrator class.
- `_processQueuedTask()` is ~90 lines and has at least two distinct phases (repo resolution + worktree setup) that could be extracted further, but this is lower priority than the boundary violations.

---

## Async Invariants in AgentManagerImpl

Before touching `_drainLoop()`, understand these invariants:

1. **`_drainInFlight` guard**: Only one drain runs at a time. The `pollTimer` skips if `_drainInFlight` is set.

2. **`taskStatusMap` lifecycle**: Built at the start of `_drainLoop()`, passed into `_processQueuedTask()` which may mutate it (refreshes after claim). Local to a single drain invocation.

3. **`_processingTasks` set**: Guards against concurrent processing of the same task within a single drain. Set at start of `_processQueuedTask()`, deleted in `finally`. Extractions must not remove the `finally` cleanup.

4. **`_depIndex` vs `_lastTaskDeps`**: `_depIndex` contains the actual dependency graph. `_lastTaskDeps` is a fingerprint cache. Both are mutated in `_drainLoop()`. Any extracted `refreshDependencyIndex()` must mutate both consistently.

5. **`_terminalCalled` idempotency set**: Prevents double-invocation of `onTaskTerminal()`. Lives in `onTaskTerminal()` — do not extract this out of that method.

6. **Circuit breaker check**: `_isCircuitOpen()` must be checked before any task processing. Order matters.

---

## Task 1: Extract `refreshDependencyIndex()` from `_drainLoop()`

**Status:** New
**Findings addressed:** F-t1-sysprof-1/-4 (drain loop god function)

**Files:**
- Modify: `src/main/agent-manager/index.ts:400–492`
- Test: `src/main/agent-manager/__tests__/index-methods.test.ts`

- [ ] **Step 1: Write characterization tests**

Add to `src/main/agent-manager/__tests__/index-methods.test.ts`:

```typescript
describe('refreshDependencyIndex()', () => {
  it('returns a status map of all tasks', () => {
    mockRepo.getTasksWithDependencies.mockReturnValue([
      { id: 'a', status: 'queued', depends_on: null },
      { id: 'b', status: 'done', depends_on: null }
    ])
    const map = manager['refreshDependencyIndex']()
    expect(map.get('a')).toBe('queued')
    expect(map.get('b')).toBe('done')
  })

  it('removes deleted tasks from dep index fingerprint cache', () => {
    // Prime cache with task 'x'
    manager._lastTaskDeps.set('x', { deps: null, hash: '' })
    // Next refresh: no tasks returned
    mockRepo.getTasksWithDependencies.mockReturnValue([])
    manager['refreshDependencyIndex']()
    expect(manager._lastTaskDeps.has('x')).toBe(false)
  })

  it('returns empty map and logs warning when repo throws', () => {
    mockRepo.getTasksWithDependencies.mockImplementation(() => { throw new Error('db error') })
    const map = manager['refreshDependencyIndex']()
    expect(map.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (confirming the method does not yet exist)**
`npm run test:main -- --reporter=verbose src/main/agent-manager/__tests__/index-methods.test.ts`

- [ ] **Step 3: Extract `refreshDependencyIndex()` as a private method**

The block to extract is `src/main/agent-manager/index.ts:417–459` (the `let taskStatusMap = ...` block inside `_drainLoop()`).

```typescript
/**
 * Incrementally refreshes the in-memory dependency index.
 * Removes deleted tasks, updates changed task deps (using fingerprint cache).
 * Returns a snapshot of all task statuses for use during drain iteration.
 *
 * INVARIANT: Must be called before availableSlots check — dep resolution
 * in the previous tick may have unblocked tasks, changing the queue.
 */
private refreshDependencyIndex(): Map<string, string> {
  let taskStatusMap = new Map<string, string>()
  try {
    const allTasks = this.repo.getTasksWithDependencies()
    const currentTaskIds = new Set(allTasks.map((t) => t.id))

    // Remove deleted tasks from index
    for (const oldId of this._lastTaskDeps.keys()) {
      if (!currentTaskIds.has(oldId)) {
        this._depIndex.remove(oldId)
        this._lastTaskDeps.delete(oldId)
      }
    }

    // Update tasks with changed dependencies (fingerprint cache avoids redundant sorts)
    for (const task of allTasks) {
      if (isTerminal(task.status)) {
        this._lastTaskDeps.delete(task.id)
        continue
      }
      const cached = this._lastTaskDeps.get(task.id)
      const newDeps = task.depends_on ?? null
      const newHash = AgentManagerImpl._depsFingerprint(newDeps)
      if (!cached || cached.hash !== newHash) {
        this._depIndex.update(task.id, newDeps)
        this._lastTaskDeps.set(task.id, { deps: newDeps, hash: newHash })
      }
    }

    taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]))
  } catch (err) {
    this.logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
  }
  return taskStatusMap
}
```

Replace the corresponding inline block in `_drainLoop()` with:

```typescript
// BEFORE (inline ~43 lines):
let taskStatusMap = new Map<string, string>()
try {
  const allTasks = this.repo.getTasksWithDependencies()
  // ... 40 lines ...
  taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]))
} catch (err) {
  this.logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
}

// AFTER (1 line):
const taskStatusMap = this.refreshDependencyIndex()
```

- [ ] **Step 4: Run typecheck**
`npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Run tests**
`npm test && npm run test:main`
Expected: all pass, including the new characterization tests

- [ ] **Step 6: Run lint**
`npm run lint`
Expected: 0 errors

- [ ] **Step 7: Commit**
`git commit -m "refactor: extract refreshDependencyIndex from _drainLoop"`

---

## Task 2: Extract drain preconditions and task iteration helpers

**Status:** New (builds on Task 1)
**Findings addressed:** F-t1-sysprof-1 (drain loop size)

**Files:**
- Modify: `src/main/agent-manager/index.ts`
- Test: `src/main/agent-manager/__tests__/index-methods.test.ts`

After Task 1, `_drainLoop()` is still ~45 lines with two inline responsibilities:
1. Guard checks (shuttingDown + circuit open)
2. Task fetch + iteration loop

- [ ] **Step 1: Write characterization tests**

```typescript
describe('validateDrainPreconditions()', () => {
  it('returns false when shuttingDown is true', () => {
    manager._shuttingDown = true
    expect(manager['validateDrainPreconditions']()).toBe(false)
  })

  it('returns false when circuit breaker is open', () => {
    // Access the circuit breaker's internal timestamp
    ;(manager as any)._circuitBreaker['openUntilTimestamp'] = Date.now() + 60_000
    expect(manager['validateDrainPreconditions']()).toBe(false)
  })

  it('returns true when neither condition is met', () => {
    manager._shuttingDown = false
    expect(manager['validateDrainPreconditions']()).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**
`npm run test:main -- --reporter=verbose src/main/agent-manager/__tests__/index-methods.test.ts`

- [ ] **Step 3: Extract `validateDrainPreconditions()` as a private method**

```typescript
/**
 * Returns false if the drain loop should abort (shutting down or circuit open).
 * Logs the reason if aborting.
 */
private validateDrainPreconditions(): boolean {
  if (this._shuttingDown) return false
  if (this._isCircuitOpen()) {
    this.logger.warn(
      `[agent-manager] Skipping drain — circuit breaker open until ${new Date(
        this._circuitOpenUntil
      ).toISOString()}`
    )
    return false
  }
  return true
}
```

Replace in `_drainLoop()`:
```typescript
// BEFORE
if (this._shuttingDown) return
if (this._isCircuitOpen()) {
  this.logger.warn(`[agent-manager] Skipping drain — circuit breaker open until ...`)
  return
}

// AFTER
if (!this.validateDrainPreconditions()) return
```

- [ ] **Step 4: Extract `drainQueuedTasks()` as a private method**

```typescript
/**
 * Fetches queued tasks (up to `available` slots) and processes each.
 * Stops early if shutting down or slots exhausted.
 */
private async drainQueuedTasks(
  available: number,
  taskStatusMap: Map<string, string>
): Promise<void> {
  this.logger.info(`[agent-manager] Fetching queued tasks (limit=${available})...`)
  const queued = this.fetchQueuedTasks(available)
  this.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)

  for (const raw of queued) {
    if (this._shuttingDown) break
    if (availableSlots(this._concurrency, this._activeAgents.size) <= 0) {
      this.logger.info('[agent-manager] No slots available — stopping drain iteration')
      break
    }
    try {
      await this._processQueuedTask(raw, taskStatusMap)
    } catch (err) {
      this.logger.error(
        `[agent-manager] Failed to process task ${(raw as Record<string, unknown>).id}: ${err}`
      )
    }
  }
}
```

The resulting `_drainLoop()` should look like:

```typescript
async _drainLoop(): Promise<void> {
  this.logger.info(
    `[agent-manager] Drain loop starting (shuttingDown=${this._shuttingDown}, slots=${availableSlots(this._concurrency, this._activeAgents.size)})`
  )
  if (!this.validateDrainPreconditions()) return
  this._metrics.increment('drainLoopCount')
  const drainStart = Date.now()

  const taskStatusMap = this.refreshDependencyIndex()

  const available = availableSlots(this._concurrency, this._activeAgents.size)
  if (available <= 0) return

  try {
    const tokenOk = await checkOAuthToken(this.logger)
    if (!tokenOk) return
    await this.drainQueuedTasks(available, taskStatusMap)
  } catch (err) {
    this.logger.error(`[agent-manager] Drain loop error: ${err}`)
  }

  this._metrics.setLastDrainDuration(Date.now() - drainStart)
  this._concurrency = tryRecover(this._concurrency, Date.now())
}
```

`_drainLoop()` is now ~25 lines. Each step is named and testable.

- [ ] **Step 5: Run typecheck**
`npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Run tests**
`npm test && npm run test:main`
Expected: all pass

- [ ] **Step 7: Run lint**
`npm run lint`
Expected: 0 errors

- [ ] **Step 8: Commit**
`git commit -m "refactor: extract validateDrainPreconditions and drainQueuedTasks from _drainLoop"`

---

## Task 3: Extract helpers from `assembleRunContext()` in `run-agent.ts`

**Status:** New
**Findings addressed:** F-t4-cleanfn-1 (functions with multiple responsibilities)

**Files:**
- Modify: `src/main/agent-manager/run-agent.ts:264–320`
- Test: `src/main/agent-manager/__tests__/run-agent.test.ts`

`assembleRunContext()` (~57 lines, lines 264–320) has three distinct responsibilities mixed inline:
1. Upstream context fetching (repo I/O loop)
2. Scratchpad directory setup + read (filesystem I/O)
3. Prompt assembly (pure delegation to `buildAgentPrompt`)

- [ ] **Step 1: Write characterization tests**

```typescript
describe('fetchUpstreamContext()', () => {
  it('returns empty array when deps is null', () => {
    expect(fetchUpstreamContext(null, mockRepo, mockLogger)).toEqual([])
  })

  it('returns context entries only for done upstream tasks with non-empty spec', () => {
    mockRepo.getTask.mockReturnValue({
      status: 'done',
      title: 'Upstream Task',
      spec: '## Implementation\nDo something',
      prompt: null,
      partial_diff: 'diff --git ...'
    })
    const result = fetchUpstreamContext(
      [{ id: 'upstream-id', type: 'hard' }],
      mockRepo,
      mockLogger
    )
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Upstream Task')
    expect(result[0].partial_diff).toBeDefined()
  })

  it('skips upstream tasks that are not done', () => {
    mockRepo.getTask.mockReturnValue({ status: 'queued', title: 'Pending', spec: 'spec' })
    const result = fetchUpstreamContext(
      [{ id: 'upstream-id', type: 'hard' }],
      mockRepo,
      mockLogger
    )
    expect(result).toHaveLength(0)
  })
})

describe('readPriorScratchpad()', () => {
  it('returns empty string when progress.md does not exist', () => {
    // Uses a temp task ID that has no scratchpad file
    const result = readPriorScratchpad('nonexistent-task-id-12345')
    expect(result).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail** (functions don't exist yet)
`npm run test:main -- --reporter=verbose src/main/agent-manager/__tests__/run-agent.test.ts`

- [ ] **Step 3: Extract `fetchUpstreamContext()` as a module-level function**

Add above `assembleRunContext()` in `run-agent.ts`:

```typescript
/**
 * Fetches upstream task specs for context propagation.
 * Only includes tasks that are 'done' with non-empty spec/prompt.
 * Pure I/O — no side effects beyond repo reads.
 */
function fetchUpstreamContext(
  deps: TaskDependency[] | null | undefined,
  repo: ISprintTaskRepository,
  logger: Logger
): Array<{ title: string; spec: string; partial_diff?: string }> {
  if (!deps || deps.length === 0) return []
  const context: Array<{ title: string; spec: string; partial_diff?: string }> = []
  for (const dep of deps) {
    try {
      const upstreamTask = repo.getTask(dep.id)
      if (upstreamTask && upstreamTask.status === 'done') {
        const spec = upstreamTask.spec || upstreamTask.prompt || ''
        if (spec.trim()) {
          context.push({
            title: upstreamTask.title,
            spec: spec.trim(),
            partial_diff: upstreamTask.partial_diff || undefined
          })
        }
      }
    } catch (err) {
      logger.warn(`[agent-manager] Failed to fetch upstream task ${dep.id}: ${err}`)
    }
  }
  return context
}
```

Replace the inline loop in `assembleRunContext()` with:
```typescript
const upstreamContext = fetchUpstreamContext(task.depends_on, repo, logger)
```

- [ ] **Step 4: Extract `readPriorScratchpad()` as a module-level function**

```typescript
/**
 * Reads the agent's prior scratchpad for retry context.
 * Creates the scratchpad directory if it doesn't exist.
 * Returns empty string on first run (expected — not an error).
 */
function readPriorScratchpad(taskId: string): string {
  const scratchpadDir = join(BDE_TASK_MEMORY_DIR, taskId)
  mkdirSync(scratchpadDir, { recursive: true })
  try {
    return readFileSync(join(scratchpadDir, 'progress.md'), 'utf-8')
  } catch {
    return '' // Expected on first run
  }
}
```

Replace the inline block in `assembleRunContext()` with:
```typescript
const priorScratchpad = readPriorScratchpad(task.id)
```

- [ ] **Step 5: Run typecheck**
`npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Run tests**
`npm test && npm run test:main`
Expected: all pass

- [ ] **Step 7: Run lint**
`npm run lint`
Expected: 0 errors

- [ ] **Step 8: Commit**
`git commit -m "refactor: extract fetchUpstreamContext and readPriorScratchpad from assembleRunContext"`

---

## Task 4: Fix module boundary inversion — move `validateTaskSpec` to service layer

**Status:** New
**Findings addressed:** Clean Architecture — services must not import from handlers

**Files:**
- Modify: `src/main/handlers/sprint-validation-helpers.ts`
- Modify: `src/main/services/task-state-service.ts:16`
- Test: confirm existing tests still pass (no new behavior)

**Problem:** `task-state-service.ts` (service layer) imports `validateTaskSpec` from `handlers/sprint-validation-helpers.ts` (handler layer). Services importing from handlers violates Clean Architecture. `validateTaskSpec` should live in the service layer.

**Approach:** Move `validateTaskSpec` into `src/main/services/spec-quality/factory.ts` (or a new `index.ts` in that directory), then have `sprint-validation-helpers.ts` re-export it for backward compatibility.

- [ ] **Step 1: Check `spec-quality/` directory structure**
`ls src/main/services/spec-quality/`

Expected files: `factory.ts`, `spec-parser.ts`, `spec-quality-service.ts`, `validators/`, `__tests__/`. No `index.ts` exists yet.

- [ ] **Step 2: Create `src/main/services/spec-quality/index.ts` as the public API**

```typescript
/**
 * Public API surface for the spec-quality service module.
 * Re-exports the factory and adds validateTaskSpec as a service-layer function.
 */
export { createSpecQualityService } from './factory'

import { createSpecQualityService } from './factory'

// Module-level singleton — must not be per-call to avoid repeated initialization
const specQualityService = createSpecQualityService()

/**
 * Run structural and semantic validation on a task spec.
 * Throws an error with appropriate message if validation fails.
 *
 * Moved from handlers/sprint-validation-helpers to fix module boundary inversion:
 * task-state-service (service layer) must not import from the handler layer.
 */
export async function validateTaskSpec(input: {
  title: string
  repo: string
  spec: string | null
  context: 'queue' | 'unblock'
}): Promise<void> {
  const prefix = input.context === 'queue' ? 'Cannot queue task' : 'Cannot unblock task'

  const { validateStructural } = await import('../../../shared/spec-validation')
  const structural = validateStructural({
    title: input.title,
    repo: input.repo,
    spec: input.spec
  })
  if (!structural.valid) {
    throw new Error(`${prefix} — spec quality checks failed: ${structural.errors.join('; ')}`)
  }

  if (input.spec) {
    const result = await specQualityService.validateFull(input.spec)
    if (!result.valid) {
      const firstError = result.errors[0]?.message ?? 'Spec did not pass quality checks'
      throw new Error(`${prefix} — semantic checks failed: ${firstError}`)
    }
  }
}
```

- [ ] **Step 3: Update `sprint-validation-helpers.ts` to re-export from service layer**

Replace the entire contents of `src/main/handlers/sprint-validation-helpers.ts` with:

```typescript
/**
 * Shared validation helpers for sprint task handlers.
 *
 * NOTE: validateTaskSpec has been moved to the service layer.
 * This file re-exports it for backward compatibility — prefer importing from
 * '../services/spec-quality/index' directly in new code.
 */
export { validateTaskSpec } from '../services/spec-quality/index'
```

This keeps `sprint-batch-handlers.ts` (which imports from here) working without changes.

- [ ] **Step 4: Update `task-state-service.ts` import**

Change line 16 in `src/main/services/task-state-service.ts`:

```typescript
// BEFORE
import { validateTaskSpec } from '../handlers/sprint-validation-helpers'

// AFTER
import { validateTaskSpec } from './spec-quality/index'
```

- [ ] **Step 5: Run typecheck**
`npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Run tests**
`npm test && npm run test:main`
Expected: all pass

- [ ] **Step 7: Run lint**
`npm run lint`
Expected: 0 errors

- [ ] **Step 8: Commit**
`git commit -m "fix: move validateTaskSpec to service layer, fix module boundary inversion"`

---

## Task 5: Fix DI violation — inject `ISprintTaskRepository` via `AppHandlerDeps`

**Status:** New
**Findings addressed:** DI violation — handlers calling `createSprintTaskRepository()` independently

**Files:**
- Modify: `src/main/handlers/registry.ts` — add `repo` to `AppHandlerDeps`
- Modify: `src/main/handlers/agent-handlers.ts` — accept injected repo
- Modify: `src/main/handlers/sprint-batch-handlers.ts` — accept injected repo
- Modify: `src/main/handlers/sprint-local.ts` — accept injected repo
- Modify: `src/main/index.ts` — pass shared repo + eliminate duplicate instance at line 174

**Problem:** Three handlers construct independent `ISprintTaskRepository` instances. `index.ts` creates TWO separate instances (line 104 `repo` and line 174 `sprintTaskRepository`). All should use the same instance created at startup.

- [ ] **Step 1: Add `repo` to `AppHandlerDeps` in `registry.ts`**

```typescript
// src/main/handlers/registry.ts — add import at top
import type { ISprintTaskRepository } from '../data/sprint-task-repository'

// Update AppHandlerDeps
export interface AppHandlerDeps {
  agentManager?: AgentManager
  terminalDeps: TerminalDeps
  reviewService?: ReviewService
  reviewChatStreamDeps?: ChatStreamDeps
  repo: ISprintTaskRepository  // ← add this
}
```

- [ ] **Step 2: Run typecheck to see expected errors**
`npm run typecheck`
Expected: errors in `index.ts` (missing `repo` field) and handler call sites.

- [ ] **Step 3: Update `registerAllHandlers()` to thread repo through**

In `registry.ts` `registerAllHandlers()`:

```typescript
export function registerAllHandlers(deps: AppHandlerDeps): void {
  const { agentManager, terminalDeps, reviewService, reviewChatStreamDeps, repo } = deps

  if (agentManager) {
    registerAgentHandlers(agentManager, repo)
    // ...
  } else {
    registerAgentHandlers(undefined, repo)
    // ...
  }
  // ...
  registerSprintLocalHandlers(terminalDeps, repo)
  registerSprintBatchHandlers({ onStatusTerminal: terminalDeps.onStatusTerminal, repo })
  // ...
}
```

- [ ] **Step 4: Update `registerAgentHandlers()` signature in `agent-handlers.ts`**

```typescript
// BEFORE
export function registerAgentHandlers(am?: AgentManager): void {
  const repo = createSprintTaskRepository()
  // ...
}

// AFTER
export function registerAgentHandlers(am?: AgentManager, repo?: ISprintTaskRepository): void {
  const effectiveRepo = repo ?? createSprintTaskRepository()  // fallback for direct test use
  // Replace all uses of `repo` with `effectiveRepo` in this function
}
```

Add the import at the top:
```typescript
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
```

- [ ] **Step 5: Update `registerSprintBatchHandlers()` signature in `sprint-batch-handlers.ts`**

```typescript
// BEFORE
export interface BatchHandlersDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}
export function registerSprintBatchHandlers(deps: BatchHandlersDeps): void {
  // ...
  safeHandle('sprint:batchImport', async (_e, tasks) => {
    const repo = createSprintTaskRepository()   // ← inline construction
    // ...
  })
}

// AFTER
import type { ISprintTaskRepository } from '../data/sprint-task-repository'

export interface BatchHandlersDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
  repo?: ISprintTaskRepository
}
export function registerSprintBatchHandlers(deps: BatchHandlersDeps): void {
  const repo = deps.repo ?? createSprintTaskRepository()  // ← use injected
  // ...
  safeHandle('sprint:batchImport', async (_e, tasks) => {
    // use captured `repo` (no longer inline)
    const { batchImportTasks } = await import('../services/batch-import')
    const reposConfig = getSettingJson<Array<{ name: string; localPath: string }>>('repos') ?? []
    const configuredRepos = reposConfig.map((r) => r.name.toLowerCase())
    return batchImportTasks(tasks, repo, configuredRepos.length > 0 ? configuredRepos : undefined)
  })
}
```

- [ ] **Step 6: Update `registerSprintLocalHandlers()` signature in `sprint-local.ts`**

```typescript
// BEFORE
export function registerSprintLocalHandlers(deps: SprintLocalDeps): void {
  // ...
  safeHandle('sprint:createWorkflow', async (_e, template: WorkflowTemplate) => {
    const repo = createSprintTaskRepository()   // ← inline construction
    // ...
  })
}

// AFTER
import type { ISprintTaskRepository } from '../data/sprint-task-repository'

export function registerSprintLocalHandlers(
  deps: SprintLocalDeps,
  repo?: ISprintTaskRepository
): void {
  const effectiveRepo = repo ?? createSprintTaskRepository()
  // ...
  safeHandle('sprint:createWorkflow', async (_e, template: WorkflowTemplate) => {
    const result = instantiateWorkflow(template, effectiveRepo)  // ← use captured
    // ...
  })
}
```

- [ ] **Step 7: Update `src/main/index.ts` to pass the shared repo and eliminate the duplicate**

Current state in `index.ts`:
- Line 104: `const repo = createSprintTaskRepository()` — used for terminal service and agent manager
- Line 174: `const sprintTaskRepository = createSprintTaskRepository()` — second instance for review service

Change the pattern to:

```typescript
// At line 104 — keep this as the single shared instance
const repo = createSprintTaskRepository()

// ...later, at lines 174–184, replace the separate `sprintTaskRepository` with `repo`:
// BEFORE
const sprintTaskRepository = createSprintTaskRepository()
// ... uses of `sprintTaskRepository` ...

// AFTER — use `repo` everywhere (both the original repo and the duplicate use the same table)
// Remove line 174; replace all `sprintTaskRepository` references with `repo`
```

Then pass it to `handlerDeps`:

```typescript
const handlerDeps: AppHandlerDeps = {
  agentManager,
  terminalDeps,
  reviewService,
  reviewChatStreamDeps,
  repo  // ← add this
}
```

- [ ] **Step 8: Run typecheck**
`npm run typecheck`
Expected: 0 errors

- [ ] **Step 9: Run tests**
`npm test && npm run test:main`
Expected: all pass

- [ ] **Step 10: Run lint**
`npm run lint`
Expected: 0 errors

- [ ] **Step 11: Commit**
`git commit -m "fix: inject ISprintTaskRepository via AppHandlerDeps, remove independent constructions"`

---

## Task 6: Extract `stageWithArtifactCleanup()` from `autoCommitIfDirty()`

**Status:** New
**Findings addressed:** Single responsibility — `autoCommitIfDirty` mixes staging and committing

**Files:**
- Modify: `src/main/agent-manager/git-operations.ts:403–455`
- Test: `src/main/agent-manager/__tests__/completion.test.ts` (or `git-operations.test.ts`)

`autoCommitIfDirty()` at `git-operations.ts:403` is ~50 lines and mixes two concerns: (1) staging files while cleaning artifacts, and (2) performing the commit.

- [ ] **Step 1: Write characterization test**

```typescript
describe('autoCommitIfDirty()', () => {
  it('skips commit when working directory is clean', async () => {
    // Mock git status --porcelain to return empty
    // Assert git commit was not called
  })

  it('skips commit when only test artifacts are staged', async () => {
    // Mock git status --porcelain to return test artifact paths
    // Mock git diff --cached --name-only to return empty after rm --cached
    // Assert git commit was not called
  })
})
```

- [ ] **Step 2: Run tests to verify they pass (characterizing existing behavior)**
`npm run test:main -- --reporter=verbose`

- [ ] **Step 3: Extract `stageWithArtifactCleanup()` as a module-level function in `git-operations.ts`**

Add above `autoCommitIfDirty()`:

```typescript
/**
 * Stages all changes (git add -A), then unstages test artifact paths.
 * Returns true if staged changes remain after artifact cleanup, false if nothing to commit.
 */
async function stageWithArtifactCleanup(
  worktreePath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<boolean> {
  await execFile('git', ['add', '-A'], { cwd: worktreePath, env })
  for (const artifactPath of GIT_ARTIFACT_PATTERNS) {
    try {
      await execFile('git', ['rm', '-r', '--cached', '--ignore-unmatch', artifactPath], {
        cwd: worktreePath,
        env
      })
    } catch (err) {
      logger.info(`[completion] artifact cleanup failed for ${artifactPath}: ${getErrorMessage(err)}`)
    }
  }
  const { stdout: stagedOut } = await execFile('git', ['diff', '--cached', '--name-only'], {
    cwd: worktreePath,
    env
  })
  return Boolean(stagedOut.trim()) // true = has staged changes
}
```

Refactor `autoCommitIfDirty()` to call it:

```typescript
export async function autoCommitIfDirty(
  worktreePath: string,
  title: string,
  logger: Logger
): Promise<void> {
  const env = buildAgentEnv()
  const { stdout: statusOut } = await execFile('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    env
  })
  if (!statusOut.trim()) return

  logger.info(`[completion] auto-committing uncommitted changes`)
  const hasStagedChanges = await stageWithArtifactCleanup(worktreePath, env, logger)
  if (!hasStagedChanges) {
    logger.info(`[completion] no staged changes after unstaging test artifacts — skipping commit`)
    return
  }

  const sanitizedTitle = sanitizeForGit(title)
  await execFile(
    'git',
    ['commit', '-m', `${sanitizedTitle}\n\nAutomated commit by BDE agent manager`],
    { cwd: worktreePath, env }
  )
}
```

- [ ] **Step 4: Run typecheck**
`npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Run tests**
`npm test && npm run test:main`
Expected: all pass

- [ ] **Step 6: Run lint**
`npm run lint`
Expected: 0 errors

- [ ] **Step 7: Commit**
`git commit -m "refactor: extract stageWithArtifactCleanup from autoCommitIfDirty"`

---

## Sequencing and Dependencies

- **Task 2 depends on Task 1** — Task 2's `_drainLoop()` cleanup assumes `refreshDependencyIndex()` is already extracted.
- **Tasks 1, 3, 4, 5, 6 are fully independent** — they touch different files and can be done in any order.

Recommended order for a single session:
1. Task 4 (smallest, clearest win, no behavior risk — pure import path change)
2. Task 5 (moderate — requires reading index.ts construction pattern)
3. Task 1 (extraction groundwork)
4. Task 2 (builds on Task 1)
5. Task 3 (run-agent helpers — low risk)
6. Task 6 (git-operations — low risk)

---

## Rollback Protocol

If any extraction causes a test failure:

1. **Do NOT proceed** to the next step.
2. `git diff` to see exactly what changed.
3. Verify the extracted function signature matches the original behavior exactly — check return types, error paths, and side effects.
4. Common failure mode: early returns that were inside an `if` block get hoisted to the extracted function but the caller doesn't check the return value.
5. If you can't identify the root cause within 15 minutes, revert with `git restore <file>` and report the failure.

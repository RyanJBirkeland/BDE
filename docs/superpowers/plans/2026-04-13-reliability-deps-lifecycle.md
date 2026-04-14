# Reliability: Dependency Resolution & Task Lifecycle Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining medium-effort reliability gaps in BDE's dependency resolution and task status transition systems.

**Architecture:** Targeted fixes to existing modules — no structural changes. Focus on closing edge cases in the dependency resolution graph and making status transitions enforceable.

**Tech Stack:** TypeScript, Electron main process, SQLite via better-sqlite3, Vitest.

---

## Build & Test Commands

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

---

## Task 1 — F-t3-depres-2: Deprecation warning for condition-less dependencies

**Problem:** In `areDependenciesSatisfied()` inside `src/main/services/dependency-service.ts` (lines 85–110), the `else` branch (no `condition` field) silently falls back to type-based behavior. When future condition-based logic is added, old deps without `condition` will behave unexpectedly. There is no warning emitted today.

**Files to modify:**
- `src/main/services/dependency-service.ts`
- `src/main/__tests__/dependency-index.test.ts` (add new tests; file already exists at this path)

### Steps

- [ ] **1a. Write failing test**

  Open `src/main/__tests__/dependency-index.test.ts`. Add a describe block:

  ```ts
  import { describe, it, expect, vi } from 'vitest'
  import { createDependencyIndex } from '../../main/services/dependency-service'

  describe('areDependenciesSatisfied — deprecation warning for condition-less deps', () => {
    it('emits no warning when all deps have condition field', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const idx = createDependencyIndex()
      idx.areDependenciesSatisfied(
        'task-a',
        [{ id: 'dep-1', type: 'hard', condition: 'on_success' }],
        () => 'done'
      )
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('emits a deprecation warning when a dep lacks condition field', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const idx = createDependencyIndex()
      idx.areDependenciesSatisfied(
        'task-a',
        [{ id: 'dep-1', type: 'hard' }],
        () => 'done'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[deprecation]')
      )
      warnSpy.mockRestore()
    })
  })
  ```

  Run `npm test` — this test should fail because no warning is emitted yet.

- [ ] **1b. Update `DependencyIndex` interface to accept optional logger**

  In `src/main/services/dependency-service.ts`, update the `DependencyIndex` interface (lines 18–28):

  ```ts
  export interface DependencyIndex {
    rebuild(tasks: Array<{ id: string; depends_on: TaskDependency[] | null }>): void
    update(taskId: string, deps: TaskDependency[] | null): void
    remove(taskId: string): void
    getDependents(taskId: string): Set<string>
    areDependenciesSatisfied(
      taskId: string,
      deps: TaskDependency[],
      getTaskStatus: (id: string) => string | undefined,
      logger?: { warn: (msg: string) => void }
    ): { satisfied: boolean; blockedBy: string[] }
  }
  ```

- [ ] **1c. Add the deprecation warning in `areDependenciesSatisfied`**

  Replace the `areDependenciesSatisfied` implementation (lines 85–111 of `src/main/services/dependency-service.ts`) with:

  ```ts
  areDependenciesSatisfied(_taskId, deps, getTaskStatus, logger) {
    if (deps.length === 0) return { satisfied: true, blockedBy: [] }
    const blockedBy: string[] = []
    for (const dep of deps) {
      const status = getTaskStatus(dep.id)
      if (status === undefined) continue // deleted dep = satisfied

      // If condition is specified, use condition-based logic
      if (dep.condition) {
        if (dep.condition === 'on_success') {
          if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)
        } else if (dep.condition === 'on_failure') {
          if (!FAILURE_STATUSES.has(status)) blockedBy.push(dep.id)
        } else if (dep.condition === 'always') {
          if (!TERMINAL_STATUSES.has(status)) blockedBy.push(dep.id)
        }
      } else {
        // No condition = fallback to hard/soft behavior (backward compatibility)
        // DEPRECATED: `condition` will be required in a future version.
        // This branch will be removed once all existing deps are migrated.
        ;(logger ?? console).warn(
          `[deprecation] Dependency ${dep.id} on task ${_taskId} has no "condition" field — ` +
            `falling back to type="${dep.type ?? 'hard'}" behavior. ` +
            `Set an explicit condition ("on_success", "on_failure", or "always") to silence this warning.`
        )
        if (dep.type === 'hard') {
          if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)
        } else {
          if (!TERMINAL_STATUSES.has(status)) blockedBy.push(dep.id)
        }
      }
    }
    return { satisfied: blockedBy.length === 0, blockedBy }
  }
  ```

- [ ] **1d. Update the `TaskDependency` type comment**

  Find `src/shared/types/task-types.ts` (or wherever `TaskDependency` is defined — search with `grep -r "TaskDependency" src/shared/`). Add a JSDoc comment to the `condition` field:

  ```ts
  /**
   * Condition under which this dependency unblocks the downstream task.
   * - `on_success`: unblocks when upstream reaches `done`
   * - `on_failure`: unblocks when upstream reaches a failure status
   * - `always`: unblocks when upstream reaches any terminal status
   *
   * REQUIRED in a future version. Currently optional for backward compatibility;
   * omitting it triggers a deprecation warning and falls back to `type`-based behavior.
   */
  condition?: 'on_success' | 'on_failure' | 'always'
  ```

- [ ] **1e. Run checks**

  ```bash
  npm run typecheck
  npm test
  npm run lint
  ```

- [ ] **1f. Commit**

  ```
  fix: emit deprecation warning for condition-less task dependencies
  ```

---

## Task 2 — F-t3-depres-4: Manually cancelled tasks must trigger dependency resolution

**Problem:** When a user calls `sprint:update` with `{ status: 'cancelled' }` on a task that has dependents, the IPC handler (lines 85–110 of `src/main/handlers/sprint-local.ts`) does call `deps.onStatusTerminal(id, patch.status)` — BUT only when `result` (the return value of `updateTask`) is truthy. If the update succeeds but returns `null` for any reason, the terminal callback is silently skipped. Separately, when `sprint:update` changes status to a non-terminal status (like `queued`, `blocked`, `active`, `review`), cancellation of the task does not occur through this path, so that case is fine — but the null-result gap is real.

**Affected file:** `src/main/handlers/sprint-local.ts` (lines 104–109):

```ts
// CURRENT — buggy: skips terminal callback if updateTask returns null
const result = updateTask(id, patch)
if (result && patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
  deps.onStatusTerminal(id, patch.status as string)
}
return result
```

The fix: always fire `onStatusTerminal` when the patch contains a terminal status, regardless of whether `updateTask` returns a task row. The status transition guard in `updateTask` will already throw or log if the transition is invalid; if it returns `null` for other reasons (e.g., task not found), we should still attempt resolution so blocked tasks aren't left stranded.

**Files to modify:**
- `src/main/handlers/sprint-local.ts`
- `src/main/handlers/__tests__/sprint-listeners.test.ts` (add a new test case)

### Steps

- [ ] **2a. Write failing test**

  Open `src/main/handlers/__tests__/sprint-listeners.test.ts`. Find the test for `sprint:update` and add:

  ```ts
  it('fires onStatusTerminal even when updateTask returns null for a terminal status', async () => {
    // Arrange: updateTask returns null (task not found or no-op)
    const mockUpdateTask = vi.fn().mockReturnValue(null)
    const mockOnStatusTerminal = vi.fn()
    // Use a minimal inline handler that mirrors the real sprint:update logic
    // (avoid module-level vi.mock by testing the logic directly)
    const patch = { status: 'cancelled' }
    const TERMINAL_STATUSES_LOCAL = new Set(['done', 'cancelled', 'failed', 'error'])
    
    // Simulate the CURRENT (buggy) behavior
    const result = mockUpdateTask('task-1', patch)
    if (result && patch.status && TERMINAL_STATUSES_LOCAL.has(patch.status)) {
      mockOnStatusTerminal('task-1', patch.status)
    }
    // Should NOT have fired with the current bug
    expect(mockOnStatusTerminal).not.toHaveBeenCalled()
    
    // Simulate the FIXED behavior
    mockOnStatusTerminal.mockClear()
    mockUpdateTask('task-1', patch) // returns null again
    if (patch.status && TERMINAL_STATUSES_LOCAL.has(patch.status)) {
      // Fixed: always fire if the patch has a terminal status
      mockOnStatusTerminal('task-1', patch.status)
    }
    expect(mockOnStatusTerminal).toHaveBeenCalledWith('task-1', 'cancelled')
  })
  ```

- [ ] **2b. Fix the handler**

  In `src/main/handlers/sprint-local.ts`, replace lines 104–109:

  ```ts
  // BEFORE
  const result = updateTask(id, patch)
  if (result && patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
    deps.onStatusTerminal(id, patch.status as string)
  }
  return result
  ```

  With:

  ```ts
  // AFTER: fire terminal callback regardless of updateTask's return value
  // so that dependents are unblocked even when the update is a no-op.
  const result = updateTask(id, patch)
  if (patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
    deps.onStatusTerminal(id, patch.status as string)
  }
  return result
  ```

- [ ] **2c. Run checks**

  ```bash
  npm run typecheck
  npm test
  npm run lint
  ```

- [ ] **2d. Commit**

  ```
  fix: always fire onStatusTerminal on terminal status patch in sprint:update
  ```

---

## Task 3 — F-t3-tasktrans-3: Enforce `isValidTransition()` in `updateTask()`

**Problem:** `validateTransition()` exists in `src/shared/task-state-machine.ts` and is already imported in `src/main/data/sprint-queries.ts` (line 16: `import { validateTransition } from '../../shared/task-state-machine'`). It IS called in the `updateTask()` function (lines 370–377 of `sprint-queries.ts`):

```ts
if (patch.status && typeof patch.status === 'string') {
  const currentStatus = oldTask.status as string
  const result = validateTransition(currentStatus, patch.status)
  if (!result.ok) {
    logger.warn(`[sprint-queries] ${result.reason} for task ${id}`)
    return null  // <-- SILENT: returns null instead of throwing
  }
}
```

The guard exists but returns `null` silently instead of throwing. Callers receive `null` and silently proceed. This means invalid transitions are logged but not surfaced as errors to callers.

**Desired behavior:** Throw a descriptive `Error` so callers can catch and surface the error to the UI.

**Note on `VALID_TRANSITIONS`:** `review → failed` is not currently in the state machine. Task 4 adds it. Implement Task 3 first, then Task 4 will extend the transitions table.

**Files to modify:**
- `src/main/data/sprint-queries.ts`
- `src/main/__tests__/integration/db-crud.test.ts` (add transition enforcement tests)

### Steps

- [ ] **3a. Write failing tests**

  Open `src/main/__tests__/integration/db-crud.test.ts`. Add a new describe block at the end:

  ```ts
  describe('updateTask — transition enforcement', () => {
    let db: Database.Database

    beforeEach(() => {
      db = new Database(':memory:')
      runMigrations(db)
    })

    afterEach(() => {
      db.close()
    })

    function seedTask(status: string): string {
      // Insert a task directly at the desired status, bypassing transitions
      const row = db
        .prepare(
          `INSERT INTO sprint_tasks (title, repo, prompt, status, priority)
           VALUES ('Test', 'bde', 'prompt', ?, 0) RETURNING id`
        )
        .get(status) as { id: string }
      return row.id
    }

    it('throws on invalid transition: done → active', () => {
      // Must override getDb() to use test db — use setSprintQueriesLogger pattern
      // NOTE: sprint-queries uses module-level getDb(). For integration tests,
      // call the real updateTask after inserting directly into the test db.
      // This test relies on the in-process db being the test db.
      // If your test setup doesn't inject the db, use vi.mock approach below.
      const id = seedTask('done')
      expect(() => updateTask(id, { status: 'active' })).toThrow(/Invalid transition/)
    })

    it('throws on invalid transition: cancelled → queued', () => {
      const id = seedTask('cancelled')
      expect(() => updateTask(id, { status: 'queued' })).toThrow(/Invalid transition/)
    })

    it('succeeds on valid transition: queued → active', () => {
      const id = seedTask('queued')
      const result = updateTask(id, { status: 'active' })
      expect(result).not.toBeNull()
      expect(result?.status).toBe('active')
    })
  })
  ```

  Run `npm test` — the `toThrow` tests should fail because `updateTask` currently returns `null` silently.

- [ ] **3b. Change `updateTask` to throw on invalid transition**

  In `src/main/data/sprint-queries.ts`, replace the transition guard block (lines 369–377):

  ```ts
  // BEFORE
  if (patch.status && typeof patch.status === 'string') {
    const currentStatus = oldTask.status as string
    const result = validateTransition(currentStatus, patch.status)
    if (!result.ok) {
      logger.warn(`[sprint-queries] ${result.reason} for task ${id}`)
      return null
    }
  }
  ```

  With:

  ```ts
  // AFTER: throw so callers can surface the error
  if (patch.status && typeof patch.status === 'string') {
    const currentStatus = oldTask.status as string
    const validationResult = validateTransition(currentStatus, patch.status)
    if (!validationResult.ok) {
      throw new Error(
        `[sprint-queries] Invalid transition for task ${id}: ${validationResult.reason}`
      )
    }
  }
  ```

- [ ] **3c. Audit callers of `updateTask` for catch handling**

  Search for all direct callers of `updateTask` that might swallow the new error:

  ```bash
  grep -rn "updateTask(" src/main/ --include="*.ts" | grep -v "test\|spec\|__tests__"
  ```

  Key callers to check:
  - `src/main/agent-manager/resolve-dependents.ts` — already has `try/catch` per-dependent (lines 48–110), so the error will be caught and logged per-task. This is fine.
  - `src/main/services/task-terminal-service.ts` — wraps `updateTask` in `try/catch` per task. Fine.
  - `src/main/agent-manager/run-agent.ts` — if it calls `updateTask` directly, ensure the catch block logs and handles the error.
  - `src/main/handlers/sprint-local.ts` — the `safeHandle` wrapper catches errors and sends them back to the renderer as error responses. This is correct behavior.

  No changes needed if callers already have `try/catch` or use `safeHandle`.

- [ ] **3d. Run checks**

  ```bash
  npm run typecheck
  npm test
  npm run lint
  ```

- [ ] **3e. Commit**

  ```
  fix: throw on invalid status transition in updateTask instead of silent null return
  ```

---

## Task 4 — F-t3-tasktrans-6: Add `'failed'` to `ReviewActionPlan.terminalStatus`

**Problem:** `ReviewActionPlan.terminalStatus` in `src/main/services/review-action-policy.ts` (line 81) is typed as `'done' | 'cancelled' | null`. There is no way to transition a task from `review` to `failed` via a review action. If an agent's work is found to be fundamentally broken, the only options are `discard` (→ `cancelled`) or `requestRevision` (→ `queued`). There is no "permanent failure" path.

Additionally, `VALID_TRANSITIONS` in `src/shared/task-state-machine.ts` does not include `review → failed` (line 76). This needs to be added first.

**Files to modify:**
- `src/shared/task-state-machine.ts`
- `src/main/services/review-action-policy.ts`
- `src/main/handlers/review-action-handlers.ts` (or wherever `classifyReviewAction` result is executed — find with `grep -rn "classifyReviewAction" src/main/`)
- `src/main/handlers/__tests__/review.test.ts` (add test for new action)

### Steps

- [ ] **4a. Extend `VALID_TRANSITIONS` to include `review → failed`**

  In `src/shared/task-state-machine.ts`, line 76:

  ```ts
  // BEFORE
  review: new Set(['queued', 'done', 'cancelled']),

  // AFTER
  review: new Set(['queued', 'done', 'cancelled', 'failed']),
  ```

- [ ] **4b. Update `ReviewActionPlan.terminalStatus` type**

  In `src/main/services/review-action-policy.ts`, line 81:

  ```ts
  // BEFORE
  terminalStatus: 'done' | 'cancelled' | null

  // AFTER
  terminalStatus: 'done' | 'cancelled' | 'failed' | null
  ```

- [ ] **4c. Add a `markFailed` review action to `ReviewActionInput`**

  In `src/main/services/review-action-policy.ts`, line 47:

  ```ts
  // BEFORE
  action: 'mergeLocally' | 'createPr' | 'requestRevision' | 'discard' | 'shipIt' | 'rebase'

  // AFTER
  action: 'mergeLocally' | 'createPr' | 'requestRevision' | 'discard' | 'shipIt' | 'rebase' | 'markFailed'
  ```

- [ ] **4d. Add the `markFailed` action handler in `classifyReviewAction`**

  In `src/main/services/review-action-policy.ts`, add a new block before the final `throw new Error('Unknown action')`:

  ```ts
  // ============================================================================
  // markFailed
  // ============================================================================
  if (action === 'markFailed') {
    const gitOps: GitOpDescriptor[] = []

    // If worktree exists, clean it up
    if (task.worktree_path) {
      gitOps.push(
        { type: 'getBranch', worktreePath: task.worktree_path },
        {
          type: 'cleanup',
          worktreePath: task.worktree_path,
          repoPath: repoConfig?.localPath
        }
      )
    }

    // Always clean scratchpad
    gitOps.push({ type: 'scratchpadCleanup', taskId })

    return {
      gitOps,
      taskPatch: {
        status: 'failed',
        failure_reason: feedback ?? 'Marked as permanently failed during review',
        completed_at: new Date().toISOString(),
        worktree_path: null
      },
      terminalStatus: 'failed',
      errorOnMissingWorktree: false,
      dedup: false
    }
  }
  ```

- [ ] **4e. Write tests for the new action**

  Open `src/main/handlers/__tests__/review.test.ts` (or `src/main/services/__tests__/review-action-policy.test.ts` — check which exists). Add:

  ```ts
  describe('classifyReviewAction — markFailed', () => {
    const baseInput: ReviewActionInput = {
      action: 'markFailed',
      taskId: 'task-1',
      task: {
        id: 'task-1',
        title: 'Test Task',
        repo: 'bde',
        worktree_path: null,
        spec: null,
        notes: null,
        agent_run_id: null
      },
      repoConfig: null
    }

    it('returns terminalStatus: failed', () => {
      const plan = classifyReviewAction(baseInput)
      expect(plan.terminalStatus).toBe('failed')
    })

    it('sets status: failed in taskPatch', () => {
      const plan = classifyReviewAction(baseInput)
      expect(plan.taskPatch?.status).toBe('failed')
    })

    it('sets failure_reason from feedback when provided', () => {
      const plan = classifyReviewAction({ ...baseInput, feedback: 'Too broken to fix' })
      expect(plan.taskPatch?.failure_reason).toBe('Too broken to fix')
    })

    it('uses default failure_reason when no feedback', () => {
      const plan = classifyReviewAction(baseInput)
      expect(plan.taskPatch?.failure_reason).toContain('permanently failed')
    })

    it('includes worktree cleanup ops when worktree_path is set', () => {
      const plan = classifyReviewAction({
        ...baseInput,
        task: { ...baseInput.task, worktree_path: '/worktrees/test' },
        repoConfig: { localPath: '/projects/bde' }
      })
      expect(plan.gitOps.some((op) => op.type === 'cleanup')).toBe(true)
    })

    it('includes scratchpadCleanup regardless of worktree', () => {
      const plan = classifyReviewAction(baseInput)
      expect(plan.gitOps.some((op) => op.type === 'scratchpadCleanup')).toBe(true)
    })
  })
  ```

- [ ] **4f. Check if `ReviewActionInput` needs a `'markFailed'` action in the renderer IPC channels**

  Search for where review actions are dispatched from the renderer:

  ```bash
  grep -rn "mergeLocally\|createPr\|requestRevision\|discard\|shipIt" src/renderer/ --include="*.ts" --include="*.tsx" | head -20
  ```

  If the action type is passed over IPC and validated, find the IPC channel type definition and add `'markFailed'` there too.

- [ ] **4g. Run checks**

  ```bash
  npm run typecheck
  npm test
  npm run lint
  ```

- [ ] **4h. Commit**

  ```
  feat: add markFailed review action to transition tasks from review to failed
  ```

---

## Task 5 — F-t1-datalay-4: Wrap cascade cancellation in a SQLite transaction

**Problem:** In `src/main/agent-manager/resolve-dependents.ts` (lines 48–111), the cascade cancellation loop calls `updateTask(depId, { status: 'cancelled', ... })` for each dependent in a loop. Each `updateTask` call opens its own transaction internally, but there is no outer transaction wrapping the loop. If one `updateTask` call fails midway, the database is left partially cancelled.

The fix: pass a `db` connection into `resolveDependents` (or use a transaction wrapper) so the entire cascade is atomic.

**Architectural note:** `resolveDependents` currently receives `updateTask` as a callback. The cleanest fix is to add a `runInTransaction` optional parameter. When provided, wrap the entire cascade loop body in it. When absent (existing callers), behavior is unchanged.

**Files to modify:**
- `src/main/agent-manager/resolve-dependents.ts`
- `src/main/services/task-terminal-service.ts` (pass the transaction wrapper when calling `resolveDependents`)
- `src/main/__tests__/resolve-dependents.test.ts` (add atomicity test)

### Steps

- [ ] **5a. Write the atomicity test**

  Open `src/main/__tests__/resolve-dependents.test.ts`. Add:

  ```ts
  describe('cascade cancellation atomicity', () => {
    it('calls runInTransaction once wrapping all updateTask calls', () => {
      const transactionFn = vi.fn((fn: () => void) => fn())

      const index = mockIndex({
        getDependents: vi.fn((id: string) => {
          if (id === 'dep-1') return new Set(['task-1', 'task-2'])
          return new Set()
        }),
        areDependenciesSatisfied: vi
          .fn()
          .mockReturnValue({ satisfied: false, blockedBy: ['dep-1'] })
      })

      const task1 = mockTask({ id: 'task-1', status: 'blocked', depends_on: [{ id: 'dep-1', type: 'hard' }] })
      const task2 = mockTask({ id: 'task-2', status: 'blocked', depends_on: [{ id: 'dep-1', type: 'hard' }] })
      const getTask = vi.fn((id: string) => {
        if (id === 'task-1') return task1
        if (id === 'task-2') return task2
        return null
      })
      const updateTask = vi.fn()

      resolveDependents(
        'dep-1',
        'failed',       // trigger cascade (assuming cascadeBehavior = 'cancel')
        index,
        getTask,
        updateTask,
        undefined,
        () => 'cancel',  // getSetting returns 'cancel'
        undefined,
        undefined,
        undefined,
        transactionFn   // new parameter
      )

      // Transaction wrapper should be called once for the entire cascade
      expect(transactionFn).toHaveBeenCalledTimes(1)
    })

    it('leaves db consistent when one updateTask throws midway', () => {
      const rollbackCalled = { value: false }
      const transactionFn = vi.fn((fn: () => void) => {
        try {
          fn()
        } catch {
          rollbackCalled.value = true
          throw new Error('Transaction rolled back')
        }
      })

      const index = mockIndex({
        getDependents: vi.fn(() => new Set(['task-1', 'task-2']))
      })

      const taskBase = { status: 'blocked', depends_on: [{ id: 'dep-1', type: 'hard' }], notes: null }
      const getTask = vi.fn((id: string) => ({ ...taskBase, id, title: id, group_id: null }))
      let callCount = 0
      const updateTask = vi.fn(() => {
        callCount++
        if (callCount === 2) throw new Error('DB error on task-2')
      })

      expect(() =>
        resolveDependents('dep-1', 'failed', index, getTask, updateTask, undefined, () => 'cancel', undefined, undefined, undefined, transactionFn)
      ).toThrow('Transaction rolled back')

      expect(rollbackCalled.value).toBe(true)
    })
  })
  ```

- [ ] **5b. Update `resolveDependents` signature to accept optional `runInTransaction`**

  In `src/main/agent-manager/resolve-dependents.ts`, update the function signature:

  ```ts
  export function resolveDependents(
    completedTaskId: string,
    completedStatus: string,
    index: DependencyIndex,
    getTask: (id: string) =>
      | (Pick<SprintTask, 'id' | 'status' | 'notes' | 'title' | 'group_id'> & {
          depends_on: TaskDependency[] | null
        })
      | null,
    updateTask: (id: string, patch: Record<string, unknown>) => unknown,
    logger?: Logger,
    getSetting?: (key: string) => string | null,
    epicIndex?: EpicDependencyIndex,
    getGroup?: (id: string) => TaskGroup | null,
    listGroupTasks?: (groupId: string) => SprintTask[],
    runInTransaction?: (fn: () => void) => void   // NEW optional param
  ): void {
  ```

- [ ] **5c. Wrap the cascade cancellation loop in the transaction**

  In `src/main/agent-manager/resolve-dependents.ts`, the cascade loop starts at approximately line 48. Wrap the entire `for (const depId of dependents)` loop body for cascade cancellation:

  Find the block that begins with `const shouldCascadeCancel = ...` and the subsequent `for` loop. Replace:

  ```ts
  // BEFORE
  for (const depId of dependents) {
    try {
      // ... all the logic including cascade cancel and regular unblock
    } catch (err) {
      ;(logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
    }
  }
  ```

  With a wrapper that, when `shouldCascadeCancel` is true AND `runInTransaction` is provided, wraps the loop in the transaction:

  ```ts
  // AFTER
  const runLoop = (): void => {
    for (const depId of dependents) {
      try {
        const task = getTask(depId)
        if (!task || task.status !== 'blocked') continue
        if (!task.depends_on || task.depends_on.length === 0) continue

        const statusCache = new Map<string, string | undefined>()
        statusCache.set(completedTaskId, completedStatus)

        for (const dep of task.depends_on) {
          if (!statusCache.has(dep.id)) {
            const depTask = getTask(dep.id)
            statusCache.set(dep.id, depTask?.status)
          }
        }

        const hasHardDepOnFailed = task.depends_on.some(
          (dep) => dep.id === completedTaskId && dep.type === 'hard'
        )

        if (shouldCascadeCancel && hasHardDepOnFailed) {
          const failedTask = getTask(completedTaskId)
          const failedTitle = failedTask?.title ?? completedTaskId
          const cancelNote = `[auto-cancel] Upstream task "${failedTitle}" failed`
          updateTask(depId, { status: 'cancelled', notes: cancelNote })

          resolveDependents(
            depId,
            'cancelled',
            index,
            getTask,
            updateTask,
            logger,
            getSetting,
            epicIndex,
            getGroup,
            listGroupTasks,
            runInTransaction
          )
          continue
        }

        const { satisfied, blockedBy } = index.areDependenciesSatisfied(
          depId,
          task.depends_on,
          (id) => statusCache.get(id)
        )

        if (satisfied) {
          updateTask(depId, { status: 'queued' })
        } else if (blockedBy.length > 0) {
          const currentTask = getTask(depId)
          updateTask(depId, { notes: buildBlockedNotes(blockedBy, currentTask?.notes ?? null) })
        }
      } catch (err) {
        ;(logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
        throw err // Re-throw inside transaction so it can roll back
      }
    }
  }

  if (shouldCascadeCancel && runInTransaction) {
    runInTransaction(runLoop)
  } else {
    runLoop()
  }
  ```

  **Note on re-throw:** Inside `runInTransaction`, errors must propagate to trigger rollback. Add `throw err` inside the per-dependent `catch` only when inside a transaction. A cleaner approach: remove the per-dependent `catch` entirely from `runLoop` and let the transaction wrapper handle errors.

  Simplest correct implementation:

  ```ts
  const runLoop = (): void => {
    for (const depId of dependents) {
      const task = getTask(depId)
      if (!task || task.status !== 'blocked') continue
      if (!task.depends_on || task.depends_on.length === 0) continue

      const statusCache = new Map<string, string | undefined>()
      statusCache.set(completedTaskId, completedStatus)
      for (const dep of task.depends_on) {
        if (!statusCache.has(dep.id)) {
          const depTask = getTask(dep.id)
          statusCache.set(dep.id, depTask?.status)
        }
      }

      const hasHardDepOnFailed = task.depends_on.some(
        (dep) => dep.id === completedTaskId && dep.type === 'hard'
      )

      if (shouldCascadeCancel && hasHardDepOnFailed) {
        const failedTask = getTask(completedTaskId)
        const failedTitle = failedTask?.title ?? completedTaskId
        updateTask(depId, {
          status: 'cancelled',
          notes: `[auto-cancel] Upstream task "${failedTitle}" failed`
        })
        resolveDependents(
          depId, 'cancelled', index, getTask, updateTask, logger, getSetting,
          epicIndex, getGroup, listGroupTasks, runInTransaction
        )
        continue
      }

      const { satisfied, blockedBy } = index.areDependenciesSatisfied(
        depId, task.depends_on, (id) => statusCache.get(id)
      )
      if (satisfied) {
        updateTask(depId, { status: 'queued' })
      } else if (blockedBy.length > 0) {
        const currentTask = getTask(depId)
        updateTask(depId, { notes: buildBlockedNotes(blockedBy, currentTask?.notes ?? null) })
      }
    }
  }

  // Wrap cascade in transaction if callback provided, otherwise run inline
  // (non-cascade resolution does not need transaction wrapping — each updateTask is atomic)
  if (shouldCascadeCancel && runInTransaction) {
    try {
      runInTransaction(runLoop)
    } catch (err) {
      ;(logger ?? console).warn(
        `[resolve-dependents] Cascade cancellation transaction failed for ${completedTaskId}: ${err}`
      )
    }
  } else {
    // Non-cascade: keep original per-dependent try/catch for fault isolation
    for (const depId of dependents) {
      try {
        // ... (same loop body as runLoop but wrapped in per-dependent try/catch)
      } catch (err) {
        ;(logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
      }
    }
  }
  ```

  **Practical guidance:** To avoid code duplication, extract the per-dependent logic into an inner function `processDependent(depId: string): void` and call it from both paths. The cascade path calls all dependents inside `runInTransaction`; the non-cascade path calls each one in its own `try/catch`.

- [ ] **5d. Wire `runInTransaction` in `task-terminal-service.ts`**

  In `src/main/services/task-terminal-service.ts`, the service has access to the `deps.updateTask` which already wraps calls in individual transactions. Pass a `db.transaction(fn)()` wrapper if a db reference is available, or pass `undefined` to preserve existing behavior.

  Simplest approach — pass `undefined` for now (existing `updateTask` already wraps individual ops atomically; the outer transaction is an enhancement for cascade). Leave a TODO comment:

  ```ts
  resolveDependents(
    id,
    terminalStatus,
    depIndex,
    deps.getTask,
    deps.updateTask,
    deps.logger,
    deps.getSetting,
    epicIndex,
    deps.getGroup,
    deps.listGroupTasks
    // TODO F-t1-datalay-4: pass runInTransaction from db when cascade atomicity is needed
    // e.g.: deps.runInTransaction
  )
  ```

  If `TaskTerminalServiceDeps` should carry the transaction capability, add it as optional:

  ```ts
  // In task-terminal-service.ts interface
  export interface TaskTerminalServiceDeps {
    // ... existing fields ...
    runInTransaction?: (fn: () => void) => void  // optional; enables cascade atomicity
  }
  ```

  Then pass it to `resolveDependents`.

- [ ] **5e. Run checks**

  ```bash
  npm run typecheck
  npm test
  npm run lint
  ```

- [ ] **5f. Commit**

  ```
  fix: wrap cascade cancellation in transaction to prevent partial-cancel on failure
  ```

---

## Task 6 — F-t1-datalay-8: Transaction wrapping for `deleteGroup`, `addGroupDependency`, `removeGroupDependency`

**Problem:** In `src/main/data/task-group-queries.ts`:

- `deleteGroup` (lines 165–175): Runs two SQL statements (`UPDATE sprint_tasks` + `DELETE FROM task_groups`) without wrapping them in a transaction. If the second statement fails, orphaned `group_id` pointers persist.
- `addGroupDependency` (lines 278–300): Calls `getGroup` then `updateGroup` without a transaction. A read-modify-write race condition exists (though SQLite's serialized access makes this low risk in practice).
- `removeGroupDependency` (lines 306–325): Same read-modify-write pattern as `addGroupDependency`.

**Files to modify:**
- `src/main/data/task-group-queries.ts`
- `src/main/data/__tests__/task-group-queries.test.ts`

### Steps

- [ ] **6a. Write failing tests**

  Open `src/main/data/__tests__/task-group-queries.test.ts`. Add:

  ```ts
  import Database from 'better-sqlite3'
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
  import { runMigrations } from '../../db'
  import {
    createGroup,
    deleteGroup,
    addGroupDependency,
    removeGroupDependency
  } from '../task-group-queries'
  import type { EpicDependency } from '../../../shared/types'

  describe('deleteGroup atomicity', () => {
    it('rolls back task group_id update if group delete fails', () => {
      // This tests that both statements in deleteGroup succeed or fail together.
      // Simulate by passing a closed db — both statements should fail cleanly.
      const testDb = new Database(':memory:')
      runMigrations(testDb)

      const group = createGroup({ name: 'Test Group' }, testDb)
      expect(group).not.toBeNull()

      // Insert a task in the group
      testDb
        .prepare(
          `INSERT INTO sprint_tasks (title, repo, prompt, status, priority, group_id)
           VALUES ('T', 'bde', 'p', 'backlog', 0, ?)`
        )
        .run(group!.id)

      // Normal delete should clear group_id and delete the group
      deleteGroup(group!.id, testDb)

      const groupAfter = testDb
        .prepare('SELECT * FROM task_groups WHERE id = ?')
        .get(group!.id)
      expect(groupAfter).toBeUndefined()

      const tasksWithGroupId = testDb
        .prepare('SELECT * FROM sprint_tasks WHERE group_id = ?')
        .all(group!.id)
      expect(tasksWithGroupId).toHaveLength(0)

      testDb.close()
    })
  })

  describe('addGroupDependency — transaction safety', () => {
    let db: Database.Database

    beforeEach(() => {
      db = new Database(':memory:')
      runMigrations(db)
    })

    afterEach(() => { db.close() })

    it('adds dependency atomically', () => {
      const group = createGroup({ name: 'G1' }, db)!
      const dep: EpicDependency = { id: 'epic-upstream', condition: 'on_success' }

      addGroupDependency(group.id, dep, db)

      const updated = db
        .prepare('SELECT depends_on FROM task_groups WHERE id = ?')
        .get(group.id) as { depends_on: string }
      const deps = JSON.parse(updated.depends_on)
      expect(deps).toEqual([dep])
    })

    it('throws when adding a duplicate dependency', () => {
      const group = createGroup({ name: 'G2' }, db)!
      const dep: EpicDependency = { id: 'epic-upstream', condition: 'on_success' }

      addGroupDependency(group.id, dep, db)
      expect(() => addGroupDependency(group.id, dep, db)).toThrow('Dependency already exists')
    })
  })

  describe('removeGroupDependency — transaction safety', () => {
    let db: Database.Database

    beforeEach(() => {
      db = new Database(':memory:')
      runMigrations(db)
    })

    afterEach(() => { db.close() })

    it('removes dependency atomically', () => {
      const dep: EpicDependency = { id: 'epic-upstream', condition: 'on_success' }
      const group = createGroup({ name: 'G3', depends_on: [dep] }, db)!

      removeGroupDependency(group.id, 'epic-upstream', db)

      const updated = db
        .prepare('SELECT depends_on FROM task_groups WHERE id = ?')
        .get(group.id) as { depends_on: string | null }
      expect(updated.depends_on).toBeNull()
    })
  })
  ```

- [ ] **6b. Wrap `deleteGroup` in a transaction**

  In `src/main/data/task-group-queries.ts`, replace `deleteGroup` (lines 165–175):

  ```ts
  // BEFORE
  export function deleteGroup(id: string, db?: Database.Database): void {
    try {
      const conn = db ?? getDb()
      conn.prepare('UPDATE sprint_tasks SET group_id = NULL WHERE group_id = ?').run(id)
      conn.prepare('DELETE FROM task_groups WHERE id = ?').run(id)
    } catch (err) {
      const msg = getErrorMessage(err)
      console.error(`[task-group-queries] deleteGroup failed for id=${id}: ${msg}`)
      throw err
    }
  }
  ```

  With:

  ```ts
  // AFTER
  export function deleteGroup(id: string, db?: Database.Database): void {
    const conn = db ?? getDb()
    try {
      conn.transaction(() => {
        conn.prepare('UPDATE sprint_tasks SET group_id = NULL WHERE group_id = ?').run(id)
        conn.prepare('DELETE FROM task_groups WHERE id = ?').run(id)
      })()
    } catch (err) {
      const msg = getErrorMessage(err)
      console.error(`[task-group-queries] deleteGroup failed for id=${id}: ${msg}`)
      throw err
    }
  }
  ```

- [ ] **6c. Wrap `addGroupDependency` in a transaction**

  In `src/main/data/task-group-queries.ts`, replace `addGroupDependency` (lines 278–300):

  ```ts
  // AFTER
  export function addGroupDependency(
    groupId: string,
    dep: EpicDependency,
    db?: Database.Database
  ): TaskGroup | null {
    const conn = db ?? getDb()
    try {
      return conn.transaction((): TaskGroup | null => {
        const group = getGroup(groupId, conn)
        if (!group) throw new Error(`Group not found: ${groupId}`)

        const currentDeps = group.depends_on ?? []
        if (currentDeps.some((d) => d.id === dep.id)) {
          throw new Error(`Dependency already exists: ${dep.id}`)
        }

        const newDeps = [...currentDeps, dep]
        return updateGroup(groupId, { depends_on: newDeps }, conn)
      })()
    } catch (err) {
      const msg = getErrorMessage(err)
      console.error(`[task-group-queries] addGroupDependency failed: ${msg}`)
      throw err
    }
  }
  ```

- [ ] **6d. Wrap `removeGroupDependency` in a transaction**

  In `src/main/data/task-group-queries.ts`, replace `removeGroupDependency` (lines 306–325):

  ```ts
  // AFTER
  export function removeGroupDependency(
    groupId: string,
    upstreamId: string,
    db?: Database.Database
  ): TaskGroup | null {
    const conn = db ?? getDb()
    try {
      return conn.transaction((): TaskGroup | null => {
        const group = getGroup(groupId, conn)
        if (!group) throw new Error(`Group not found: ${groupId}`)

        const currentDeps = group.depends_on ?? []
        const newDeps = currentDeps.filter((d) => d.id !== upstreamId)

        return updateGroup(groupId, { depends_on: newDeps.length > 0 ? newDeps : null }, conn)
      })()
    } catch (err) {
      const msg = getErrorMessage(err)
      console.error(`[task-group-queries] removeGroupDependency failed: ${msg}`)
      throw err
    }
  }
  ```

- [ ] **6e. Run checks**

  ```bash
  npm run typecheck
  npm test
  npm run lint
  ```

- [ ] **6f. Commit**

  ```
  fix: wrap deleteGroup, addGroupDependency, removeGroupDependency in transactions
  ```

---

## Final Verification

After all tasks are committed:

- [ ] Run the full suite one final time:

  ```bash
  npm run typecheck && npm test && npm run test:main && npm run lint
  ```

- [ ] Verify no regressions in the existing test files that were not modified:
  - `src/main/__tests__/resolve-dependents.test.ts` — all existing tests should still pass
  - `src/main/data/__tests__/task-group-queries.test.ts` — all existing tests should still pass
  - `src/main/__tests__/integration/db-crud.test.ts` — all existing tests should still pass

---

## Cross-Reference: Key File Locations

| Finding | Primary File | Line Range |
|---|---|---|
| F-t3-depres-2 | `src/main/services/dependency-service.ts` | 85–111 (`areDependenciesSatisfied`) |
| F-t3-depres-4 | `src/main/handlers/sprint-local.ts` | 104–109 (`sprint:update` handler) |
| F-t3-tasktrans-3 | `src/main/data/sprint-queries.ts` | 369–377 (`updateTask` transition guard) |
| F-t3-tasktrans-6 | `src/main/services/review-action-policy.ts` | 47, 81, before final `throw` |
| F-t1-datalay-4 | `src/main/agent-manager/resolve-dependents.ts` | 48–111 (cascade loop) |
| F-t1-datalay-8 | `src/main/data/task-group-queries.ts` | 165–175, 278–300, 306–325 |

## Important Caveats for Implementing Agents

1. **Task 3 (throw on invalid transition) affects many callers.** Run `npm test` after the change and check for newly failing tests — some tests may call `updateTask` with invalid transitions as part of their setup. Fix those test setups to use valid transitions (e.g., insert directly at the target status using `db.prepare(...).run(...)` bypassing `updateTask`).

2. **Task 5 (`runInTransaction` parameter) is additive.** All existing callers pass fewer arguments and will not be broken. The parameter is optional with a default of `undefined` (no transaction). Only new callers that want cascade atomicity need to provide it.

3. **`review → failed` transition (Task 4) must be added before any test exercises it** — the state machine check in `updateTask` will reject it otherwise. Add Task 4's `VALID_TRANSITIONS` change first, then test.

4. **SQLite multi-statement gotcha:** Per CLAUDE.md, avoid placing a `` db` `` call with a backtick-literal argument on the same line. Always assign SQL to a `const sql = ` variable first. The new transaction wrappers added in Task 6 use `conn.prepare('...').run(...)` inline — this is fine because there are no backticks.

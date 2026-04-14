# Quick Wins Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 15 S-effort audit findings across dependency resolution, IPC types, data layer logging, and input validation.

**Architecture:** Each fix is surgical — no file restructuring. Changes are confined to specific call sites or existing files.

**Tech Stack:** TypeScript, Electron (main + renderer), SQLite via better-sqlite3, React, Vitest for tests.

---

## Build & Test Commands

```bash
npm run typecheck    # zero TypeScript errors required
npm test             # renderer + shared unit tests (vitest)
npm run test:main    # main-process unit tests (separate vitest config)
npm run lint         # eslint — zero errors required (warnings OK)
```

Tests live alongside source files in `src/`. Run `npm run typecheck` after every change before committing.

---

## Task 1 — F-t3-tasktrans-1: Cascade cancel must call `onTaskTerminal` for each cancelled dependent

**Problem:** In `src/main/agent-manager/resolve-dependents.ts`, the cascade-cancel branch (around line 72) calls `updateTask(depId, { status: 'cancelled' })` and recursively calls `resolveDependents(depId, 'cancelled', ...)`, but never calls `onTaskTerminal(depId, 'cancelled')`. This means `TaskTerminalService` is never invoked for cascade-cancelled tasks, so their own dependents are never unblocked and the dependency chain stalls.

### Files to modify
- `src/main/agent-manager/resolve-dependents.ts`
- `src/main/agent-manager/__tests__/resolve-dependents.test.ts`

### Step-by-step

- [ ] **1a. Write a failing test** in `src/main/agent-manager/__tests__/resolve-dependents.test.ts`:

```typescript
it('calls onTaskTerminal for each cascade-cancelled dependent', () => {
  // Task A failed (hard dep). B depends on A (hard). C depends on B (hard).
  const index = makeIndex({ A: ['B'], B: ['C'] })
  const tasks: Record<string, MockTask> = {
    A: { id: 'A', status: 'failed', title: 'A', notes: null, depends_on: null },
    B: { id: 'B', status: 'blocked', title: 'B', notes: null, depends_on: [hardDep('A')] },
    C: { id: 'C', status: 'blocked', title: 'C', notes: null, depends_on: [hardDep('B')] }
  }
  const getTask = vi.fn((id: string) => tasks[id] ?? null)
  const updateTask = vi.fn().mockImplementation(
    (id: string, patch: Record<string, unknown>) => {
      if (patch.status) tasks[id] = { ...tasks[id], status: patch.status as string }
      return tasks[id]
    }
  )
  const onTaskTerminal = vi.fn()
  const getSetting = vi.fn().mockReturnValue('cancel') // cascade enabled

  resolveDependents(
    'A', 'failed', index, getTask, updateTask,
    undefined, getSetting, undefined, undefined, undefined,
    onTaskTerminal
  )

  // B and C should both be cancelled and notified
  expect(updateTask).toHaveBeenCalledWith('B', expect.objectContaining({ status: 'cancelled' }))
  expect(updateTask).toHaveBeenCalledWith('C', expect.objectContaining({ status: 'cancelled' }))
  expect(onTaskTerminal).toHaveBeenCalledWith('B', 'cancelled')
  expect(onTaskTerminal).toHaveBeenCalledWith('C', 'cancelled')
})
```

Run `npm run test:main` — this test should **fail** (`onTaskTerminal` param doesn't exist yet).

- [ ] **1b. Update the function signature** in `src/main/agent-manager/resolve-dependents.ts`. Add `onTaskTerminal` as the last optional parameter:

```typescript
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
  onTaskTerminal?: (taskId: string, status: string) => void
): void {
```

- [ ] **1c. Call `onTaskTerminal` after each cascade cancel** in the cascade-cancel block (around line 72). Replace the existing block:

```typescript
      if (shouldCascadeCancel && hasHardDepOnFailed) {
        const failedTask = getTask(completedTaskId)
        const failedTitle = failedTask?.title ?? completedTaskId
        const cancelNote = `[auto-cancel] Upstream task "${failedTitle}" failed`
        updateTask(depId, { status: 'cancelled', notes: cancelNote })
        // Notify terminal listeners so dependents of this cancelled task are resolved
        try {
          onTaskTerminal?.(depId, 'cancelled')
        } catch (err) {
          ;(logger ?? console).warn(
            `[resolve-dependents] onTaskTerminal threw for ${depId}: ${err}`
          )
        }

        // Recursively cancel this task's blocked dependents
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
          onTaskTerminal
        )
        continue
      }
```

- [ ] **1d. Update the call site in `src/main/agent-manager/index.ts`** (inside `onTaskTerminal` method, in the `else` branch, around line 247):

```typescript
            resolveDependents(
              taskId,
              status,
              this._depIndex,
              this.repo.getTask,
              this.repo.updateTask,
              this.logger,
              getSetting,
              this._epicIndex,
              this.repo.getGroup,
              this.repo.getGroupTasks,
              this.onTaskTerminal.bind(this)
            )
```

- [ ] **1e. Verify:** `npm run typecheck && npm run test:main`

---

## Task 2 — F-t3-depres-1: Document soft dependency semantics with JSDoc

**Problem:** The soft dependency contract ("unblock on any terminal outcome") is implemented correctly but undocumented in `dependency-service.ts`. The `areDependenciesSatisfied` function has no JSDoc, and some test descriptions in `dependency-index.test.ts` use ambiguous wording that makes the behavior look like a bug.

### Files to modify
- `src/main/services/dependency-service.ts`
- `src/main/agent-manager/__tests__/dependency-index.test.ts`

### Step-by-step

- [ ] **2a. Add a JSDoc comment** in `src/main/services/dependency-service.ts` directly above `areDependenciesSatisfied` inside the `createDependencyIndex` return object (around line 85):

```typescript
    /**
     * Determine whether a task's dependencies are all satisfied.
     *
     * Semantics by dependency type / condition:
     *
     * - **hard** (no condition set): upstream must be in `HARD_SATISFIED_STATUSES`
     *   (currently only `'done'`). A failed/cancelled/errored hard dependency
     *   keeps the downstream task blocked indefinitely.
     *
     * - **soft** (no condition set): upstream must be in `TERMINAL_STATUSES`
     *   (`done`, `cancelled`, `failed`, `error`). The downstream task unblocks
     *   regardless of whether the upstream succeeded or failed — "unblock on any
     *   terminal outcome".
     *
     * - **condition: 'on_success'**: equivalent to hard — upstream must be `done`.
     * - **condition: 'on_failure'**: upstream must be in `FAILURE_STATUSES`.
     * - **condition: 'always'**: upstream must be in `TERMINAL_STATUSES` (same as soft).
     *
     * Deleted upstream tasks (status `undefined`) are treated as satisfied to avoid
     * permanently blocking downstream tasks when an upstream task is removed.
     */
    areDependenciesSatisfied(_taskId, deps, getTaskStatus) {
```

- [ ] **2b. Rename misleading test descriptions** in `src/main/agent-manager/__tests__/dependency-index.test.ts`. Search for any test where the name implies incorrect behavior. For example, if you find a test like:

```typescript
test('soft dep cancelled = satisfied')
```

Rename to:

```typescript
test('soft dep cancelled = satisfied (soft unblocks on any terminal outcome)')
```

Search the file for all test names in the `areDependenciesSatisfied` describe block and ensure each name describes the expected outcome correctly. Do not change test logic — only rename.

- [ ] **2c. Verify:** `npm run typecheck && npm run test:main`

---

## Task 3 — F-t3-depres-5: Verify `detectEpicCycle` is called before persisting epic dependencies

**Note on findings:** After reading `src/main/handlers/group-handlers.ts`, `detectEpicCycle` IS already called in the `groups:addDependency` IPC handler. The gap identified by the audit is (1) the lack of a safety comment in the data-layer function warning callers about this requirement, and (2) no unit test verifying the IPC handler enforces cycle detection.

### Files to modify
- `src/main/data/task-group-queries.ts`
- `src/main/handlers/__tests__/group-handlers.test.ts` (create)

### Step-by-step

- [ ] **3a. Create `src/main/handlers/__tests__/group-handlers.test.ts`** with cycle-detection tests:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../data/task-group-queries', () => ({
  createGroup: vi.fn(),
  listGroups: vi.fn().mockReturnValue([]),
  getGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addTaskToGroup: vi.fn(),
  removeTaskFromGroup: vi.fn(),
  getGroupTasks: vi.fn().mockReturnValue([]),
  queueAllGroupTasks: vi.fn(),
  reorderGroupTasks: vi.fn(),
  addGroupDependency: vi.fn(),
  removeGroupDependency: vi.fn(),
  updateGroupDependencyCondition: vi.fn()
}))

vi.mock('../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

import { registerGroupHandlers } from '../group-handlers'
import { safeHandle } from '../ipc-utils'
import * as groupQueries from '../../data/task-group-queries'

type Handler = (event: unknown, ...args: unknown[]) => unknown

describe('groups:addDependency cycle detection', () => {
  let handlers: Record<string, Handler>
  const mockEvent = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(safeHandle).mockImplementation((channel, handler) => {
      handlers[channel as string] = handler as Handler
    })
    registerGroupHandlers()
  })

  it('throws on self-cycle (epicId === dep.id)', () => {
    vi.mocked(groupQueries.getGroup).mockReturnValue({
      id: 'epic-A', name: 'Epic A', icon: 'G', accent_color: '#fff',
      goal: null, status: 'draft', created_at: '', updated_at: '',
      depends_on: []
    })

    expect(() =>
      handlers['groups:addDependency'](mockEvent, 'epic-A', { id: 'epic-A', condition: 'on_success' })
    ).toThrow(/cycle/i)

    expect(groupQueries.addGroupDependency).not.toHaveBeenCalled()
  })

  it('throws on transitive cycle (A depends on B, then adding B depends on A)', () => {
    vi.mocked(groupQueries.getGroup).mockImplementation((id: string) => {
      if (id === 'epic-A') {
        return {
          id: 'epic-A', name: 'A', icon: 'G', accent_color: '#fff', goal: null,
          status: 'draft', created_at: '', updated_at: '', depends_on: []
        }
      }
      if (id === 'epic-B') {
        return {
          id: 'epic-B', name: 'B', icon: 'G', accent_color: '#fff', goal: null,
          status: 'draft', created_at: '', updated_at: '',
          depends_on: [{ id: 'epic-A', condition: 'on_success' as const }]
        }
      }
      return null
    })

    // epic-A already has no deps. epic-B depends on epic-A.
    // Now trying to make epic-A depend on epic-B creates A→B→A cycle.
    expect(() =>
      handlers['groups:addDependency'](mockEvent, 'epic-A', { id: 'epic-B', condition: 'always' })
    ).toThrow(/cycle/i)

    expect(groupQueries.addGroupDependency).not.toHaveBeenCalled()
  })

  it('allows adding a non-cyclical dependency', () => {
    vi.mocked(groupQueries.getGroup).mockImplementation((id: string) => ({
      id, name: id, icon: 'G', accent_color: '#fff', goal: null,
      status: 'draft', created_at: '', updated_at: '', depends_on: []
    }))
    vi.mocked(groupQueries.addGroupDependency).mockReturnValue({
      id: 'epic-A', name: 'A', icon: 'G', accent_color: '#fff', goal: null,
      status: 'draft', created_at: '', updated_at: '',
      depends_on: [{ id: 'epic-B', condition: 'on_success' as const }]
    })

    expect(() =>
      handlers['groups:addDependency'](mockEvent, 'epic-A', { id: 'epic-B', condition: 'on_success' })
    ).not.toThrow()

    expect(groupQueries.addGroupDependency).toHaveBeenCalledOnce()
  })
})
```

Run `npm run test:main` — should **pass** (the handler already has cycle detection).

- [ ] **3b. Add a safety comment** in `src/main/data/task-group-queries.ts` above the `addGroupDependency` function. Find the function and add:

```typescript
/**
 * Persist a new epic dependency edge to the database.
 *
 * IMPORTANT: Cycle detection MUST be performed BEFORE calling this function.
 * Use `detectEpicCycle()` from `src/main/services/epic-dependency-service.ts`.
 * All callers must go through the `groups:addDependency` IPC handler in
 * `src/main/handlers/group-handlers.ts`, which enforces this invariant.
 * Direct calls to this function that bypass cycle detection can corrupt the
 * epic dependency graph.
 */
export function addGroupDependency(
```

- [ ] **3c. Verify:** `npm run typecheck && npm run test:main`

---

## Task 4 — F-t3-depres-3: Rebuild dependency index before `resolveDependents` in `onTaskTerminal`

**Problem:** `AgentManagerImpl.onTaskTerminal()` calls `resolveDependents(...)` using `this._depIndex`, which is only updated during `_drainLoop`. If tasks are created or their `depends_on` mutated between two drain-loop ticks, the in-memory index is stale when `onTaskTerminal` fires. Fix: call `this._depIndex.rebuild(...)` with fresh task data immediately before invoking `resolveDependents` in the `else` branch of `onTaskTerminal`.

### Files to modify
- `src/main/agent-manager/index.ts`
- `src/main/agent-manager/__tests__/index-extracted.test.ts` (or add to `index.test.ts`)

### Step-by-step

- [ ] **4a. Write a test** verifying that `onTaskTerminal` rebuilds the index before resolving. Find or create a suitable test file (`src/main/agent-manager/__tests__/index-extracted.test.ts` already exists). Add:

```typescript
it('onTaskTerminal rebuilds dep index before calling resolveDependents', async () => {
  // After A completes, B (which depends on A) should be unblocked
  const freshTasks = [
    { id: 'task-A', status: 'done', depends_on: null },
    { id: 'task-B', status: 'blocked', depends_on: [{ id: 'task-A', type: 'hard' }] }
  ]

  const mockRepo = buildMockRepo() // use whatever helper the test file already has
  vi.mocked(mockRepo.getTask).mockImplementation(
    (id: string) => (freshTasks.find(t => t.id === id) ?? null) as SprintTask | null
  )
  vi.mocked(mockRepo.getTasksWithDependencies).mockReturnValue(freshTasks as SprintTask[])
  vi.mocked(mockRepo.updateTask).mockReturnValue(null)

  const manager = new AgentManagerImpl(testConfig, mockRepo, testLogger)
  const rebuildSpy = vi.spyOn(manager._depIndex, 'rebuild')

  await manager.onTaskTerminal('task-A', 'done')

  expect(rebuildSpy).toHaveBeenCalled()
  expect(mockRepo.updateTask).toHaveBeenCalledWith(
    'task-B',
    expect.objectContaining({ status: 'queued' })
  )
})
```

Run `npm run test:main` — **fails** (rebuild not called).

- [ ] **4b. Add rebuild call** in `src/main/agent-manager/index.ts` inside the `else` branch of `onTaskTerminal` (the branch that runs when `this.config.onStatusTerminal` is not set, around line 244). Replace the existing try-block:

```typescript
        } else {
          // DESIGN: Inline resolution for immediate drain loop feedback.
          // Rebuild dep index first to pick up any tasks created/modified since
          // the last drain tick — stale index causes missed unblocking.
          try {
            const freshTasks = this.repo.getTasksWithDependencies()
            this._depIndex.rebuild(freshTasks)
          } catch (rebuildErr) {
            this.logger.warn(
              `[agent-manager] dep index rebuild failed before resolution for ${taskId}: ${rebuildErr}`
            )
          }
          try {
            resolveDependents(
              taskId,
              status,
              this._depIndex,
              this.repo.getTask,
              this.repo.updateTask,
              this.logger,
              getSetting,
              this._epicIndex,
              this.repo.getGroup,
              this.repo.getGroupTasks,
              this.onTaskTerminal.bind(this)
            )
          } catch (err) {
            this.logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
          }
        }
```

- [ ] **4c. Verify:** `npm run typecheck && npm run test:main`

---

## Task 5 — F-t3-tasktrans-7: Add terminal-status guard to `resolveDependents`

**Problem:** `resolveDependents` can be called with any string for `completedStatus`. If called with a non-terminal status (e.g., `'active'` or `'queued'`), cascade-cancel and satisfaction checks run with nonsensical semantics. A guard at the top of the function prevents this footgun.

### Files to modify
- `src/main/agent-manager/resolve-dependents.ts`
- `src/main/agent-manager/__tests__/resolve-dependents.test.ts`

### Step-by-step

- [ ] **5a. Write failing tests** in `src/main/agent-manager/__tests__/resolve-dependents.test.ts`:

```typescript
it('returns immediately when completedStatus is "active" (non-terminal)', () => {
  const index = makeIndex({ A: ['B'] })
  const getTask = vi.fn()
  const updateTask = vi.fn()

  resolveDependents('A', 'active', index, getTask, updateTask)

  expect(getTask).not.toHaveBeenCalled()
  expect(updateTask).not.toHaveBeenCalled()
})

it('returns immediately when completedStatus is "queued" (non-terminal)', () => {
  const index = makeIndex({ A: ['B'] })
  const getTask = vi.fn()
  const updateTask = vi.fn()

  resolveDependents('A', 'queued', index, getTask, updateTask)

  expect(getTask).not.toHaveBeenCalled()
  expect(updateTask).not.toHaveBeenCalled()
})

it('proceeds normally when completedStatus is "done" (terminal)', () => {
  const index = makeIndex({ A: ['B'] })
  const tasks: Record<string, MockTask> = {
    B: { id: 'B', status: 'blocked', notes: null, depends_on: [hardDep('A')] }
  }
  const getTask = vi.fn((id: string) => tasks[id] ?? null)
  const updateTask = vi.fn()

  resolveDependents('A', 'done', index, getTask, updateTask)

  expect(getTask).toHaveBeenCalledWith('B')
})
```

Run `npm run test:main` — first two tests **fail** (no guard yet).

- [ ] **5b. Check if `TERMINAL_STATUSES` is already imported** at the top of `resolve-dependents.ts`. Looking at the current imports:

```typescript
import {
  type DependencyIndex,
  buildBlockedNotes,
  computeBlockState,
  FAILURE_STATUSES
} from '../services/dependency-service'
```

`TERMINAL_STATUSES` is not imported. Add it:

```typescript
import {
  type DependencyIndex,
  buildBlockedNotes,
  computeBlockState,
  FAILURE_STATUSES,
  TERMINAL_STATUSES
} from '../services/dependency-service'
```

- [ ] **5c. Add early-return guard** as the very first statement in the function body (before `const dependents = index.getDependents(completedTaskId)`):

```typescript
  // Guard: only process terminal statuses — calling with active/queued/blocked
  // produces nonsensical cascade-cancel and satisfaction results.
  if (!TERMINAL_STATUSES.has(completedStatus)) {
    logger?.warn(
      `[resolve-dependents] Called with non-terminal status "${completedStatus}" for task ${completedTaskId} — skipping`
    )
    return
  }

  const dependents = index.getDependents(completedTaskId)
```

- [ ] **5d. Verify:** `npm run typecheck && npm run test:main`

---

## Task 6 — F-t3-tasktrans-5: Move `onStatusTerminal` before `notifySprintMutation` in `createPr`

**Problem:** In `src/main/services/review-orchestration-service.ts`, `createPr` calls `notifySprintMutation('updated', updated)` before `i.onStatusTerminal(i.taskId, 'done')`. This means the renderer receives the `sprint:mutation` broadcast showing the task as `done` BEFORE downstream dependents are unblocked. Users see a brief inconsistent state in the pipeline. The fix swaps the call order.

Current code (around lines 125–131):
```typescript
    const updated = updateTask(i.taskId, {
      status: 'done',
      completed_at: nowIso(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    i.onStatusTerminal(i.taskId, 'done')
```

### Files to modify
- `src/main/services/review-orchestration-service.ts`
- `src/main/services/__tests__/review-orchestration-service.test.ts`

### Step-by-step

- [ ] **6a. Write a failing test** in `src/main/services/__tests__/review-orchestration-service.test.ts`. Find the `createPr` describe block and add a test that verifies call order. Use the existing mock setup pattern in that file:

```typescript
  describe('createPr call ordering', () => {
    it('calls onStatusTerminal before notifySprintMutation', async () => {
      const callOrder: string[] = []

      vi.mocked(sprintService.getTask).mockReturnValue({
        id: 'task-1', repo: 'bde', worktree_path: '/wt/task-1',
        status: 'review', title: 'Test', spec: null, prompt: null,
        notes: null, pr_url: null, pr_number: null, pr_status: null,
        created_at: '2026-01-01T00:00:00Z', completed_at: null,
        claimed_by: null, retry_count: 0, fast_fail_count: 0,
        playground_enabled: false, depends_on: null, group_id: null,
        priority: 1, tags: null, template_name: null, spec_type: null,
        model: null, partial_diff: null, revision_feedback: null,
        max_runtime_ms: null, max_cost_usd: null,
        cross_repo_contract: null, sort_order: 0,
        next_eligible_at: null, duration_ms: null, failure_reason: null,
        retry_context: null, rebase_conflict: null, rebase_branch: null,
        review_diff_snapshot: null, agent_run_id: null,
        session_id: null, worktree_branch: null
      } as unknown as SprintTask)

      vi.mocked(sprintService.updateTask).mockReturnValue({
        id: 'task-1', status: 'done'
      } as unknown as SprintTask)

      vi.mocked(sprintService.notifySprintMutation).mockImplementation(() => {
        callOrder.push('notify')
      })

      vi.mocked(reviewPr.createPullRequest).mockResolvedValue({
        success: true,
        prUrl: 'https://github.com/owner/repo/pull/1',
        prNumber: 1
      })

      getCustomMock()
        .mockReset()
        .mockImplementation(async (_cmd: string, args: readonly string[]) => {
          if (args.includes('--abbrev-ref')) return { stdout: 'agent/branch\n', stderr: '' }
          return { stdout: '', stderr: '' }
        })

      vi.mocked(reviewMerge.cleanupWorktree).mockResolvedValue(undefined)

      const onStatusTerminal = vi.fn().mockImplementation(async () => {
        callOrder.push('terminal')
      })

      await orchestration.createPr({
        taskId: 'task-1',
        title: 'PR title',
        body: 'PR body',
        env: mockEnv,
        onStatusTerminal
      })

      expect(callOrder).toEqual(['terminal', 'notify'])
    })
  })
```

Run `npm run test:main` — **fails** (current order is `['notify', 'terminal']`).

- [ ] **6b. Swap the call order** in `src/main/services/review-orchestration-service.ts`. Find lines ~125–131 and change:

```typescript
    const updated = updateTask(i.taskId, {
      status: 'done',
      completed_at: nowIso(),
      worktree_path: null
    })
    // Fire terminal callback before broadcast so dependency resolution completes
    // before the renderer receives the mutation — avoids stale pipeline state.
    i.onStatusTerminal(i.taskId, 'done')
    if (updated) notifySprintMutation('updated', updated)
    return { success: true, prUrl: pr.prUrl }
```

- [ ] **6c. Verify:** `npm run typecheck && npm run test:main`

---

## Task 7 — F-t1-ipcsurf-1: Add 8 tearoff broadcast channels to `BroadcastChannels`

**Problem:** In `src/main/tearoff-manager.ts`, these 8 channels are sent via `webContents.send()` but none are declared in `BroadcastChannels`:
- `tearoff:confirmClose` — `{ windowId: string }`
- `tearoff:tabReturned` — `{ windowId: string; view: string }`
- `tearoff:tabRemoved` — `{ windowId: string; view: string; newWindow?: boolean }`
- `tearoff:dragIn` — `{ viewKey: string; x: number; y: number }`
- `tearoff:dragMove` — `{ x: number; y: number }`
- `tearoff:dragDone` — `void`
- `tearoff:dragCancel` — `void`
- `tearoff:crossWindowDrop` — `{ viewKey: string; x: number; y: number; sourceWindowId: string }`

Payload shapes confirmed by reading tearoff-manager.ts lines: confirmClose (223), tabReturned (193/599/624), tabRemoved (517), dragIn (342/414), dragMove (350), dragDone (432), dragCancel (337/356/454), crossWindowDrop (437).

### Files to modify
- `src/shared/ipc-channels/broadcast-channels.ts`

### Step-by-step

- [ ] **7a. Write a compile-time test** in a new file `src/shared/ipc-channels/__tests__/broadcast-channels.test.ts`:

```typescript
import { describe, it } from 'vitest'
import type { BroadcastChannels } from '../broadcast-channels'

// Type-level smoke test — compile errors here mean channels are missing
describe('BroadcastChannels tearoff entries (compile-time)', () => {
  it('all 8 tearoff channels are declared', () => {
    const channels: Array<keyof BroadcastChannels> = [
      'tearoff:confirmClose',
      'tearoff:tabReturned',
      'tearoff:tabRemoved',
      'tearoff:dragIn',
      'tearoff:dragMove',
      'tearoff:dragDone',
      'tearoff:dragCancel',
      'tearoff:crossWindowDrop'
    ]
    expect(channels).toHaveLength(8)
  })
})
```

Run `npm run typecheck` — **fails** with type errors because the keys don't exist.

- [ ] **7b. Add the 8 channel declarations** to `src/shared/ipc-channels/broadcast-channels.ts`. Find the closing `}` of the `BroadcastChannels` interface and add before it:

```typescript
  // Tearoff window tab/drag events (pushed via webContents.send from tearoff-manager.ts)
  'tearoff:confirmClose': { windowId: string }
  'tearoff:tabReturned': { windowId: string; view: string }
  'tearoff:tabRemoved': { windowId: string; view: string; newWindow?: boolean }
  'tearoff:dragIn': { viewKey: string; x: number; y: number }
  'tearoff:dragMove': { x: number; y: number }
  'tearoff:dragDone': void
  'tearoff:dragCancel': void
  'tearoff:crossWindowDrop': { viewKey: string; x: number; y: number; sourceWindowId: string }
```

- [ ] **7c. Verify:** `npm run typecheck && npm test`

---

## Task 8 — F-t1-ipcsurf-2: Remove duplicate `agent:event` from `AgentEventChannels`

**Problem:** `agent:event` is declared in both:
- `BroadcastChannels` (correct — it's a main→renderer push) in `src/shared/ipc-channels/broadcast-channels.ts`
- `AgentEventChannels` (incorrect — treats it as a renderer→main invoke) in `src/shared/ipc-channels/agent-channels.ts`

This dual-registration is misleading and could cause incorrect handler wiring. `agent:event` is a broadcast, not an invoke.

### Files to modify
- `src/shared/ipc-channels/agent-channels.ts`

### Step-by-step

- [ ] **8a. Check for usages of `AgentEventChannels['agent:event']`** before making changes:

```bash
grep -rn "AgentEventChannels" src/ --include="*.ts"
```

If any code references `AgentEventChannels['agent:event']` as an invoke, it should be updated to use `BroadcastChannels['agent:event']` instead. Review findings before proceeding.

- [ ] **8b. Remove `agent:event` from `AgentEventChannels`** in `src/shared/ipc-channels/agent-channels.ts`. Find and delete the entry (lines 73–79):

```typescript
export interface AgentEventChannels {
  'agent:event': {
    args: [payload: { agentId: string; event: AgentEvent }]
    result: void
  }
  'agent:history': {
```

Change to:

```typescript
export interface AgentEventChannels {
  'agent:history': {
```

- [ ] **8c. Verify:** `npm run typecheck && npm test && npm run test:main`

---

## Task 9 — F-t1-datalay-6: Add `sprint_tasks(group_id)` index via new migration v049

**Problem:** `getGroupTasks()` in `src/main/data/task-group-queries.ts` queries `WHERE group_id = ?` without an index. The current last migration is `v048`. The new migration must be `v049`.

Confirm current version first:
```bash
sqlite3 ~/.bde/bde.db "PRAGMA user_version"
```
Expected: `48`. If different, adjust the version number accordingly.

### Files to create
- `src/main/migrations/v049-add-index-sprint-tasks-group-id.ts`

### Step-by-step

- [ ] **9a. Create the migration file** `src/main/migrations/v049-add-index-sprint-tasks-group-id.ts`:

```typescript
import type Database from 'better-sqlite3'

export const version = 49
export const description =
  'Add index on sprint_tasks(group_id) to speed up getGroupTasks() and related queries'

export const up: (db: Database.Database) => void = (db) => {
  const sql = `CREATE INDEX IF NOT EXISTS idx_sprint_tasks_group_id ON sprint_tasks(group_id)`
  db.exec(sql)
}
```

- [ ] **9b. Write a test.** Check if `src/main/migrations/__tests__/` exists. If not, check for any migration test pattern in the codebase:

```bash
find src/main/migrations -name "*.test.ts"
```

If a test pattern exists, follow it. Otherwise create `src/main/migrations/__tests__/v049.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, version } from '../v049-add-index-sprint-tasks-group-id'

describe('migration v049', () => {
  it('has version 49', () => {
    expect(version).toBe(49)
  })

  it('creates idx_sprint_tasks_group_id on sprint_tasks(group_id)', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, group_id TEXT)`)

    up(db)

    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='index' AND name='idx_sprint_tasks_group_id'`
      )
      .get() as { name: string } | undefined

    expect(idx?.name).toBe('idx_sprint_tasks_group_id')
    db.close()
  })

  it('is idempotent (IF NOT EXISTS)', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sprint_tasks (id TEXT PRIMARY KEY, group_id TEXT)`)
    expect(() => {
      up(db)
      up(db)
    }).not.toThrow()
    db.close()
  })
})
```

- [ ] **9c. Verify:** `npm run typecheck && npm run test:main`

---

## Task 10 — F-t1-datalay-1: Injectable logger for `task-group-queries.ts`

**Problem:** `src/main/data/task-group-queries.ts` uses `console.error(...)` in every catch block (approximately 12 occurrences). The project pattern (established in `sprint-queries.ts`) is to use an injectable logger via a `setXxxLogger()` function so logs go to `~/.bde/bde.log` and tests can suppress noise.

### Files to modify
- `src/main/data/task-group-queries.ts`
- Startup wiring (find by running `grep -rn "setSprintQueriesLogger" src/main/`)

### Step-by-step

- [ ] **10a. Write a test** in `src/main/data/__tests__/task-group-queries-logger.test.ts` (create):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { setTaskGroupQueriesLogger } from '../task-group-queries'

describe('task-group-queries logger injection', () => {
  it('exports setTaskGroupQueriesLogger', () => {
    expect(typeof setTaskGroupQueriesLogger).toBe('function')
  })

  it('accepts a Logger object without throwing', () => {
    const mockLogger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()
    }
    expect(() => setTaskGroupQueriesLogger(mockLogger)).not.toThrow()
  })
})
```

Run `npm run test:main` — **fails**.

- [ ] **10b. Add injectable logger** to `src/main/data/task-group-queries.ts`. Add these lines at the top of the file, after the existing imports:

```typescript
import type { Logger } from '../logger'
import { createLogger } from '../logger'

let _logger: Logger = createLogger('task-group-queries')

/**
 * Inject a logger. Called at app startup to route logs to the shared log file.
 * Mirrors the pattern from sprint-queries.ts setSprintQueriesLogger().
 */
export function setTaskGroupQueriesLogger(logger: Logger): void {
  _logger = logger
}
```

- [ ] **10c. Replace all `console.error(...)` calls** in `task-group-queries.ts` with `_logger.error(...)`. The pattern to find:

```typescript
    console.error(`[task-group-queries] ...`)
```

Replace every occurrence with:

```typescript
    _logger.error(`[task-group-queries] ...`)
```

Note: `deleteGroup` re-throws after logging — preserve the `throw err`.

- [ ] **10d. Wire the logger at startup.** Find where `setSprintQueriesLogger` is called:

```bash
grep -rn "setSprintQueriesLogger" src/main/
```

In that same location, add the import and call:

```typescript
import { setTaskGroupQueriesLogger } from './data/task-group-queries'
// ...
setTaskGroupQueriesLogger(createLogger('task-group-queries'))
```

- [ ] **10e. Verify:** `npm run typecheck && npm run test:main`

---

## Task 11 — F-t1-datalay-2: Injectable logger for `settings-queries.ts`

**Problem:** `src/main/data/settings-queries.ts` uses `console.warn(...)` in two places inside `getSettingJson`. Apply the same injectable logger pattern.

### Files to modify
- `src/main/data/settings-queries.ts`
- Startup wiring (same location as Task 10)

### Step-by-step

- [ ] **11a. Write a test** in `src/main/data/__tests__/settings-queries-logger.test.ts` (create):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { setSettingsQueriesLogger } from '../settings-queries'

describe('settings-queries logger injection', () => {
  it('exports setSettingsQueriesLogger', () => {
    expect(typeof setSettingsQueriesLogger).toBe('function')
  })
})
```

Run `npm run test:main` — **fails**.

- [ ] **11b. Add injectable logger** to `src/main/data/settings-queries.ts`:

```typescript
import type { Logger } from '../logger'
import { createLogger } from '../logger'

let _logger: Logger = createLogger('settings-queries')

/**
 * Inject a logger. Called at app startup to route logs to the shared log file.
 */
export function setSettingsQueriesLogger(logger: Logger): void {
  _logger = logger
}
```

- [ ] **11c. Replace `console.warn` calls** in `settings-queries.ts`. There are two in `getSettingJson`:

1. Validation failure line — change from:
```typescript
      console.warn(`[settings-queries] Validation failed for setting "${key}"`)
```
to:
```typescript
      _logger.warn(`[settings-queries] Validation failed for setting "${key}"`)
```

2. JSON parse failure line — change from:
```typescript
    console.warn(
      `[settings-queries] Failed to parse JSON for setting "${key}": ${getErrorMessage(err)}`
    )
```
to:
```typescript
    _logger.warn(
      `[settings-queries] Failed to parse JSON for setting "${key}": ${getErrorMessage(err)}`
    )
```

- [ ] **11d. Wire the logger at startup** next to the `setTaskGroupQueriesLogger` call added in Task 10.

- [ ] **11e. Verify:** `npm run typecheck && npm run test:main`

---

## Task 12 — F-t2-ipcval-2: Validate profile names in `config-handlers.ts`

**Problem:** `settings:saveProfile`, `settings:loadProfile`, `settings:applyProfile`, and `settings:deleteProfile` handlers in `src/main/handlers/config-handlers.ts` accept user-supplied `name` strings without format validation. A malformed name like `../../etc` or a 200-character string creates unexpected keys in the SQLite `settings` table.

**Fix:** Validate against `^[a-zA-Z0-9_-]{1,50}$` before calling through to the profile service.

### Files to modify
- `src/main/handlers/config-handlers.ts`
- `src/main/handlers/__tests__/config-handlers.test.ts`

### Step-by-step

- [ ] **12a. Write failing tests** in `src/main/handlers/__tests__/config-handlers.test.ts`. Find the existing profile handler test section and add:

```typescript
  describe('profile name validation', () => {
    const invalidNames = [
      '',
      'a'.repeat(51),
      '../etc',
      'name with spaces',
      'name!@#',
      'name\0null',
    ]
    const validNames = ['dev-mode', 'my_profile', 'Profile123', 'a', 'z-9_Z']

    describe('settings:saveProfile', () => {
      for (const name of invalidNames) {
        it(`rejects invalid name: "${name.slice(0, 20)}"`, () => {
          expect(() =>
            handlers['settings:saveProfile'](mockEvent, name)
          ).toThrow(/invalid profile name/i)
          expect(saveProfile).not.toHaveBeenCalled()
        })
      }

      for (const name of validNames) {
        it(`accepts valid name: "${name}"`, () => {
          expect(() =>
            handlers['settings:saveProfile'](mockEvent, name)
          ).not.toThrow()
        })
      }
    })
  })
```

Run `npm run test:main` — **fails** (no validation).

- [ ] **12b. Add validation helper and apply it** in `src/main/handlers/config-handlers.ts`. Add after the imports:

```typescript
const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,50}$/

function validateProfileName(name: string): void {
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Names must be 1–50 characters using only letters, digits, underscores, or hyphens.`
    )
  }
}
```

Apply it in each profile handler:

```typescript
  safeHandle('settings:saveProfile', (_e, name: string) => {
    validateProfileName(name)
    return saveProfile(name)
  })
  safeHandle('settings:loadProfile', (_e, name: string) => {
    validateProfileName(name)
    return loadProfile(name)
  })
  safeHandle('settings:applyProfile', (_e, name: string) => {
    validateProfileName(name)
    return applyProfile(name)
  })
  safeHandle('settings:listProfiles', () => listProfiles())
  safeHandle('settings:deleteProfile', (_e, name: string) => {
    validateProfileName(name)
    return deleteProfile(name)
  })
```

- [ ] **12c. Verify:** `npm run typecheck && npm run test:main`

---

## Task 13 — F-t2-ipcval-4: Validate `repo` field in `sprint:batchImport` against configured repos

**Problem:** `src/main/handlers/sprint-batch-handlers.ts` delegates to `batchImportTasks()`, which validates that `title` and `repo` are non-empty but does NOT check `repo` against configured repositories. Tasks can be created with arbitrary repo values that silently fail at agent-spawn time.

### Files to modify
- `src/main/services/batch-import.ts`
- `src/main/handlers/sprint-batch-handlers.ts`
- `src/main/services/__tests__/batch-import.test.ts` (create if needed)

### Step-by-step

- [ ] **13a. Write failing tests** in `src/main/services/__tests__/batch-import.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { batchImportTasks } from '../batch-import'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'

const mockRepo = {
  createTask: vi.fn().mockImplementation((input) => ({ id: 'generated-id', ...input }))
} as unknown as ISprintTaskRepository

describe('batchImportTasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates tasks when repo is valid', () => {
    const result = batchImportTasks(
      [{ title: 'Task A', repo: 'bde' }],
      mockRepo,
      ['bde', 'life-os']
    )
    expect(result.errors).toHaveLength(0)
    expect(result.created).toHaveLength(1)
  })

  it('rejects tasks with unconfigured repo when configuredRepos provided', () => {
    const result = batchImportTasks(
      [{ title: 'Task A', repo: 'unknown-repo' }],
      mockRepo,
      ['bde', 'life-os']
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/unknown-repo.*not configured/i)
    expect(result.created).toHaveLength(0)
    expect(mockRepo.createTask).not.toHaveBeenCalled()
  })

  it('repo comparison is case-insensitive', () => {
    const result = batchImportTasks(
      [{ title: 'Task A', repo: 'BDE' }],
      mockRepo,
      ['bde']
    )
    expect(result.errors).toHaveLength(0)
  })

  it('skips repo validation when configuredRepos is undefined (backward compat)', () => {
    const result = batchImportTasks(
      [{ title: 'Task A', repo: 'any-repo' }],
      mockRepo
    )
    expect(result.errors).toHaveLength(0)
  })
})
```

Run `npm run test:main` — **fails** (no `configuredRepos` param).

- [ ] **13b. Update `batchImportTasks` signature** in `src/main/services/batch-import.ts`:

```typescript
export function batchImportTasks(
  tasks: BatchTaskInput[],
  repo: ISprintTaskRepository,
  configuredRepos?: string[]
): BatchImportResult {
```

Add repo validation inside the loop, immediately after the `if (!t.title || !t.repo)` check:

```typescript
    // Validate repo against configured repos if list is provided
    if (configuredRepos && configuredRepos.length > 0) {
      const repoLower = t.repo.toLowerCase()
      const isConfigured = configuredRepos.some((r) => r.toLowerCase() === repoLower)
      if (!isConfigured) {
        errors.push(
          `Task[${i}]: repo "${t.repo}" is not configured. Configured repos: ${configuredRepos.join(', ')}`
        )
        continue
      }
    }
```

- [ ] **13c. Pass configured repos from the handler** in `src/main/handlers/sprint-batch-handlers.ts`. Update the `sprint:batchImport` handler. Add import at the top of the file if not present:

```typescript
import { getSettingJson } from '../settings'
```

Update the handler body:

```typescript
  safeHandle(
    'sprint:batchImport',
    async (
      _e,
      tasks: Array<{ ... }>
    ) => {
      const { batchImportTasks } = await import('../services/batch-import')
      const repo = createSprintTaskRepository()
      const reposConfig =
        getSettingJson<Array<{ name: string; localPath: string }>>('repos') ?? []
      const configuredRepos = reposConfig.map((r) => r.name.toLowerCase())
      return batchImportTasks(
        tasks,
        repo,
        configuredRepos.length > 0 ? configuredRepos : undefined
      )
    }
  )
```

- [ ] **13d. Verify:** `npm run typecheck && npm run test:main`

---

## Task 14 — F-t4-cleanfn-5: Extract `validateAndPreparePrompt` into `validateTaskForRun` and `assembleRunContext`

**Problem:** `validateAndPreparePrompt()` in `src/main/agent-manager/run-agent.ts` (around line 364) violates single responsibility: it validates task content (with side effects — updates task status, calls `onTaskTerminal`, cleans worktrees) AND builds the prompt string (pure assembly). Splitting these makes each function testable in isolation.

**Approach:** Extract into two exported functions, then make `validateAndPreparePrompt` a thin private wrapper. No external callers exist for this function.

### Files to modify
- `src/main/agent-manager/run-agent.ts`
- `src/main/agent-manager/__tests__/run-agent.test.ts`

### Step-by-step

- [ ] **14a. Write tests** in `src/main/agent-manager/__tests__/run-agent.test.ts`. The existing test file already mocks dependencies. Add:

```typescript
import { validateTaskForRun, assembleRunContext } from '../run-agent'

describe('validateTaskForRun', () => {
  it('throws and calls onTaskTerminal when task has no content', async () => {
    const mockRepo = {
      updateTask: vi.fn().mockReturnValue(null),
      getTask: vi.fn().mockReturnValue(null)
    } as unknown as ISprintTaskRepository
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    const emptyTask: RunAgentTask = {
      id: 'task-1', title: '', prompt: null, spec: null,
      repo: 'bde', retry_count: 0, fast_fail_count: 0
    }

    await expect(
      validateTaskForRun(emptyTask, { worktreePath: '/wt', branch: 'b' }, '/repo', {
        activeAgents: new Map(),
        defaultModel: 'claude-3-5-sonnet-20241022',
        logger,
        onTaskTerminal,
        repo: mockRepo
      })
    ).rejects.toThrow('Task has no content')

    expect(onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
  })

  it('resolves without throwing when task has a title', async () => {
    const mockRepo = {
      updateTask: vi.fn(),
      getTask: vi.fn().mockReturnValue(null)
    } as unknown as ISprintTaskRepository
    const task: RunAgentTask = {
      id: 'task-1', title: 'Do the thing', prompt: null, spec: null,
      repo: 'bde', retry_count: 0, fast_fail_count: 0
    }

    await expect(
      validateTaskForRun(task, { worktreePath: '/wt', branch: 'b' }, '/repo', {
        activeAgents: new Map(),
        defaultModel: 'claude-3-5-sonnet-20241022',
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        onTaskTerminal: vi.fn(),
        repo: mockRepo
      })
    ).resolves.toBeUndefined()

    expect(mockRepo.updateTask).not.toHaveBeenCalled()
  })
})

describe('assembleRunContext', () => {
  it('returns a non-empty prompt string', async () => {
    const mockRepo = {
      getTask: vi.fn().mockReturnValue(null)
    } as unknown as ISprintTaskRepository
    const task: RunAgentTask = {
      id: 'task-1', title: 'Test task', prompt: 'Do the thing.',
      spec: null, repo: 'bde', retry_count: 0, fast_fail_count: 0
    }

    const prompt = await assembleRunContext(task, { worktreePath: '/wt', branch: 'feat/x' }, {
      activeAgents: new Map(),
      defaultModel: 'claude-3-5-sonnet-20241022',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      onTaskTerminal: vi.fn(),
      repo: mockRepo
    })

    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })
})
```

Run `npm run test:main` — **fails** (new exports don't exist).

- [ ] **14b. Extract `validateTaskForRun`** in `src/main/agent-manager/run-agent.ts`. Add this new exported function before `validateAndPreparePrompt`:

```typescript
/**
 * Validation phase: verifies the task has executable content.
 * On failure, transitions the task to 'error' status, calls onTaskTerminal,
 * and cleans up the worktree before throwing 'Task has no content'.
 * Has side effects — do NOT call this more than once per task run.
 */
export async function validateTaskForRun(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const { logger, repo, onTaskTerminal } = deps
  const taskContent = (task.prompt || task.spec || task.title || '').trim()
  if (!taskContent) {
    logger.error(`[agent-manager] Task ${task.id} has no prompt/spec/title — marking error`)
    repo.updateTask(task.id, {
      status: 'error',
      completed_at: nowIso(),
      notes:
        'Agent failed to start: task has no prompt, spec, or title. To fix: edit the task and provide a prompt or spec describing what the agent should do.',
      claimed_by: null
    })
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
    throw new Error('Task has no content')
  }
}
```

- [ ] **14c. Extract `assembleRunContext`** as a pure function. Add after `validateTaskForRun`:

```typescript
/**
 * Context assembly phase: builds the agent prompt string from task data.
 * Pure function — no side effects, no task mutations, no callbacks.
 */
export async function assembleRunContext(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  deps: RunAgentDeps
): Promise<string> {
  const { logger, repo } = deps
  const taskContent = (task.prompt || task.spec || task.title || '').trim()

  // Fetch upstream task specs for context propagation
  const upstreamContext: Array<{ title: string; spec: string; partial_diff?: string }> = []
  if (task.depends_on && task.depends_on.length > 0) {
    for (const dep of task.depends_on) {
      try {
        const upstreamTask = repo.getTask(dep.id)
        if (upstreamTask && upstreamTask.status === 'done') {
          const spec = upstreamTask.spec || upstreamTask.prompt || ''
          if (spec.trim()) {
            upstreamContext.push({
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
  }

  // Create task scratchpad directory (idempotent)
  const scratchpadDir = join(BDE_TASK_MEMORY_DIR, task.id)
  mkdirSync(scratchpadDir, { recursive: true })

  // Read prior scratchpad content if present
  let priorScratchpad = ''
  try {
    priorScratchpad = readFileSync(join(scratchpadDir, 'progress.md'), 'utf-8')
  } catch {
    // Expected on first run
  }

  return buildAgentPrompt({
    agentType: 'pipeline',
    taskContent,
    branch: worktree.branch,
    playgroundEnabled: task.playground_enabled,
    retryCount: task.retry_count ?? 0,
    previousNotes: task.notes ?? undefined,
    maxRuntimeMs: task.max_runtime_ms ?? undefined,
    upstreamContext: upstreamContext.length > 0 ? upstreamContext : undefined,
    crossRepoContract: task.cross_repo_contract ?? undefined,
    repoName: task.repo,
    taskId: task.id,
    priorScratchpad
  })
}
```

- [ ] **14d. Refactor `validateAndPreparePrompt`** into a thin private wrapper:

```typescript
async function validateAndPreparePrompt(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<string> {
  await validateTaskForRun(task, worktree, repoPath, deps)
  return assembleRunContext(task, worktree, deps)
}
```

Delete all the old implementation code that was inside `validateAndPreparePrompt` — it is now in the two new functions above.

- [ ] **14e. Verify:** `npm run typecheck && npm run test:main`

---

## Task 15 — F-t4-cleansolid-5: Split `RunAgentDeps` into focused dep bags

**Problem:** `RunAgentDeps` in `src/main/agent-manager/run-agent.ts` is a 7-field god interface covering spawning, data access, event callbacks, and error handling. Using TypeScript intersection types, we can expose focused sub-interfaces without breaking existing callers.

### Files to modify
- `src/main/agent-manager/run-agent.ts`
- `src/main/agent-manager/__tests__/run-agent.test.ts` (compile-time assertions)

### Step-by-step

- [ ] **15a. Define focused dep bag interfaces** in `src/main/agent-manager/run-agent.ts`. Add these BEFORE the existing `RunAgentDeps` interface:

```typescript
/** Spawn lifecycle and agent process management. */
export interface RunAgentSpawnDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  /** Optional — called when agent process successfully spawns. */
  onSpawnSuccess?: () => void
  /** Optional — called when spawnAgent throws. */
  onSpawnFailure?: () => void
}

/** Sprint task data access. */
export interface RunAgentDataDeps {
  repo: ISprintTaskRepository
  logger: Logger
}

/** Terminal status notification. */
export interface RunAgentEventDeps {
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  logger: Logger
}
```

- [ ] **15b. Redefine `RunAgentDeps` as an intersection type** (keep the same name so no callers break):

Replace the existing `export interface RunAgentDeps { ... }` with:

```typescript
/**
 * Full dependency bag for runAgent(). Composed via intersection so callers
 * that only consume a sub-set can depend on the narrower interface.
 */
export type RunAgentDeps = RunAgentSpawnDeps & RunAgentDataDeps & RunAgentEventDeps
```

- [ ] **15c. Add compile-time assertions** in `src/main/agent-manager/__tests__/run-agent.test.ts`:

```typescript
import type { RunAgentDeps, RunAgentSpawnDeps, RunAgentDataDeps, RunAgentEventDeps } from '../run-agent'

// Compile-time: RunAgentDeps must satisfy each sub-interface
type _SpawnCheck = RunAgentDeps extends RunAgentSpawnDeps ? true : never
type _DataCheck = RunAgentDeps extends RunAgentDataDeps ? true : never
type _EventCheck = RunAgentDeps extends RunAgentEventDeps ? true : never
// These lines fail to compile if the intersection is wrong — they don't need a test body
```

- [ ] **15d. Verify no external callers need changes.** The `index.ts` construction of `runAgentDeps` already provides all 7 fields, so it satisfies the intersection without modification. Run:

```bash
grep -rn "RunAgentDeps" src/ --include="*.ts"
```

Review any usages outside of `run-agent.ts` and `run-agent.test.ts` to confirm they still type-check.

- [ ] **15e. Verify:** `npm run typecheck && npm run test:main`

---

## Final Verification Pass

After all 15 tasks are complete, run the full suite:

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all renderer/shared tests pass
- [ ] `npm run test:main` — all main-process tests pass
- [ ] `npm run lint` — zero errors (warnings OK)
- [ ] `npm run build` — production build succeeds

Do NOT commit until all five pass.

---

## Commit Strategy

Group related fixes into focused commits:

```bash
# Group 1: Dependency resolution (Tasks 1, 2, 3, 4, 5)
git add \
  src/main/agent-manager/resolve-dependents.ts \
  src/main/agent-manager/index.ts \
  src/main/services/dependency-service.ts \
  src/main/agent-manager/__tests__/resolve-dependents.test.ts \
  src/main/agent-manager/__tests__/dependency-index.test.ts \
  src/main/data/task-group-queries.ts \
  src/main/handlers/__tests__/group-handlers.test.ts
git commit -m "fix: cascade cancel propagation, dep index rebuild on terminal, terminal-status guard"

# Group 2: IPC type surface (Tasks 7, 8)
git add \
  src/shared/ipc-channels/broadcast-channels.ts \
  src/shared/ipc-channels/agent-channels.ts \
  src/shared/ipc-channels/__tests__/
git commit -m "fix: add 8 tearoff broadcast channels; remove duplicate agent:event from AgentEventChannels"

# Group 3: Task transition ordering (Task 6)
git add \
  src/main/services/review-orchestration-service.ts \
  src/main/services/__tests__/review-orchestration-service.test.ts
git commit -m "fix: call onStatusTerminal before notifySprintMutation in createPr"

# Group 4: Data layer (Tasks 9, 10, 11)
git add \
  src/main/migrations/v049-add-index-sprint-tasks-group-id.ts \
  src/main/data/task-group-queries.ts \
  src/main/data/settings-queries.ts \
  src/main/data/__tests__/
git commit -m "fix: injectable logger for task-group-queries and settings-queries; add group_id index"

# Group 5: Input validation (Tasks 12, 13)
git add \
  src/main/handlers/config-handlers.ts \
  src/main/handlers/__tests__/config-handlers.test.ts \
  src/main/services/batch-import.ts \
  src/main/services/__tests__/batch-import.test.ts \
  src/main/handlers/sprint-batch-handlers.ts
git commit -m "fix: validate profile names and batch import repo field"

# Group 6: Code quality (Tasks 14, 15)
git add \
  src/main/agent-manager/run-agent.ts \
  src/main/agent-manager/__tests__/run-agent.test.ts
git commit -m "refactor: split validateAndPreparePrompt; decompose RunAgentDeps into focused interfaces"
```

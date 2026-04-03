# Task Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dependency system so tasks can declare prerequisites (hard or soft), with automatic blocked/unblocked status transitions, cycle detection, and lightweight UI.

**Architecture:** `depends_on` JSONB array on `sprint_tasks` (Supabase), in-memory reverse index in agent-manager for O(1) dependent lookups, centralized `resolveDependents()` called from all terminal-status code paths. New `blocked` status keeps drain loop simple (it already only fetches `queued` tasks).

**Tech Stack:** TypeScript, Supabase (JSONB column), Vitest, React (existing Sprint UI components)

**Spec:** `docs/superpowers/specs/2026-03-23-task-dependencies-design.md`

---

## File Map

| File                                                          | Role                            | Action                                                                         |
| ------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `src/shared/types.ts`                                         | Shared types                    | Modify — add `TaskDependency`, update `SprintTask`                             |
| `src/shared/constants.ts`                                     | Status constants                | Modify — add `BLOCKED`                                                         |
| `src/shared/queue-api-contract.ts`                            | API contract types              | Modify — update `QueueHealthResponse`                                          |
| `src/main/agent-manager/dependency-index.ts`                  | Reverse index + cycle detection | **Create**                                                                     |
| `src/main/agent-manager/__tests__/dependency-index.test.ts`   | Tests for above                 | **Create**                                                                     |
| `src/main/agent-manager/resolve-dependents.ts`                | Dependency resolution logic     | **Create**                                                                     |
| `src/main/agent-manager/__tests__/resolve-dependents.test.ts` | Tests for above                 | **Create**                                                                     |
| `src/main/data/sprint-queries.ts`                             | Data access layer               | Modify — allowlist, QueueStats, new queries, refactor markTask\*               |
| `src/main/agent-manager/index.ts`                             | Agent manager                   | Modify — init index, hook resolution into terminal transitions                 |
| `src/main/agent-manager/completion.ts`                        | Completion handler              | No change — resolution is hooked in `index.ts` after calling `resolveFailure`  |
| `src/main/sprint-pr-poller.ts`                                | PR poller                       | Modify — consume task IDs, call resolution                                     |
| `src/main/handlers/sprint-local.ts`                           | IPC handlers                    | Modify — new handlers, update wrappers                                         |
| `src/main/handlers/git-handlers.ts`                           | Git/PR IPC handlers             | Modify — consume task IDs from markTask\*                                      |
| `src/main/queue-api/router.ts`                                | Queue API HTTP server           | Modify — new PATCH route, health response                                      |
| `src/shared/ipc-channels.ts`                                  | Typed IPC channel map           | Modify — add `sprint:validate-dependencies` and `sprint:unblock-task` channels |
| `src/main/index.ts`                                           | IPC registration                | Modify — wire PR poller `onTaskTerminal`                                       |
| `src/preload/index.ts`                                        | Preload bridge                  | Modify — expose new IPC channels via `typedInvoke`                             |
| `src/renderer/src/lib/partitionSprintTasks.ts`                | Kanban partition logic          | Modify — add `blocked` case                                                    |
| `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts` | Partition tests                 | Modify — add blocked test                                                      |
| `src/renderer/src/components/sprint/TaskCard.tsx`             | Task card component             | Modify — blocked badge, dependency chips, unblock button                       |
| `src/renderer/src/components/sprint/SprintCenter.tsx`         | Sprint kanban + task form       | Modify — dependency field in create/edit form                                  |

---

## Task 1: Shared Types and Constants

**Files:**

- Modify: `src/shared/types.ts:22-44`
- Modify: `src/shared/constants.ts:6-16`
- Modify: `src/shared/queue-api-contract.ts:6-17`

- [ ] **Step 1: Add `TaskDependency` interface and update `SprintTask`**

In `src/shared/types.ts`, add before the `SprintTask` interface:

```typescript
export interface TaskDependency {
  id: string
  type: 'hard' | 'soft'
}
```

In the `SprintTask` interface, add after `template_name`:

```typescript
depends_on: TaskDependency[] | null
```

Update the `status` union on line 28 to include `'blocked'`:

```typescript
status: 'backlog' | 'queued' | 'blocked' | 'active' | 'done' | 'cancelled' | 'failed' | 'error'
```

- [ ] **Step 2: Add `BLOCKED` to `TASK_STATUS`**

In `src/shared/constants.ts`, add `BLOCKED: 'blocked'` after `QUEUED`:

```typescript
export const TASK_STATUS = {
  BACKLOG: 'backlog',
  QUEUED: 'queued',
  BLOCKED: 'blocked',
  ACTIVE: 'active',
  DONE: 'done',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  ERROR: 'error'
} as const
```

- [ ] **Step 3: Update `QueueHealthResponse`**

In `src/shared/queue-api-contract.ts`, update the `queue` object in `QueueHealthResponse` to include `blocked` and `error`:

```typescript
export interface QueueHealthResponse {
  status: 'ok'
  version: string
  queue: {
    backlog: number
    queued: number
    blocked: number
    active: number
    done: number
    failed: number
    cancelled: number
    error: number
  }
}
```

- [ ] **Step 4: Fix all `makeTask` test helpers**

Adding `depends_on` to `SprintTask` will break every test file that constructs a `SprintTask` without it. Run `grep -rn 'function makeTask' src/ --include='*.ts'` to find all instances. Add `depends_on: null` to each helper's default object. Common locations:

- `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`
- `src/renderer/src/components/sprint/__tests__/TaskCard.test.ts`
- Any other test files constructing `SprintTask` objects

- [ ] **Step 5: Add channels to `src/shared/ipc-channels.ts`**

In the `SprintChannels` interface (around line 206), add:

```typescript
'sprint:validate-dependencies': {
  args: [taskId: string, deps: Array<{ id: string; type: 'hard' | 'soft' }>]
  result: { valid: boolean; error?: string; cycle?: string[] }
}
'sprint:unblock-task': {
  args: [taskId: string]
  result: SprintTask | null
}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (all `SprintTask` usages now include `depends_on`)

- [ ] **Step 7: Run tests**

Run: `npm test && npm run test:main`
Expected: All PASS (makeTask helpers updated)

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts src/shared/queue-api-contract.ts \
  src/shared/ipc-channels.ts
git add -u  # catch all test helper updates
git commit -m "feat(deps): add TaskDependency type, blocked status, update shared contracts and test helpers"
```

---

## Task 2: Dependency Index (TDD)

**Files:**

- Create: `src/main/agent-manager/dependency-index.ts`
- Create: `src/main/agent-manager/__tests__/dependency-index.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/agent-manager/__tests__/dependency-index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createDependencyIndex, detectCycle, type DependencyIndex } from '../dependency-index'
import type { TaskDependency } from '../../../shared/types'

function hardDep(id: string): TaskDependency {
  return { id, type: 'hard' }
}

function softDep(id: string): TaskDependency {
  return { id, type: 'soft' }
}

describe('DependencyIndex', () => {
  describe('rebuild', () => {
    it('populates reverse index from task list', () => {
      const idx = createDependencyIndex()
      idx.rebuild([
        { id: 'B', depends_on: [hardDep('A')] },
        { id: 'C', depends_on: [hardDep('A'), softDep('B')] }
      ])
      expect(idx.getDependents('A')).toEqual(new Set(['B', 'C']))
      expect(idx.getDependents('B')).toEqual(new Set(['C']))
    })

    it('handles null depends_on', () => {
      const idx = createDependencyIndex()
      idx.rebuild([{ id: 'A', depends_on: null }])
      expect(idx.getDependents('A')).toEqual(new Set())
    })

    it('clears previous state on rebuild', () => {
      const idx = createDependencyIndex()
      idx.rebuild([{ id: 'B', depends_on: [hardDep('A')] }])
      idx.rebuild([])
      expect(idx.getDependents('A')).toEqual(new Set())
    })
  })

  describe('update', () => {
    it('adds new dependents when deps added', () => {
      const idx = createDependencyIndex()
      idx.rebuild([])
      idx.update('B', null, [hardDep('A')])
      expect(idx.getDependents('A')).toEqual(new Set(['B']))
    })

    it('removes old dependents when deps removed', () => {
      const idx = createDependencyIndex()
      idx.rebuild([{ id: 'B', depends_on: [hardDep('A')] }])
      idx.update('B', [hardDep('A')], null)
      expect(idx.getDependents('A')).toEqual(new Set())
    })

    it('handles dep change from one task to another', () => {
      const idx = createDependencyIndex()
      idx.rebuild([{ id: 'C', depends_on: [hardDep('A')] }])
      idx.update('C', [hardDep('A')], [hardDep('B')])
      expect(idx.getDependents('A')).toEqual(new Set())
      expect(idx.getDependents('B')).toEqual(new Set(['C']))
    })
  })

  describe('remove', () => {
    it('removes task from all reverse sets and its own entry', () => {
      const idx = createDependencyIndex()
      idx.rebuild([
        { id: 'B', depends_on: [hardDep('A')] },
        { id: 'C', depends_on: [hardDep('B')] }
      ])
      idx.remove('B')
      expect(idx.getDependents('A')).toEqual(new Set())
      expect(idx.getDependents('B')).toEqual(new Set(['C']))
    })
  })

  describe('areDependenciesSatisfied', () => {
    it('returns satisfied when all hard deps are done', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'done', B: 'done' })[id]
      const result = idx.areDependenciesSatisfied('C', [hardDep('A'), hardDep('B')], getStatus)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    it('returns not satisfied when hard dep is failed', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'failed' })[id]
      const result = idx.areDependenciesSatisfied('B', [hardDep('A')], getStatus)
      expect(result).toEqual({ satisfied: false, blockedBy: ['A'] })
    })

    it('returns not satisfied when hard dep is cancelled', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'cancelled' })[id]
      const result = idx.areDependenciesSatisfied('B', [hardDep('A')], getStatus)
      expect(result).toEqual({ satisfied: false, blockedBy: ['A'] })
    })

    it('returns not satisfied when hard dep is error', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'error' })[id]
      const result = idx.areDependenciesSatisfied('B', [hardDep('A')], getStatus)
      expect(result).toEqual({ satisfied: false, blockedBy: ['A'] })
    })

    it('returns not satisfied when hard dep is still active', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'active' })[id]
      const result = idx.areDependenciesSatisfied('B', [hardDep('A')], getStatus)
      expect(result).toEqual({ satisfied: false, blockedBy: ['A'] })
    })

    it('returns satisfied when soft dep is failed', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'failed' })[id]
      const result = idx.areDependenciesSatisfied('B', [softDep('A')], getStatus)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    it('returns satisfied when soft dep is cancelled', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'cancelled' })[id]
      const result = idx.areDependenciesSatisfied('B', [softDep('A')], getStatus)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    it('returns not satisfied when soft dep is still active (not terminal)', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'active' })[id]
      const result = idx.areDependenciesSatisfied('B', [softDep('A')], getStatus)
      expect(result).toEqual({ satisfied: false, blockedBy: ['A'] })
    })

    it('treats deleted deps (undefined status) as satisfied', () => {
      const idx = createDependencyIndex()
      const getStatus = () => undefined
      const result = idx.areDependenciesSatisfied('B', [hardDep('A')], getStatus)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    it('handles mixed hard and soft deps', () => {
      const idx = createDependencyIndex()
      const getStatus = (id: string) => ({ A: 'done', B: 'failed' })[id]
      const result = idx.areDependenciesSatisfied('C', [hardDep('A'), softDep('B')], getStatus)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })

    it('returns empty deps as satisfied', () => {
      const idx = createDependencyIndex()
      const result = idx.areDependenciesSatisfied('A', [], () => undefined)
      expect(result).toEqual({ satisfied: true, blockedBy: [] })
    })
  })
})

describe('detectCycle', () => {
  it('returns null when no cycle exists', () => {
    const deps: Record<string, TaskDependency[] | null> = {
      A: null,
      B: [hardDep('A')]
    }
    const result = detectCycle('C', [hardDep('B')], (id) => deps[id] ?? null)
    expect(result).toBeNull()
  })

  it('detects self-cycle', () => {
    const result = detectCycle('A', [hardDep('A')], () => null)
    expect(result).toEqual(['A', 'A'])
  })

  it('detects A -> B -> A cycle', () => {
    const deps: Record<string, TaskDependency[] | null> = {
      B: [hardDep('A')]
    }
    // A wants to depend on B, but B already depends on A
    const result = detectCycle('A', [hardDep('B')], (id) => deps[id] ?? null)
    expect(result).not.toBeNull()
    expect(result).toContain('A')
    expect(result).toContain('B')
  })

  it('detects deep cycle A -> B -> C -> A', () => {
    const deps: Record<string, TaskDependency[] | null> = {
      B: [hardDep('A')],
      C: [hardDep('B')]
    }
    const result = detectCycle('A', [hardDep('C')], (id) => deps[id] ?? null)
    expect(result).not.toBeNull()
    expect(result).toContain('A')
  })

  it('does not flag diamond as a cycle', () => {
    // A <- B, A <- C, B <- D, C <- D  (diamond, not a cycle)
    const deps: Record<string, TaskDependency[] | null> = {
      B: [hardDep('A')],
      C: [hardDep('A')],
      D: [hardDep('B'), hardDep('C')]
    }
    const result = detectCycle('E', [hardDep('D')], (id) => deps[id] ?? null)
    expect(result).toBeNull()
  })

  it('handles missing tasks in lookup gracefully', () => {
    const result = detectCycle('A', [hardDep('nonexistent')], () => null)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:main -- --run src/main/agent-manager/__tests__/dependency-index.test.ts`
Expected: FAIL — module `../dependency-index` does not exist

- [ ] **Step 3: Implement dependency-index.ts**

Create `src/main/agent-manager/dependency-index.ts`:

```typescript
import type { TaskDependency } from '../../shared/types'

const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'failed', 'error'])
const HARD_SATISFIED_STATUSES = new Set(['done'])

export interface DependencyIndex {
  rebuild(tasks: Array<{ id: string; depends_on: TaskDependency[] | null }>): void
  update(taskId: string, oldDeps: TaskDependency[] | null, newDeps: TaskDependency[] | null): void
  remove(taskId: string): void
  getDependents(taskId: string): Set<string>
  areDependenciesSatisfied(
    taskId: string,
    deps: TaskDependency[],
    getTaskStatus: (id: string) => string | undefined
  ): { satisfied: boolean; blockedBy: string[] }
}

export function createDependencyIndex(): DependencyIndex {
  // dependencyId -> Set<dependentTaskIds>
  const reverseMap = new Map<string, Set<string>>()

  function addEdges(taskId: string, deps: TaskDependency[] | null): void {
    if (!deps) return
    for (const dep of deps) {
      let set = reverseMap.get(dep.id)
      if (!set) {
        set = new Set()
        reverseMap.set(dep.id, set)
      }
      set.add(taskId)
    }
  }

  function removeEdges(taskId: string, deps: TaskDependency[] | null): void {
    if (!deps) return
    for (const dep of deps) {
      const set = reverseMap.get(dep.id)
      if (set) {
        set.delete(taskId)
        if (set.size === 0) reverseMap.delete(dep.id)
      }
    }
  }

  return {
    rebuild(tasks) {
      reverseMap.clear()
      for (const task of tasks) {
        addEdges(task.id, task.depends_on)
      }
    },

    update(taskId, oldDeps, newDeps) {
      removeEdges(taskId, oldDeps)
      addEdges(taskId, newDeps)
    },

    remove(taskId) {
      // Remove taskId as a dependent from all reverse sets
      for (const set of reverseMap.values()) {
        set.delete(taskId)
      }
      // Remove taskId's own entry as a dependency (others might depend on it — keep that)
    },

    getDependents(taskId) {
      return reverseMap.get(taskId) ?? new Set()
    },

    areDependenciesSatisfied(_taskId, deps, getTaskStatus) {
      if (deps.length === 0) return { satisfied: true, blockedBy: [] }

      const blockedBy: string[] = []
      for (const dep of deps) {
        const status = getTaskStatus(dep.id)

        // Deleted task (undefined status) = satisfied
        if (status === undefined) continue

        if (dep.type === 'hard') {
          if (!HARD_SATISFIED_STATUSES.has(status)) {
            blockedBy.push(dep.id)
          }
        } else {
          // Soft: any terminal status is satisfied, non-terminal is not
          if (!TERMINAL_STATUSES.has(status)) {
            blockedBy.push(dep.id)
          }
        }
      }

      return { satisfied: blockedBy.length === 0, blockedBy }
    }
  }
}

/**
 * Detect cycles using DFS. Returns the cycle path or null.
 */
export function detectCycle(
  taskId: string,
  proposedDeps: TaskDependency[],
  getDepsForTask: (id: string) => TaskDependency[] | null
): string[] | null {
  // Check self-cycle
  for (const dep of proposedDeps) {
    if (dep.id === taskId) return [taskId, taskId]
  }

  // DFS from each proposed dep, looking for taskId in the chain
  for (const dep of proposedDeps) {
    const visited = new Set<string>()
    const path: string[] = [taskId, dep.id]

    function dfs(current: string): string[] | null {
      if (current === taskId) return [...path]
      if (visited.has(current)) return null
      visited.add(current)

      const deps = getDepsForTask(current)
      if (!deps) return null

      for (const d of deps) {
        path.push(d.id)
        const result = dfs(d.id)
        if (result) return result
        path.pop()
      }
      return null
    }

    const cycle = dfs(dep.id)
    if (cycle) return cycle
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:main -- --run src/main/agent-manager/__tests__/dependency-index.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/dependency-index.ts src/main/agent-manager/__tests__/dependency-index.test.ts
git commit -m "feat(deps): add DependencyIndex with reverse index and cycle detection"
```

---

## Task 3: Resolve Dependents Logic (TDD)

**Files:**

- Create: `src/main/agent-manager/resolve-dependents.ts`
- Create: `src/main/agent-manager/__tests__/resolve-dependents.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/agent-manager/__tests__/resolve-dependents.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { resolveDependents } from '../resolve-dependents'
import { createDependencyIndex } from '../dependency-index'
import type { TaskDependency } from '../../../shared/types'

function hardDep(id: string): TaskDependency {
  return { id, type: 'hard' }
}

function softDep(id: string): TaskDependency {
  return { id, type: 'soft' }
}

describe('resolveDependents', () => {
  it('does nothing when task has no dependents', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([])
    const getTask = vi.fn()
    const updateTask = vi.fn()
    await resolveDependents('A', 'done', idx, getTask, updateTask)
    expect(getTask).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('unblocks dependent when hard dep completes as done', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'B', depends_on: [hardDep('A')] }])
    const getTask = vi.fn().mockResolvedValue({
      id: 'B',
      status: 'blocked',
      depends_on: [hardDep('A')]
    })
    const updateTask = vi.fn().mockResolvedValue(null)
    await resolveDependents('A', 'done', idx, getTask, updateTask)
    expect(updateTask).toHaveBeenCalledWith('B', { status: 'queued' })
  })

  it('keeps dependent blocked when hard dep fails', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'B', depends_on: [hardDep('A')] }])
    const getTask = vi.fn().mockResolvedValue({
      id: 'B',
      status: 'blocked',
      depends_on: [hardDep('A')]
    })
    const updateTask = vi.fn()
    await resolveDependents('A', 'failed', idx, getTask, updateTask)
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('keeps dependent blocked when hard dep is cancelled', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'B', depends_on: [hardDep('A')] }])
    const getTask = vi.fn().mockResolvedValue({
      id: 'B',
      status: 'blocked',
      depends_on: [hardDep('A')]
    })
    const updateTask = vi.fn()
    await resolveDependents('A', 'cancelled', idx, getTask, updateTask)
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('unblocks dependent when soft dep fails', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'B', depends_on: [softDep('A')] }])
    const getTask = vi.fn().mockResolvedValue({
      id: 'B',
      status: 'blocked',
      depends_on: [softDep('A')]
    })
    const updateTask = vi.fn().mockResolvedValue(null)
    await resolveDependents('A', 'failed', idx, getTask, updateTask)
    expect(updateTask).toHaveBeenCalledWith('B', { status: 'queued' })
  })

  it('skips non-blocked dependents', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'B', depends_on: [hardDep('A')] }])
    const getTask = vi.fn().mockResolvedValue({
      id: 'B',
      status: 'active',
      depends_on: [hardDep('A')]
    })
    const updateTask = vi.fn()
    await resolveDependents('A', 'done', idx, getTask, updateTask)
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('fan-in: unblocks only when ALL deps satisfied', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'C', depends_on: [hardDep('A'), hardDep('B')] }])

    // A completes but B is still active — getTask returns status for all tasks
    const tasks: Record<
      string,
      { id: string; status: string; depends_on: TaskDependency[] | null }
    > = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'active', depends_on: null },
      C: { id: 'C', status: 'blocked', depends_on: [hardDep('A'), hardDep('B')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => Promise.resolve(tasks[id] ?? null))
    const updateTask = vi.fn()

    await resolveDependents('A', 'done', idx, getTask, updateTask)
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('fan-in: unblocks when last dep satisfied', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'C', depends_on: [hardDep('A'), hardDep('B')] }])

    const tasks: Record<
      string,
      { id: string; status: string; depends_on: TaskDependency[] | null }
    > = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'done', depends_on: null },
      C: { id: 'C', status: 'blocked', depends_on: [hardDep('A'), hardDep('B')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => Promise.resolve(tasks[id] ?? null))
    const updateTask = vi.fn().mockResolvedValue(null)

    await resolveDependents('B', 'done', idx, getTask, updateTask)
    expect(updateTask).toHaveBeenCalledWith('C', { status: 'queued' })
  })

  it('mixed: hard done + soft failed = satisfied', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'C', depends_on: [hardDep('A'), softDep('B')] }])

    const tasks: Record<
      string,
      { id: string; status: string; depends_on: TaskDependency[] | null }
    > = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'failed', depends_on: null },
      C: { id: 'C', status: 'blocked', depends_on: [hardDep('A'), softDep('B')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => Promise.resolve(tasks[id] ?? null))
    const updateTask = vi.fn().mockResolvedValue(null)

    await resolveDependents('B', 'failed', idx, getTask, updateTask)
    expect(updateTask).toHaveBeenCalledWith('C', { status: 'queued' })
  })

  it('handles getTask returning null gracefully', async () => {
    const idx = createDependencyIndex()
    idx.rebuild([{ id: 'B', depends_on: [hardDep('A')] }])
    const getTask = vi.fn().mockResolvedValue(null)
    const updateTask = vi.fn()
    await resolveDependents('A', 'done', idx, getTask, updateTask)
    expect(updateTask).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:main -- --run src/main/agent-manager/__tests__/resolve-dependents.test.ts`
Expected: FAIL — module `../resolve-dependents` does not exist

- [ ] **Step 3: Implement resolve-dependents.ts**

Create `src/main/agent-manager/resolve-dependents.ts`:

```typescript
import type { DependencyIndex } from './dependency-index'
import type { SprintTask, TaskDependency } from '../../shared/types'

/**
 * After a task reaches a terminal status, check all dependents and
 * transition any blocked tasks to queued if their dependencies are now satisfied.
 *
 * Important: `getTask` is used to fetch the status of ALL dependency targets
 * (not just the completed task). This is necessary for fan-in scenarios where
 * a task depends on multiple other tasks — we must check every dependency's
 * current status, not just the one that just completed.
 */
export async function resolveDependents(
  completedTaskId: string,
  completedStatus: string,
  index: DependencyIndex,
  getTask: (
    id: string
  ) => Promise<
    (Pick<SprintTask, 'id' | 'status'> & { depends_on: TaskDependency[] | null }) | null
  >,
  updateTask: (id: string, patch: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  const dependents = index.getDependents(completedTaskId)
  if (dependents.size === 0) return

  for (const depId of dependents) {
    try {
      const task = await getTask(depId)
      if (!task || task.status !== 'blocked') continue
      if (!task.depends_on || task.depends_on.length === 0) continue

      // Build a status cache: fetch each dependency target's current status.
      // Pre-seed with the completed task's known status to avoid a redundant fetch.
      const statusCache = new Map<string, string | undefined>()
      statusCache.set(completedTaskId, completedStatus)

      for (const dep of task.depends_on) {
        if (!statusCache.has(dep.id)) {
          const depTask = await getTask(dep.id)
          statusCache.set(dep.id, depTask?.status)
        }
      }

      const { satisfied } = index.areDependenciesSatisfied(depId, task.depends_on, (id) =>
        statusCache.get(id)
      )

      if (satisfied) {
        await updateTask(depId, { status: 'queued' })
      }
    } catch (err) {
      console.warn(`[resolve-dependents] Error resolving dependent ${depId}:`, err)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:main -- --run src/main/agent-manager/__tests__/resolve-dependents.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/resolve-dependents.ts src/main/agent-manager/__tests__/resolve-dependents.test.ts
git commit -m "feat(deps): add resolveDependents for automatic blocked->queued transitions"
```

---

## Task 4: Data Layer Changes

**Files:**

- Modify: `src/main/data/sprint-queries.ts:10-29` (UPDATE_ALLOWLIST), `:31-40` (QueueStats), `:75-106` (CreateTaskInput/createTask), `:180-208` (getQueueStats), `:227-268` (markTaskDone/Cancelled)

- [ ] **Step 1: Add `depends_on` to UPDATE_ALLOWLIST**

In `src/main/data/sprint-queries.ts`, add `'depends_on'` to the `UPDATE_ALLOWLIST` set (after `'claimed_by'`).

- [ ] **Step 2: Add `blocked` to QueueStats**

In the `QueueStats` interface (line 31), add `blocked: number`. In `getQueueStats()` (line 181), add `blocked: 0` to the initial stats object.

- [ ] **Step 3: Add `depends_on` to CreateTaskInput and createTask()**

In `CreateTaskInput` (line 75), add:

```typescript
depends_on?: Array<{ id: string; type: 'hard' | 'soft' }> | null
```

In `createTask()` (line 86), add to the insert object:

```typescript
depends_on: input.depends_on ?? null,
```

- [ ] **Step 4: Add `getTasksWithDependencies()` query**

Add after `getHealthCheckTasks()`:

```typescript
export async function getTasksWithDependencies(): Promise<
  Array<{
    id: string
    depends_on: Array<{ id: string; type: 'hard' | 'soft' }> | null
    status: string
  }>
> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks')
    .select('id, depends_on, status')
    .not('depends_on', 'is', null)
  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 5: Refactor `markTaskDoneByPrNumber` to return affected IDs**

Change the function signature and implementation:

```typescript
export async function markTaskDoneByPrNumber(prNumber: number): Promise<string[]> {
  try {
    // Find affected tasks BEFORE updating
    const { data: affected } = await getSupabaseClient()
      .from('sprint_tasks')
      .select('id')
      .eq('pr_number', prNumber)
      .eq('status', 'active')

    const affectedIds = (affected ?? []).map((r: { id: string }) => r.id)

    const completedAt = new Date().toISOString()
    await getSupabaseClient()
      .from('sprint_tasks')
      .update({ status: 'done', completed_at: completedAt })
      .eq('pr_number', prNumber)
      .eq('status', 'active')

    await getSupabaseClient()
      .from('sprint_tasks')
      .update({ pr_status: 'merged' })
      .eq('pr_number', prNumber)
      .eq('status', 'done')
      .eq('pr_status', 'open')

    return affectedIds
  } catch (err) {
    console.warn(`[sprint-queries] failed to mark task done for PR #${prNumber}:`, err)
    return []
  }
}
```

- [ ] **Step 6: Refactor `markTaskCancelledByPrNumber` to return affected IDs**

Same pattern:

```typescript
export async function markTaskCancelledByPrNumber(prNumber: number): Promise<string[]> {
  try {
    const { data: affected } = await getSupabaseClient()
      .from('sprint_tasks')
      .select('id')
      .eq('pr_number', prNumber)
      .eq('status', 'active')

    const affectedIds = (affected ?? []).map((r: { id: string }) => r.id)

    await getSupabaseClient()
      .from('sprint_tasks')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('pr_number', prNumber)
      .eq('status', 'active')

    await getSupabaseClient()
      .from('sprint_tasks')
      .update({ pr_status: 'closed' })
      .eq('pr_number', prNumber)
      .eq('status', 'done')
      .eq('pr_status', 'open')

    return affectedIds
  } catch (err) {
    console.warn(`[sprint-queries] failed to mark task cancelled for PR #${prNumber}:`, err)
    return []
  }
}
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: Errors in callers of `markTaskDoneByPrNumber`/`markTaskCancelledByPrNumber` (return type changed) — these will be fixed in Task 5.

- [ ] **Step 8: Commit**

```bash
git add src/main/data/sprint-queries.ts
git commit -m "feat(deps): update data layer — allowlist, QueueStats, createTask, markTask* return IDs"
```

---

## Task 5: Wire Up Resolution Across All Terminal Paths

**Files:**

- Modify: `src/main/handlers/sprint-local.ts:90-96`
- Modify: `src/main/sprint-pr-poller.ts:12-18,46-49`
- Modify: `src/main/handlers/git-handlers.ts:93-97`
- Modify: `src/main/agent-manager/index.ts:144-268,354-377,404-435`

This task wires `resolveDependents` into every code path that produces a terminal task status. Note: `completion.ts` is NOT modified — resolution is hooked in `index.ts` after calling `resolveFailure`.

- [ ] **Step 1: Update sprint-local.ts wrappers**

In `src/main/handlers/sprint-local.ts`, update the `markTaskDone/Cancelled` wrappers to return `string[]`:

```typescript
export async function markTaskDoneByPrNumber(prNumber: number): Promise<string[]> {
  return _markTaskDoneByPrNumber(prNumber)
}

export async function markTaskCancelledByPrNumber(prNumber: number): Promise<string[]> {
  return _markTaskCancelledByPrNumber(prNumber)
}
```

- [ ] **Step 2: Update SprintPrPollerDeps interface and poll()**

In `src/main/sprint-pr-poller.ts`, update the deps interface:

```typescript
export interface SprintPrPollerDeps {
  listTasksWithOpenPrs: () => Promise<SprintTask[]>
  pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
  markTaskDoneByPrNumber: (prNumber: number) => Promise<string[]>
  markTaskCancelledByPrNumber: (prNumber: number) => Promise<string[]>
  updateTaskMergeableState: (prNumber: number, state: string | null) => Promise<void>
  onTaskTerminal?: (taskId: string, status: string) => Promise<void>
}
```

Update the `poll()` function to call `onTaskTerminal`:

```typescript
if (result.merged) {
  const ids = await deps.markTaskDoneByPrNumber(prNumber)
  if (deps.onTaskTerminal) {
    for (const id of ids) await deps.onTaskTerminal(id, 'done')
  }
} else if (result.state === 'CLOSED') {
  const ids = await deps.markTaskCancelledByPrNumber(prNumber)
  if (deps.onTaskTerminal) {
    for (const id of ids) await deps.onTaskTerminal(id, 'cancelled')
  }
}
```

- [ ] **Step 3: Update git-handlers.ts**

In `src/main/handlers/git-handlers.ts`, update the `pr:pollStatuses` handler to consume returned IDs (the IDs are returned but don't need resolution here — the PR poller handles it via its own hook; this handler is the renderer-triggered variant):

```typescript
if (result.merged) {
  await markTaskDoneByPrNumber(prNumber)
} else if (result.state === 'CLOSED') {
  await markTaskCancelledByPrNumber(prNumber)
}
```

No change needed here — the sprint-local wrappers now return `string[]` but the return value can be safely ignored in this handler (the PR poller is the primary resolution path). However, if you want resolution here too, capture the IDs and emit an event. For now, the PR poller's `onTaskTerminal` hook is the centralized path.

- [ ] **Step 4: Update agent-manager/index.ts — initialize index and wire resolution**

In `src/main/agent-manager/index.ts`, add imports at the top:

```typescript
import { createDependencyIndex } from './dependency-index'
import { resolveDependents } from './resolve-dependents'
import { getTasksWithDependencies, getTask } from '../data/sprint-queries'
```

Inside `createAgentManager()`, after `let orphanRecoveryRunning = false`:

```typescript
const depIndex = createDependencyIndex()
```

In the `start()` function, after `recoverOrphans(...)`:

```typescript
// Build dependency index
getTasksWithDependencies()
  .then((tasks) => {
    depIndex.rebuild(tasks)
    logger.info(`[agent-manager] Dependency index built with ${tasks.length} tasks`)
  })
  .catch((err) => {
    logger.error(`[agent-manager] Failed to build dependency index: ${err}`)
  })
```

Add a helper inside `createAgentManager()` for terminal resolution:

```typescript
async function onTaskTerminal(taskId: string, status: string): Promise<void> {
  try {
    await resolveDependents(taskId, status, depIndex, getTask, updateTask)
  } catch (err) {
    logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
  }
}
```

Note: `resolveDependents` internally fetches all dependency statuses via `getTask` — no need for a separate status lookup function.

- [ ] **Step 5: Hook resolution into runAgent terminal paths**

In the `runAgent()` function, after the `updateTask` call for empty prompt (line 152):

```typescript
await onTaskTerminal(task.id, 'error')
```

After spawn failure `updateTask` (line 169):

```typescript
await onTaskTerminal(task.id, 'error')
```

After setupWorktree failure `updateTask` (line 331 in the drain loop):

```typescript
await onTaskTerminal(task.id, 'error')
```

After `ffResult === 'fast-fail-exhausted'` `updateTask` (line 233):

```typescript
await onTaskTerminal(task.id, 'error')
```

After `resolveFailure` is called (line 257), add inside the catch block to handle the case where resolveFailure sets `failed`:

This is tricky because `resolveFailure` might set `queued` (retry) or `failed` (exhausted). Only call `onTaskTerminal` when it's actually terminal. Modify: check retry count before calling.

```typescript
// After resolveFailure call (line 257)
if ((task.retry_count ?? 0) >= MAX_RETRIES) {
  await onTaskTerminal(task.id, 'failed')
}
```

Import `MAX_RETRIES` if not already imported (it is — line 4 via `./types`).

- [ ] **Step 6: Hook resolution into watchdog terminal paths**

In the `watchdogLoop()` function, after the `updateTask` calls for `max-runtime` and `idle`:

```typescript
if (verdict === 'max-runtime') {
  updateTask(agent.taskId, { status: 'error', completed_at: now, notes: 'Max runtime exceeded' })
    .then(() => onTaskTerminal(agent.taskId, 'error'))
    .catch(() => {})
} else if (verdict === 'idle') {
  updateTask(agent.taskId, { status: 'error', completed_at: now, notes: 'Idle timeout' })
    .then(() => onTaskTerminal(agent.taskId, 'error'))
    .catch(() => {})
}
```

- [ ] **Step 7: Wire PR poller to use onTaskTerminal**

In `src/main/sprint-pr-poller.ts`, update the legacy `startSprintPrPoller()` at the bottom. The `onTaskTerminal` callback needs to be injected. Add a module-level setter:

```typescript
let _onTaskTerminal: ((taskId: string, status: string) => Promise<void>) | null = null

export function setOnTaskTerminal(fn: (taskId: string, status: string) => Promise<void>): void {
  _onTaskTerminal = fn
}
```

Update `startSprintPrPoller`:

```typescript
export function startSprintPrPoller(): void {
  _instance = createSprintPrPoller({
    listTasksWithOpenPrs,
    pollPrStatuses,
    markTaskDoneByPrNumber,
    markTaskCancelledByPrNumber,
    updateTaskMergeableState,
    onTaskTerminal: _onTaskTerminal ?? undefined
  })
  _instance.start()
}
```

In `src/main/agent-manager/index.ts`, in the `start()` function, before starting the PR poller (if it's started there), or in `src/main/index.ts` where the poller is started, call:

```typescript
import { setOnTaskTerminal } from '../sprint-pr-poller'
// After agent manager is created:
setOnTaskTerminal((taskId, status) => onTaskTerminal(taskId, status))
```

Note: Since `onTaskTerminal` is scoped inside `createAgentManager`, expose it on the `AgentManager` interface or use the setter pattern.

The simplest approach: add `onTaskTerminal` to the `AgentManager` interface and call `setOnTaskTerminal` from `src/main/index.ts` where both the agent manager and PR poller are initialized.

In `src/main/agent-manager/index.ts`, add to the `AgentManager` interface:

```typescript
onTaskTerminal(taskId: string, status: string): Promise<void>
```

Return it from the factory:

```typescript
return { start, stop, getStatus, steerAgent, killAgent, onTaskTerminal }
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (or at most minor issues in renderer code related to `depends_on` on `SprintTask` — those are fixed in Task 7)

- [ ] **Step 9: Commit**

```bash
git add src/main/agent-manager/index.ts \
  src/main/sprint-pr-poller.ts src/main/handlers/sprint-local.ts \
  src/main/handlers/git-handlers.ts
git commit -m "feat(deps): wire resolveDependents into all terminal status paths"
```

---

## Task 6: Queue API and IPC Handlers

**Files:**

- Modify: `src/main/queue-api/router.ts:186-199`
- Modify: `src/main/handlers/sprint-local.ts:112-169`
- Modify: `src/main/index.ts` (IPC registration)
- Modify: `src/preload/index.ts` (preload bridge)

- [ ] **Step 1: Update health endpoint**

In `src/main/queue-api/router.ts`, update `handleHealth` to include `blocked` and `error`:

```typescript
async function handleHealth(res: http.ServerResponse): Promise<void> {
  const stats = await getQueueStats()
  sendJson(res, 200, {
    status: 'ok',
    version: '1.0.0',
    queue: {
      backlog: stats.backlog,
      queued: stats.queued,
      blocked: stats.blocked,
      active: stats.active,
      done: stats.done,
      failed: stats.failed,
      cancelled: stats.cancelled,
      error: stats.error
    }
  })
}
```

- [ ] **Step 2: Add PATCH /queue/tasks/:id route**

The router uses `matchRoute()` with path patterns (see `router.ts:112-131`). Add the new route **before** the existing `PATCH /queue/tasks/:id/status` route in the dispatch chain (around line 186), since `matchRoute` requires exact segment count matching and `/queue/tasks/:id` (4 segments) won't collide with `/queue/tasks/:id/status` (5 segments):

```typescript
// PATCH /queue/tasks/:id — general field update (includes depends_on)
params = matchRoute('/queue/tasks/:id', path)
if (method === 'PATCH' && params) {
  return handleUpdateTask(req, res, params['id'])
}
```

Add the handler function (after existing handlers, around line 297):

```typescript
async function handleUpdateTask(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const snaked = toSnakeCase(body as Record<string, unknown>)
  const updated = await updateTask(id, snaked)
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))
}
```

- [ ] **Step 3: Add IPC handlers for dependency validation and unblock**

In `src/main/handlers/sprint-local.ts`, add inside `registerSprintLocalHandlers()`:

```typescript
safeHandle(
  'sprint:validate-dependencies',
  async (_e, taskId: string, proposedDeps: Array<{ id: string; type: 'hard' | 'soft' }>) => {
    // Lazy import to avoid circular deps
    const { detectCycle } = await import('../agent-manager/dependency-index')
    const { getTask: fetchTask } = await import('../data/sprint-queries')

    // Validate all dep targets exist
    for (const dep of proposedDeps) {
      const target = await fetchTask(dep.id)
      if (!target) return { valid: false, error: `Task ${dep.id} not found` }
    }

    // Check for cycles
    const allTasks = await _listTasks()
    const depsMap = new Map(
      allTasks.map((t: SprintTask) => [
        t.id,
        (t as Record<string, unknown>).depends_on as Array<{ id: string; type: string }> | null
      ])
    )
    const cycle = detectCycle(taskId, proposedDeps, (id) => {
      const deps = depsMap.get(id)
      return (deps as Array<{ id: string; type: 'hard' | 'soft' }> | null) ?? null
    })
    if (cycle) return { valid: false, cycle }

    return { valid: true }
  }
)

safeHandle('sprint:unblock-task', async (_e, taskId: string) => {
  const task = await _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'blocked')
    throw new Error(`Task ${taskId} is not blocked (status: ${task.status})`)
  const updated = await _updateTask(taskId, { status: 'queued' })
  if (updated) notifySprintMutation('updated', updated)
  return updated
})
```

- [ ] **Step 4: Add blocked-status interception to `sprint:update` handler**

In `src/main/handlers/sprint-local.ts`, update the `sprint:update` handler (line 123) to intercept `backlog → queued` transitions for tasks with unsatisfied deps. After the existing `updateTask` call, add logic:

```typescript
safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
  // If transitioning to queued, check if dependencies are satisfied
  if (patch.status === 'queued') {
    const task = await _getTask(id)
    if (task?.depends_on && task.depends_on.length > 0) {
      const { createDependencyIndex } = await import('../agent-manager/dependency-index')
      const idx = createDependencyIndex() // temp index just for satisfaction check
      const allTasks = await _listTasks()
      const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
      const { satisfied } = idx.areDependenciesSatisfied(id, task.depends_on, (depId) =>
        statusMap.get(depId)
      )
      if (!satisfied) {
        patch = { ...patch, status: 'blocked' }
      }
    }
  }
  const result = await _updateTask(id, patch)
  if (result) notifySprintMutation('updated', result)
  return result
})
```

- [ ] **Step 5: Add cycle detection to `sprint:create` handler**

Update the `sprint:create` handler (line 117) to run cycle detection and set blocked status when creating tasks with dependencies:

```typescript
safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
  // Run cycle detection if depends_on provided
  if (task.depends_on && task.depends_on.length > 0) {
    const { detectCycle, createDependencyIndex } = await import('../agent-manager/dependency-index')
    const allTasks = await _listTasks()
    const depsMap = new Map(
      allTasks.map((t) => [
        t.id,
        (t as Record<string, unknown>).depends_on as Array<{
          id: string
          type: 'hard' | 'soft'
        }> | null
      ])
    )
    const cycle = detectCycle('__new__', task.depends_on, (id) => depsMap.get(id) ?? null)
    if (cycle) throw new Error(`Dependency cycle detected: ${cycle.join(' → ')}`)

    // Check if deps are satisfied — if not, override status to blocked
    if (task.status === 'queued') {
      const idx = createDependencyIndex()
      const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
      const { satisfied } = idx.areDependenciesSatisfied('__new__', task.depends_on, (id) =>
        statusMap.get(id)
      )
      if (!satisfied) task = { ...task, status: 'blocked' }
    }
  }
  const row = await _createTask(task)
  notifySprintMutation('created', row)
  return row
})
```

- [ ] **Step 6: Expose new IPC channels in preload**

In `src/preload/index.ts`, add to the existing `sprint` section (around line 126, before the closing `}`):

```typescript
validateDependencies: (taskId: string, deps: Array<{ id: string; type: 'hard' | 'soft' }>) =>
  typedInvoke('sprint:validate-dependencies', taskId, deps),
unblockTask: (taskId: string) =>
  typedInvoke('sprint:unblock-task', taskId),
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/queue-api/router.ts src/main/handlers/sprint-local.ts \
  src/preload/index.ts
git commit -m "feat(deps): add PATCH route, IPC handlers, blocked-status interception"
```

---

## Task 7: UI — Partition, Task Card, Sprint Kanban

**Files:**

- Modify: `src/renderer/src/lib/partitionSprintTasks.ts:34-64`
- Modify: `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`
- Modify: `src/renderer/src/components/sprint/TaskCard.tsx`
- Modify: `src/renderer/src/components/sprint/SprintCenter.tsx`

- [ ] **Step 1: Add blocked case to partitionSprintTasks**

In `src/renderer/src/lib/partitionSprintTasks.ts`, add after the `QUEUED` case:

```typescript
case TASK_STATUS.BLOCKED:
  todo.push(task)
  break
```

- [ ] **Step 2: Add test for blocked partition**

In `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`, add a test:

```typescript
it('puts blocked tasks into todo bucket', () => {
  const tasks = [makeTask({ status: 'blocked' as SprintTask['status'] })]
  const result = partitionSprintTasks(tasks)
  expect(result.todo).toHaveLength(1)
  expect(result.todo[0].status).toBe('blocked')
})
```

Note: The `as SprintTask['status']` cast is needed because the `makeTask` helper's default type won't include `blocked` until the type update propagates. After Task 1's changes are in place, this cast won't be needed.

- [ ] **Step 3: Run partition tests**

Run: `npm test -- --run src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts`
Expected: All PASS

- [ ] **Step 4: Update TaskCard for blocked status**

In `src/renderer/src/components/sprint/TaskCard.tsx`, add visual indicators for blocked tasks. After the existing `isHighPriority` logic:

Add to className computation:

```typescript
task.status === 'blocked' && 'task-card--blocked',
```

In the badge/status area of the card's JSX, add a blocked badge conditionally:

```tsx
{
  task.status === 'blocked' && <Badge variant="warning">Blocked</Badge>
}
```

Add dependency chips below the title (when `depends_on` exists):

```tsx
{
  task.depends_on && task.depends_on.length > 0 && (
    <div className="task-card__deps">
      {task.depends_on.map((dep) => (
        <span key={dep.id} className={`dep-chip dep-chip--${dep.type}`}>
          {dep.type === 'hard' ? '⬤' : '◯'} {dep.id.slice(0, 8)}
        </span>
      ))}
    </div>
  )
}
```

Add an "Unblock" button for blocked cards (next to existing action buttons):

```tsx
{
  task.status === 'blocked' && (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => window.electron?.ipcRenderer.invoke('sprint:unblock-task', task.id)}
    >
      Unblock
    </Button>
  )
}
```

Note: Adapt these JSX snippets to match the existing TaskCard patterns (check exact prop names, Button imports, layout structure). The exact integration depends on how the card is structured — read the full file before implementing.

- [ ] **Step 5: Add dependency field to task create/edit form**

In `src/renderer/src/components/sprint/SprintCenter.tsx` (or wherever the task form lives), add a "Dependencies" section to the task creation form. This is a multi-select of existing tasks with a hard/soft toggle per selection.

This is UI-specific and should match existing form patterns in the codebase. The key IPC calls:

- `window.electron?.ipcRenderer.invoke('sprint:validate-dependencies', taskId, deps)` — validate before save
- Include `depends_on` in the task create/update payload

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All existing tests PASS, new tests PASS

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/partitionSprintTasks.ts \
  src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts \
  src/renderer/src/components/sprint/TaskCard.tsx \
  src/renderer/src/components/sprint/SprintCenter.tsx
git commit -m "feat(deps): UI — blocked status in kanban, dependency chips, unblock button"
```

---

## Task 8: Supabase Migration and Final Verification

**Important:** The code changes assume the `depends_on` JSONB column exists in Supabase. This migration must be run before testing with real data.

- [ ] **Step 1: Run Supabase migration**

Apply the following SQL to the Supabase `sprint_tasks` table (via Supabase dashboard or migration tool):

```sql
ALTER TABLE sprint_tasks ADD COLUMN IF NOT EXISTS depends_on JSONB DEFAULT NULL;
```

If the `status` column has a CHECK constraint, update it to include `'blocked'`:

```sql
-- Check if constraint exists first, then alter
ALTER TABLE sprint_tasks DROP CONSTRAINT IF EXISTS sprint_tasks_status_check;
ALTER TABLE sprint_tasks ADD CONSTRAINT sprint_tasks_status_check
  CHECK (status IN ('backlog', 'queued', 'blocked', 'active', 'done', 'cancelled', 'failed', 'error'));
```

- [ ] **Step 2: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors

- [ ] **Step 3: Run all tests**

Run: `npm test && npm run test:main`
Expected: All PASS (except the 5 known pre-existing failures in fs.test.ts and git.test.ts)

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: PASS — production build succeeds

- [ ] **Step 5: Manual smoke test (if running the app)**

1. Create Task A (no dependencies)
2. Create Task B with hard dependency on Task A
3. Queue both — verify B goes to `blocked`, A goes to `queued`
4. Verify B shows "Blocked" badge and dependency chip in the kanban
5. Complete Task A (or manually mark done) — verify B transitions to `queued`
6. Test "Unblock" button on a blocked task — verify it goes to `queued`

- [ ] **Step 6: Commit any remaining fixes**

Only if manual testing revealed issues. Then create the feature branch and PR.

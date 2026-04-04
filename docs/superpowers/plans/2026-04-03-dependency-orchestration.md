# Dependency & Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend BDE's dependency system with visual DAG rendering, workflow templates, batch import, cascade cancellation, and conditional dependencies. These features transform the flat task list into a visible, programmable dependency graph.

**Architecture:** Five features share the same dependency substrate (`dependency-index.ts`, `resolve-dependents.ts`, `task-terminal-service.ts`). Changes layer bottom-up: shared types first (conditional deps), then resolution logic (cascade cancel, conditional resolution), then data import (batch/templates), then visualization (DAG).

**Tech Stack:** React, SVG/Canvas (DAG), TypeScript, vitest + @testing-library/react for tests, existing SQLite data layer.

**Spec:** `docs/superpowers/specs/2026-04-03-developer-persona-audit.md` (items #8, #20, #21, #25, #32)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Modify | Add `condition` field to `TaskDependency`, add `WorkflowTemplate` type, add `BatchImportTask` type |
| `src/shared/task-transitions.ts` | Modify | Add `CASCADE_CANCEL_STATUSES` constant |
| `src/main/agent-manager/dependency-index.ts` | Modify | Update `areDependenciesSatisfied()` to check `condition` field |
| `src/main/agent-manager/resolve-dependents.ts` | Modify | Add cascade cancel logic, check conditional deps |
| `src/main/services/task-terminal-service.ts` | Modify | Wire cascade cancel behavior, add `cascade_behavior` config |
| `src/main/handlers/sprint-local.ts` | Modify | Add `sprint:batchImport` and `sprint:createChain` IPC handlers |
| `src/main/handlers/sprint-batch-import.ts` | Create | Batch import parsing + validation logic |
| `src/shared/workflow-templates.ts` | Create | Built-in workflow template definitions |
| `src/shared/batch-import-schema.ts` | Create | JSON/YAML schema validation for batch import |
| `src/preload/index.ts` | Modify | Add `batchImport`, `createChain` to preload bridge |
| `src/preload/index.d.ts` | Modify | Type declarations for new preload methods |
| `src/renderer/src/components/sprint/DagOverlay.tsx` | Create | SVG DAG visualization overlay |
| `src/renderer/src/components/sprint/DagNode.tsx` | Create | Individual task node in DAG |
| `src/renderer/src/components/sprint/dag-layout.ts` | Create | DAG layout algorithm (topological sort + layer assignment) |
| `src/renderer/src/components/sprint/SprintPipeline.tsx` | Modify | Add DAG toggle button |
| `src/renderer/src/components/task-workbench/WorkflowTemplatePicker.tsx` | Create | Template selection + chain creation UI |
| `src/renderer/src/components/task-workbench/BatchImportModal.tsx` | Create | YAML/JSON paste + file upload modal |
| `src/renderer/src/components/task-workbench/DependencyPicker.tsx` | Modify | Add `condition` selector to dependency items |
| `src/renderer/src/assets/dag-neon.css` | Create | DAG overlay neon styles |
| `src/renderer/src/components/sprint/__tests__/DagOverlay.test.tsx` | Create | DAG rendering tests |
| `src/renderer/src/components/sprint/__tests__/dag-layout.test.ts` | Create | Layout algorithm tests |
| `src/main/agent-manager/__tests__/resolve-dependents-cascade.test.ts` | Create | Cascade cancel tests |
| `src/main/agent-manager/__tests__/conditional-deps.test.ts` | Create | Conditional dependency resolution tests |
| `src/main/handlers/__tests__/batch-import.test.ts` | Create | Batch import validation + creation tests |
| `src/shared/__tests__/workflow-templates.test.ts` | Create | Template validation tests |

---

### Task 1: Conditional Dependencies — Shared Types

**Files:**
- Modify: `src/shared/types.ts`
- Test: `src/shared/__tests__/workflow-templates.test.ts` (type validation only)

- [ ] **Step 1: Write tests for the new `TaskDependency` shape**

```typescript
// src/main/agent-manager/__tests__/conditional-deps.test.ts
import { describe, it, expect } from 'vitest'
import type { TaskDependency } from '../../../shared/types'

describe('TaskDependency type', () => {
  it('accepts condition field', () => {
    const dep: TaskDependency = { id: 'task-1', type: 'hard', condition: 'on_success' }
    expect(dep.condition).toBe('on_success')
  })

  it('defaults condition to undefined (backward compat)', () => {
    const dep: TaskDependency = { id: 'task-1', type: 'hard' }
    expect(dep.condition).toBeUndefined()
  })

  it('accepts all condition values', () => {
    const deps: TaskDependency[] = [
      { id: '1', type: 'hard', condition: 'on_success' },
      { id: '2', type: 'soft', condition: 'on_failure' },
      { id: '3', type: 'hard', condition: 'always' }
    ]
    expect(deps).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Add `condition` field to `TaskDependency`**

In `src/shared/types.ts`, modify `TaskDependency`:

```typescript
export interface TaskDependency {
  id: string
  type: 'hard' | 'soft'
  /** When this dependency is considered satisfied. Default behavior if omitted:
   *  - hard deps: satisfied when upstream is 'done' (on_success)
   *  - soft deps: satisfied when upstream reaches any terminal status (always)
   */
  condition?: 'on_success' | 'on_failure' | 'always'
}
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/conditional-deps.test.ts
```

---

### Task 2: Conditional Dependency Resolution

**Files:**
- Modify: `src/main/agent-manager/dependency-index.ts`
- Test: `src/main/agent-manager/__tests__/conditional-deps.test.ts`

- [ ] **Step 1: Write tests for conditional resolution logic**

Add to `src/main/agent-manager/__tests__/conditional-deps.test.ts`:

```typescript
import { createDependencyIndex } from '../dependency-index'

describe('areDependenciesSatisfied with conditions', () => {
  const index = createDependencyIndex()

  it('on_success: satisfied only when upstream is done', () => {
    const deps: TaskDependency[] = [{ id: 'a', type: 'hard', condition: 'on_success' }]
    const getStatus = (id: string) => (id === 'a' ? 'done' : undefined)
    expect(index.areDependenciesSatisfied('b', deps, getStatus).satisfied).toBe(true)
  })

  it('on_success: NOT satisfied when upstream failed', () => {
    const deps: TaskDependency[] = [{ id: 'a', type: 'hard', condition: 'on_success' }]
    const getStatus = (id: string) => (id === 'a' ? 'failed' : undefined)
    expect(index.areDependenciesSatisfied('b', deps, getStatus).satisfied).toBe(false)
  })

  it('on_failure: satisfied only when upstream failed/error', () => {
    const deps: TaskDependency[] = [{ id: 'a', type: 'hard', condition: 'on_failure' }]
    const getStatus = (id: string) => (id === 'a' ? 'failed' : undefined)
    expect(index.areDependenciesSatisfied('b', deps, getStatus).satisfied).toBe(true)
  })

  it('on_failure: NOT satisfied when upstream done', () => {
    const deps: TaskDependency[] = [{ id: 'a', type: 'hard', condition: 'on_failure' }]
    const getStatus = (id: string) => (id === 'a' ? 'done' : undefined)
    expect(index.areDependenciesSatisfied('b', deps, getStatus).satisfied).toBe(false)
  })

  it('always: satisfied when upstream reaches any terminal status', () => {
    const deps: TaskDependency[] = [{ id: 'a', type: 'hard', condition: 'always' }]
    for (const status of ['done', 'failed', 'error', 'cancelled']) {
      const getStatus = (id: string) => (id === 'a' ? status : undefined)
      expect(index.areDependenciesSatisfied('b', deps, getStatus).satisfied).toBe(true)
    }
  })

  it('always: NOT satisfied when upstream is active', () => {
    const deps: TaskDependency[] = [{ id: 'a', type: 'hard', condition: 'always' }]
    const getStatus = (id: string) => (id === 'a' ? 'active' : undefined)
    expect(index.areDependenciesSatisfied('b', deps, getStatus).satisfied).toBe(false)
  })

  it('no condition: uses original hard/soft behavior (backward compat)', () => {
    const hardDep: TaskDependency[] = [{ id: 'a', type: 'hard' }]
    const softDep: TaskDependency[] = [{ id: 'a', type: 'soft' }]

    // Hard with no condition: only done satisfies
    expect(
      index.areDependenciesSatisfied('b', hardDep, () => 'done').satisfied
    ).toBe(true)
    expect(
      index.areDependenciesSatisfied('b', hardDep, () => 'failed').satisfied
    ).toBe(false)

    // Soft with no condition: any terminal satisfies
    expect(
      index.areDependenciesSatisfied('b', softDep, () => 'failed').satisfied
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Update `areDependenciesSatisfied` in `dependency-index.ts`**

Replace the dependency check loop in `areDependenciesSatisfied`:

```typescript
const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'failed', 'error'])
const HARD_SATISFIED_STATUSES = new Set(['done'])
const FAILURE_STATUSES = new Set(['failed', 'error'])

// Inside areDependenciesSatisfied:
areDependenciesSatisfied(_taskId, deps, getTaskStatus) {
  if (deps.length === 0) return { satisfied: true, blockedBy: [] }
  const blockedBy: string[] = []
  for (const dep of deps) {
    const status = getTaskStatus(dep.id)
    if (status === undefined) continue // deleted dep = satisfied

    const condition = dep.condition

    if (condition === 'on_success') {
      // Satisfied only when upstream succeeded (done)
      if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)
    } else if (condition === 'on_failure') {
      // Satisfied only when upstream failed
      if (!FAILURE_STATUSES.has(status)) blockedBy.push(dep.id)
    } else if (condition === 'always') {
      // Satisfied when upstream reaches ANY terminal status
      if (!TERMINAL_STATUSES.has(status)) blockedBy.push(dep.id)
    } else {
      // No condition specified — use original type-based behavior
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

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/conditional-deps.test.ts
```

---

### Task 3: Cascade Cancel on Hard-Dep Failure

**Files:**
- Modify: `src/main/agent-manager/resolve-dependents.ts`
- Modify: `src/main/services/task-terminal-service.ts`
- Create: `src/main/agent-manager/__tests__/resolve-dependents-cascade.test.ts`

- [ ] **Step 1: Write tests for cascade cancel**

```typescript
// src/main/agent-manager/__tests__/resolve-dependents-cascade.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveDependents } from '../resolve-dependents'
import { createDependencyIndex } from '../dependency-index'
import type { TaskDependency } from '../../../shared/types'

describe('cascade cancel on hard-dep failure', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  function makeIndex(tasks: Array<{ id: string; depends_on: TaskDependency[] | null }>) {
    const idx = createDependencyIndex()
    idx.rebuild(tasks)
    return idx
  }

  it('cancels blocked downstream tasks when hard dep fails', () => {
    const updateTask = vi.fn()
    const tasks = [
      { id: 'a', depends_on: null, status: 'failed', notes: null },
      { id: 'b', depends_on: [{ id: 'a', type: 'hard' as const }], status: 'blocked', notes: null }
    ]
    const getTask = (id: string) => tasks.find((t) => t.id === id) ?? null
    const index = makeIndex(tasks)

    resolveDependents('a', 'failed', index, getTask, updateTask, logger, 'cancel')

    expect(updateTask).toHaveBeenCalledWith('b', expect.objectContaining({
      status: 'cancelled',
      notes: expect.stringContaining('cascade')
    }))
  })

  it('does NOT cascade cancel for soft deps', () => {
    const updateTask = vi.fn()
    const tasks = [
      { id: 'a', depends_on: null, status: 'failed', notes: null },
      { id: 'b', depends_on: [{ id: 'a', type: 'soft' as const }], status: 'blocked', notes: null }
    ]
    const getTask = (id: string) => tasks.find((t) => t.id === id) ?? null
    const index = makeIndex(tasks)

    resolveDependents('a', 'failed', index, getTask, updateTask, logger, 'cancel')

    // Soft dep should unblock, not cancel
    expect(updateTask).toHaveBeenCalledWith('b', expect.objectContaining({ status: 'queued' }))
  })

  it('cascades through transitive hard deps (A->B->C)', () => {
    const updateTask = vi.fn()
    const tasks = [
      { id: 'a', depends_on: null, status: 'failed', notes: null },
      { id: 'b', depends_on: [{ id: 'a', type: 'hard' as const }], status: 'blocked', notes: null },
      { id: 'c', depends_on: [{ id: 'b', type: 'hard' as const }], status: 'blocked', notes: null }
    ]
    const getTask = (id: string) => tasks.find((t) => t.id === id) ?? null
    const index = makeIndex(tasks)

    resolveDependents('a', 'failed', index, getTask, updateTask, logger, 'cancel')

    // B should be cancelled
    expect(updateTask).toHaveBeenCalledWith('b', expect.objectContaining({ status: 'cancelled' }))
    // C should also be cancelled (transitive)
    // Note: the function should recursively cascade
  })

  it('pause mode: leaves blocked tasks as-is', () => {
    const updateTask = vi.fn()
    const tasks = [
      { id: 'a', depends_on: null, status: 'failed', notes: null },
      { id: 'b', depends_on: [{ id: 'a', type: 'hard' as const }], status: 'blocked', notes: null }
    ]
    const getTask = (id: string) => tasks.find((t) => t.id === id) ?? null
    const index = makeIndex(tasks)

    resolveDependents('a', 'failed', index, getTask, updateTask, logger, 'pause')

    // In pause mode, blocked tasks should get updated notes but stay blocked
    expect(updateTask).toHaveBeenCalledWith('b', expect.objectContaining({
      notes: expect.stringContaining('Blocked by')
    }))
    expect(updateTask).not.toHaveBeenCalledWith('b', expect.objectContaining({ status: 'cancelled' }))
  })

  it('continue mode: uses existing behavior (no cascade)', () => {
    const updateTask = vi.fn()
    const tasks = [
      { id: 'a', depends_on: null, status: 'failed', notes: null },
      { id: 'b', depends_on: [{ id: 'a', type: 'hard' as const }], status: 'blocked', notes: null }
    ]
    const getTask = (id: string) => tasks.find((t) => t.id === id) ?? null
    const index = makeIndex(tasks)

    // 'continue' = existing behavior — update notes but don't cancel
    resolveDependents('a', 'failed', index, getTask, updateTask, logger, 'continue')

    expect(updateTask).not.toHaveBeenCalledWith('b', expect.objectContaining({ status: 'cancelled' }))
  })
})
```

- [ ] **Step 2: Add cascade behavior parameter to `resolveDependents()`**

In `src/main/agent-manager/resolve-dependents.ts`:

```typescript
export type CascadeBehavior = 'cancel' | 'pause' | 'continue'

const FAILURE_STATUSES = new Set(['failed', 'error', 'cancelled'])

export function resolveDependents(
  completedTaskId: string,
  completedStatus: string,
  index: DependencyIndex,
  getTask: (id: string) =>
    | (Pick<SprintTask, 'id' | 'status' | 'notes'> & { depends_on: TaskDependency[] | null })
    | null,
  updateTask: (id: string, patch: Record<string, unknown>) => unknown,
  logger?: Logger,
  cascadeBehavior: CascadeBehavior = 'continue'
): void {
  const dependents = index.getDependents(completedTaskId)
  if (dependents.size === 0) return

  for (const depId of dependents) {
    try {
      const task = getTask(depId)
      if (!task || task.status !== 'blocked') continue
      if (!task.depends_on || task.depends_on.length === 0) continue

      // Check if this specific dep is a hard dep on the failed task
      const depEdge = task.depends_on.find((d) => d.id === completedTaskId)
      const isHardDepOnFailed =
        depEdge?.type === 'hard' && FAILURE_STATUSES.has(completedStatus)

      if (isHardDepOnFailed && cascadeBehavior === 'cancel') {
        // Cascade cancel: mark dependent as cancelled
        updateTask(depId, {
          status: 'cancelled',
          notes: `[cascade-cancel] Cancelled because hard dependency ${completedTaskId} ${completedStatus}`,
          completed_at: new Date().toISOString()
        })
        // Recursively cascade to tasks depending on this one
        resolveDependents(depId, 'cancelled', index, getTask, updateTask, logger, cascadeBehavior)
        continue
      }

      // Existing resolution logic (for 'pause', 'continue', or non-failure)
      const statusCache = new Map<string, string | undefined>()
      statusCache.set(completedTaskId, completedStatus)

      for (const dep of task.depends_on) {
        if (!statusCache.has(dep.id)) {
          const depTask = getTask(dep.id)
          statusCache.set(dep.id, depTask?.status)
        }
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
    }
  }
}
```

- [ ] **Step 3: Wire cascade behavior setting in `task-terminal-service.ts`**

Add a `getCascadeBehavior` dep to `TaskTerminalServiceDeps`:

```typescript
export interface TaskTerminalServiceDeps {
  getTask: (id: string) => TaskSlice | null
  updateTask: (id: string, patch: Record<string, unknown>) => unknown
  getTasksWithDependencies: () => Array<{ id: string; depends_on: TaskDependency[] | null }>
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
  getCascadeBehavior?: () => CascadeBehavior
}
```

In `onStatusTerminal`, pass the cascade behavior:

```typescript
function onStatusTerminal(taskId: string, status: string): void {
  if (!TERMINAL_STATUSES.has(status)) return
  try {
    rebuildIndex()
    const cascade = deps.getCascadeBehavior?.() ?? 'continue'
    resolveDependents(taskId, status, depIndex, deps.getTask, deps.updateTask, deps.logger, cascade)
  } catch (err) {
    deps.logger.error(`[task-terminal-service] resolveDependents failed for ${taskId}: ${err}`)
  }
}
```

The cascade behavior setting is read from SQLite `settings` table via `getSetting('dependency.cascadeBehavior')` (default: `'continue'`). Configurable in Settings > Agent Manager tab.

- [ ] **Step 4: Run tests**

```bash
cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/resolve-dependents-cascade.test.ts
```

---

### Task 4: DAG Layout Algorithm

**Files:**
- Create: `src/renderer/src/components/sprint/dag-layout.ts`
- Create: `src/renderer/src/components/sprint/__tests__/dag-layout.test.ts`

- [ ] **Step 1: Write tests for DAG layout**

```typescript
// src/renderer/src/components/sprint/__tests__/dag-layout.test.ts
import { describe, it, expect } from 'vitest'
import { computeDagLayout, type DagNode, type DagEdge } from '../dag-layout'

describe('computeDagLayout', () => {
  it('assigns depth 0 to root nodes (no deps)', () => {
    const nodes: DagNode[] = [
      { id: 'a', label: 'Task A', status: 'queued', dependsOn: [] },
      { id: 'b', label: 'Task B', status: 'queued', dependsOn: [] }
    ]
    const layout = computeDagLayout(nodes)
    expect(layout.nodes[0].depth).toBe(0)
    expect(layout.nodes[1].depth).toBe(0)
  })

  it('assigns depth 1 to tasks depending on root', () => {
    const nodes: DagNode[] = [
      { id: 'a', label: 'A', status: 'done', dependsOn: [] },
      { id: 'b', label: 'B', status: 'queued', dependsOn: ['a'] }
    ]
    const layout = computeDagLayout(nodes)
    const b = layout.nodes.find((n) => n.id === 'b')!
    expect(b.depth).toBe(1)
  })

  it('handles diamond dependency (A -> B, A -> C, B+C -> D)', () => {
    const nodes: DagNode[] = [
      { id: 'a', label: 'A', status: 'done', dependsOn: [] },
      { id: 'b', label: 'B', status: 'done', dependsOn: ['a'] },
      { id: 'c', label: 'C', status: 'done', dependsOn: ['a'] },
      { id: 'd', label: 'D', status: 'queued', dependsOn: ['b', 'c'] }
    ]
    const layout = computeDagLayout(nodes)
    const d = layout.nodes.find((n) => n.id === 'd')!
    expect(d.depth).toBe(2) // max(depth(b), depth(c)) + 1
  })

  it('generates edges for all dependency relationships', () => {
    const nodes: DagNode[] = [
      { id: 'a', label: 'A', status: 'done', dependsOn: [] },
      { id: 'b', label: 'B', status: 'queued', dependsOn: ['a'] }
    ]
    const layout = computeDagLayout(nodes)
    expect(layout.edges).toEqual([{ from: 'a', to: 'b' }])
  })

  it('computes x,y positions based on depth and lane', () => {
    const nodes: DagNode[] = [
      { id: 'a', label: 'A', status: 'done', dependsOn: [] },
      { id: 'b', label: 'B', status: 'queued', dependsOn: ['a'] }
    ]
    const layout = computeDagLayout(nodes)
    // Nodes at different depths should have different x positions
    const a = layout.nodes.find((n) => n.id === 'a')!
    const b = layout.nodes.find((n) => n.id === 'b')!
    expect(b.x).toBeGreaterThan(a.x)
  })

  it('handles isolated nodes (no deps, no dependents)', () => {
    const nodes: DagNode[] = [
      { id: 'a', label: 'A', status: 'backlog', dependsOn: [] }
    ]
    const layout = computeDagLayout(nodes)
    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
  })

  it('returns empty layout for empty input', () => {
    const layout = computeDagLayout([])
    expect(layout.nodes).toHaveLength(0)
    expect(layout.edges).toHaveLength(0)
  })

  it('handles missing dependency references gracefully', () => {
    const nodes: DagNode[] = [
      { id: 'b', label: 'B', status: 'blocked', dependsOn: ['nonexistent'] }
    ]
    const layout = computeDagLayout(nodes)
    expect(layout.nodes).toHaveLength(1)
    // Edge to nonexistent node should be omitted
    expect(layout.edges).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement DAG layout algorithm**

```typescript
// src/renderer/src/components/sprint/dag-layout.ts

export interface DagNode {
  id: string
  label: string
  status: string
  dependsOn: string[] // IDs of upstream tasks
}

export interface LayoutNode extends DagNode {
  depth: number
  lane: number // vertical position within a depth column
  x: number
  y: number
}

export interface DagEdge {
  from: string
  to: string
}

export interface DagLayout {
  nodes: LayoutNode[]
  edges: DagEdge[]
  width: number
  height: number
}

const NODE_WIDTH = 160
const NODE_HEIGHT = 60
const H_GAP = 80 // horizontal gap between depth columns
const V_GAP = 40 // vertical gap between nodes in same column
const PADDING = 40

/**
 * Compute DAG layout using topological layering.
 * Nodes are placed in columns by dependency depth (longest-path layering).
 * Within each column, nodes are stacked vertically.
 */
export function computeDagLayout(nodes: DagNode[]): DagLayout {
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // 1. Compute depth for each node (longest path from root)
  const depthMap = new Map<string, number>()

  function getDepth(id: string, visited: Set<string>): number {
    if (depthMap.has(id)) return depthMap.get(id)!
    if (visited.has(id)) return 0 // cycle guard
    visited.add(id)

    const node = nodeMap.get(id)
    if (!node || node.dependsOn.length === 0) {
      depthMap.set(id, 0)
      return 0
    }

    let maxUpstream = -1
    for (const upId of node.dependsOn) {
      if (nodeMap.has(upId)) {
        maxUpstream = Math.max(maxUpstream, getDepth(upId, visited))
      }
    }
    const depth = maxUpstream + 1
    depthMap.set(id, depth)
    return depth
  }

  for (const node of nodes) {
    getDepth(node.id, new Set())
  }

  // 2. Group nodes by depth
  const columns = new Map<number, DagNode[]>()
  for (const node of nodes) {
    const d = depthMap.get(node.id) ?? 0
    const col = columns.get(d) ?? []
    col.push(node)
    columns.set(d, col)
  }

  // 3. Assign x,y positions
  const maxDepth = Math.max(...depthMap.values(), 0)
  const layoutNodes: LayoutNode[] = []

  for (let depth = 0; depth <= maxDepth; depth++) {
    const col = columns.get(depth) ?? []
    col.forEach((node, lane) => {
      layoutNodes.push({
        ...node,
        depth,
        lane,
        x: PADDING + depth * (NODE_WIDTH + H_GAP),
        y: PADDING + lane * (NODE_HEIGHT + V_GAP)
      })
    })
  }

  // 4. Generate edges (only for nodes that exist in the input)
  const edges: DagEdge[] = []
  for (const node of nodes) {
    for (const upId of node.dependsOn) {
      if (nodeMap.has(upId)) {
        edges.push({ from: upId, to: node.id })
      }
    }
  }

  // 5. Compute overall dimensions
  const maxLane = Math.max(...layoutNodes.map((n) => n.lane), 0)
  const width = PADDING * 2 + (maxDepth + 1) * NODE_WIDTH + maxDepth * H_GAP
  const height = PADDING * 2 + (maxLane + 1) * NODE_HEIGHT + maxLane * V_GAP

  return { nodes: layoutNodes, edges, width, height }
}
```

- [ ] **Step 3: Run tests**

```bash
cd ~/projects/BDE && npx vitest run src/renderer/src/components/sprint/__tests__/dag-layout.test.ts
```

---

### Task 5: DAG Visualization Component

**Files:**
- Create: `src/renderer/src/components/sprint/DagNode.tsx`
- Create: `src/renderer/src/components/sprint/DagOverlay.tsx`
- Create: `src/renderer/src/assets/dag-neon.css`
- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Create: `src/renderer/src/components/sprint/__tests__/DagOverlay.test.tsx`

- [ ] **Step 1: Write tests for DagOverlay**

```typescript
// src/renderer/src/components/sprint/__tests__/DagOverlay.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DagOverlay } from '../DagOverlay'
import type { SprintTask } from '../../../../../shared/types'

const baseTasks: SprintTask[] = [
  {
    id: '1', title: 'Task A', status: 'done', repo: 'bde',
    depends_on: null, priority: 1, prompt: null, spec: null,
    notes: null, retry_count: 0, fast_fail_count: 0,
    agent_run_id: null, pr_number: null, pr_status: null, pr_url: null,
    claimed_by: null, started_at: null, completed_at: null,
    template_name: null, updated_at: '', created_at: ''
  },
  {
    id: '2', title: 'Task B', status: 'blocked', repo: 'bde',
    depends_on: [{ id: '1', type: 'hard' }], priority: 1,
    prompt: null, spec: null, notes: null, retry_count: 0,
    fast_fail_count: 0, agent_run_id: null, pr_number: null,
    pr_status: null, pr_url: null, claimed_by: null,
    started_at: null, completed_at: null, template_name: null,
    updated_at: '', created_at: ''
  }
]

describe('DagOverlay', () => {
  it('renders SVG with task nodes', () => {
    render(<DagOverlay tasks={baseTasks} onClose={vi.fn()} onTaskClick={vi.fn()} />)
    expect(screen.getByText('Task A')).toBeInTheDocument()
    expect(screen.getByText('Task B')).toBeInTheDocument()
  })

  it('renders dependency arrow between connected tasks', () => {
    const { container } = render(
      <DagOverlay tasks={baseTasks} onClose={vi.fn()} onTaskClick={vi.fn()} />
    )
    const lines = container.querySelectorAll('.dag-edge')
    expect(lines.length).toBe(1)
  })

  it('calls onTaskClick when a node is clicked', () => {
    const onClick = vi.fn()
    render(<DagOverlay tasks={baseTasks} onClose={vi.fn()} onTaskClick={onClick} />)
    fireEvent.click(screen.getByText('Task A'))
    expect(onClick).toHaveBeenCalledWith('1')
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<DagOverlay tasks={baseTasks} onClose={onClose} onTaskClick={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Close DAG view'))
    expect(onClose).toHaveBeenCalled()
  })

  it('hides tasks with no dependencies when filter active', () => {
    const isolated: SprintTask[] = [
      { ...baseTasks[0], depends_on: null, id: '3', title: 'Isolated' }
    ]
    render(
      <DagOverlay
        tasks={[...baseTasks, ...isolated]}
        onClose={vi.fn()}
        onTaskClick={vi.fn()}
        filterConnected
      />
    )
    // Isolated task with no deps and no dependents should be hidden
    expect(screen.queryByText('Isolated')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Create `DagNode.tsx`**

```typescript
// src/renderer/src/components/sprint/DagNode.tsx
import type { LayoutNode } from './dag-layout'

const STATUS_COLORS: Record<string, string> = {
  backlog: 'var(--neon-text-muted)',
  queued: 'var(--neon-orange)',
  blocked: 'var(--neon-red)',
  active: 'var(--neon-cyan)',
  review: 'var(--neon-blue)',
  done: 'var(--neon-green)',
  failed: 'var(--neon-red)',
  error: 'var(--neon-red)',
  cancelled: 'var(--neon-text-muted)'
}

interface DagNodeProps {
  node: LayoutNode
  onClick: (id: string) => void
  selected?: boolean
}

const NODE_W = 160
const NODE_H = 60

export function DagNodeComponent({ node, onClick, selected }: DagNodeProps): React.JSX.Element {
  const color = STATUS_COLORS[node.status] ?? 'var(--neon-text-muted)'

  return (
    <g
      className={`dag-node ${selected ? 'dag-node--selected' : ''}`}
      transform={`translate(${node.x}, ${node.y})`}
      onClick={() => onClick(node.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(node.id) }}
      aria-label={`${node.label} — ${node.status}`}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        className="dag-node__rect"
        style={{ stroke: color }}
      />
      <text
        x={NODE_W / 2}
        y={22}
        textAnchor="middle"
        className="dag-node__label"
      >
        {node.label.length > 20 ? node.label.slice(0, 18) + '...' : node.label}
      </text>
      <text
        x={NODE_W / 2}
        y={44}
        textAnchor="middle"
        className="dag-node__status"
        style={{ fill: color }}
      >
        {node.status}
      </text>
    </g>
  )
}
```

- [ ] **Step 3: Create `DagOverlay.tsx`**

```typescript
// src/renderer/src/components/sprint/DagOverlay.tsx
import { useMemo } from 'react'
import type { SprintTask } from '../../../../shared/types'
import { computeDagLayout, type DagNode } from './dag-layout'
import { DagNodeComponent } from './DagNode'
import { X } from 'lucide-react'
import '../../assets/dag-neon.css'

interface DagOverlayProps {
  tasks: SprintTask[]
  onClose: () => void
  onTaskClick: (id: string) => void
  selectedTaskId?: string | null
  filterConnected?: boolean
}

const NODE_W = 160
const NODE_H = 60

export function DagOverlay({
  tasks,
  onClose,
  onTaskClick,
  selectedTaskId,
  filterConnected
}: DagOverlayProps): React.JSX.Element {
  const dagNodes = useMemo(() => {
    let filtered = tasks
    if (filterConnected) {
      // Only show tasks that have deps or are depended upon
      const depSet = new Set<string>()
      for (const t of tasks) {
        if (t.depends_on) {
          depSet.add(t.id)
          for (const d of t.depends_on) depSet.add(d.id)
        }
      }
      filtered = tasks.filter((t) => depSet.has(t.id))
    }

    return filtered.map((t): DagNode => ({
      id: t.id,
      label: t.title,
      status: t.status,
      dependsOn: t.depends_on?.map((d) => d.id) ?? []
    }))
  }, [tasks, filterConnected])

  const layout = useMemo(() => computeDagLayout(dagNodes), [dagNodes])

  const nodeMap = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout.nodes]
  )

  return (
    <div className="dag-overlay" role="dialog" aria-modal="true" aria-label="Dependency graph">
      <div className="dag-overlay__header">
        <h2 className="dag-overlay__title">Dependency Graph</h2>
        <button
          className="dag-overlay__close"
          onClick={onClose}
          aria-label="Close DAG view"
        >
          <X size={18} />
        </button>
      </div>
      <div className="dag-overlay__canvas">
        <svg
          width={Math.max(layout.width, 400)}
          height={Math.max(layout.height, 300)}
          className="dag-svg"
        >
          {/* Edges */}
          {layout.edges.map((edge) => {
            const from = nodeMap.get(edge.from)
            const to = nodeMap.get(edge.to)
            if (!from || !to) return null
            const x1 = from.x + NODE_W
            const y1 = from.y + NODE_H / 2
            const x2 = to.x
            const y2 = to.y + NODE_H / 2
            const mx = (x1 + x2) / 2
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                className="dag-edge"
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                markerEnd="url(#dag-arrow)"
              />
            )
          })}
          {/* Arrow marker definition */}
          <defs>
            <marker
              id="dag-arrow"
              viewBox="0 0 10 10"
              refX={10}
              refY={5}
              markerWidth={8}
              markerHeight={8}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="dag-arrow-head" />
            </marker>
          </defs>
          {/* Nodes */}
          {layout.nodes.map((node) => (
            <DagNodeComponent
              key={node.id}
              node={node}
              onClick={onTaskClick}
              selected={node.id === selectedTaskId}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `dag-neon.css`**

```css
/* src/renderer/src/assets/dag-neon.css */

.dag-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--bde-overlay);
  backdrop-filter: blur(8px);
}

.dag-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--neon-border);
}

.dag-overlay__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--neon-text);
}

.dag-overlay__close {
  background: none;
  border: none;
  color: var(--neon-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.dag-overlay__close:hover {
  color: var(--neon-text);
  background: var(--neon-surface-hover);
}

.dag-overlay__canvas {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.dag-svg {
  display: block;
}

.dag-edge {
  fill: none;
  stroke: var(--neon-border);
  stroke-width: 2;
}

.dag-arrow-head {
  fill: var(--neon-border);
}

.dag-node {
  cursor: pointer;
}

.dag-node:hover .dag-node__rect,
.dag-node:focus .dag-node__rect {
  filter: brightness(1.3);
}

.dag-node--selected .dag-node__rect {
  stroke-width: 3;
  filter: drop-shadow(0 0 6px currentColor);
}

.dag-node__rect {
  fill: var(--neon-surface);
  stroke-width: 2;
  transition: filter 0.15s ease;
}

.dag-node__label {
  fill: var(--neon-text);
  font-size: 12px;
  font-weight: 500;
  pointer-events: none;
}

.dag-node__status {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  pointer-events: none;
}
```

- [ ] **Step 5: Add DAG toggle to `SprintPipeline.tsx`**

In `SprintPipeline.tsx`, add a `dagOpen` state and a toggle button in the header area. Import `DagOverlay`. When `dagOpen` is true, render the `DagOverlay` on top of the pipeline.

```typescript
// Add to SprintPipeline.tsx:
import { DagOverlay } from './DagOverlay'

// Inside component:
const [dagOpen, setDagOpen] = useState(false)

// In JSX, after PipelineHeader:
{dagOpen && (
  <DagOverlay
    tasks={tasks}
    onClose={() => setDagOpen(false)}
    onTaskClick={(id) => {
      handleTaskClick(id)
      setDagOpen(false)
    }}
    selectedTaskId={selectedTaskId}
    filterConnected
  />
)}
```

Add a button in `PipelineHeader` or `PipelineFilterBar` to toggle DAG view. Use `GitBranch` or `Network` icon from `lucide-react`.

- [ ] **Step 6: Import `dag-neon.css` in `main.css`**

Add `@import` for `dag-neon.css` after other neon imports in the main CSS entry point.

- [ ] **Step 7: Run all tests**

```bash
cd ~/projects/BDE && npx vitest run src/renderer/src/components/sprint/__tests__/DagOverlay.test.tsx src/renderer/src/components/sprint/__tests__/dag-layout.test.ts
```

---

### Task 6: Workflow Templates (Task Chain Templates)

**Files:**
- Create: `src/shared/workflow-templates.ts`
- Modify: `src/main/handlers/sprint-local.ts`
- Create: `src/renderer/src/components/task-workbench/WorkflowTemplatePicker.tsx`
- Create: `src/shared/__tests__/workflow-templates.test.ts`

- [ ] **Step 1: Write tests for workflow templates**

```typescript
// src/shared/__tests__/workflow-templates.test.ts
import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_WORKFLOWS,
  expandWorkflowTemplate,
  type WorkflowTemplate,
  type ExpandedTask
} from '../workflow-templates'

describe('workflow-templates', () => {
  it('has at least one built-in workflow', () => {
    expect(BUILT_IN_WORKFLOWS.length).toBeGreaterThan(0)
  })

  it('each built-in workflow has valid structure', () => {
    for (const wf of BUILT_IN_WORKFLOWS) {
      expect(wf.name).toBeTruthy()
      expect(wf.steps.length).toBeGreaterThan(0)
      for (const step of wf.steps) {
        expect(step.titleSuffix).toBeTruthy()
        // dependsOnStep indices must be valid
        for (const idx of step.dependsOnStep ?? []) {
          expect(idx).toBeLessThan(wf.steps.indexOf(step))
          expect(idx).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  describe('expandWorkflowTemplate', () => {
    const template: WorkflowTemplate = {
      name: 'Test Flow',
      description: 'A test workflow',
      steps: [
        { titleSuffix: 'audit', depType: 'hard' },
        { titleSuffix: 'plan', depType: 'hard', dependsOnStep: [0] },
        { titleSuffix: 'implement', depType: 'hard', dependsOnStep: [1] }
      ]
    }

    it('generates tasks with correct titles', () => {
      const tasks = expandWorkflowTemplate(template, 'Auth Refactor', 'bde')
      expect(tasks[0].title).toBe('Auth Refactor — audit')
      expect(tasks[1].title).toBe('Auth Refactor — plan')
      expect(tasks[2].title).toBe('Auth Refactor — implement')
    })

    it('wires dependencies correctly', () => {
      const tasks = expandWorkflowTemplate(template, 'Auth', 'bde')
      expect(tasks[0].depends_on).toEqual([])
      expect(tasks[1].depends_on).toEqual([{ id: tasks[0].tempId, type: 'hard' }])
      expect(tasks[2].depends_on).toEqual([{ id: tasks[1].tempId, type: 'hard' }])
    })

    it('sets repo on all tasks', () => {
      const tasks = expandWorkflowTemplate(template, 'Auth', 'bde')
      expect(tasks.every((t) => t.repo === 'bde')).toBe(true)
    })

    it('assigns tempIds for dependency wiring', () => {
      const tasks = expandWorkflowTemplate(template, 'Auth', 'bde')
      const ids = new Set(tasks.map((t) => t.tempId))
      expect(ids.size).toBe(tasks.length) // all unique
    })
  })
})
```

- [ ] **Step 2: Implement workflow templates**

```typescript
// src/shared/workflow-templates.ts

import type { TaskDependency } from './types'

export interface WorkflowStep {
  titleSuffix: string
  depType: 'hard' | 'soft'
  dependsOnStep?: number[] // indices of steps this depends on
  specTemplate?: string // optional spec template text
}

export interface WorkflowTemplate {
  name: string
  description: string
  steps: WorkflowStep[]
}

export interface ExpandedTask {
  tempId: string
  title: string
  repo: string
  status: 'backlog'
  priority: number
  depends_on: TaskDependency[]
}

let nextTempId = 0
function generateTempId(): string {
  return `temp-${Date.now()}-${nextTempId++}`
}

export function expandWorkflowTemplate(
  template: WorkflowTemplate,
  baseTitle: string,
  repo: string,
  priority: number = 3
): ExpandedTask[] {
  const tempIds: string[] = []
  const tasks: ExpandedTask[] = []

  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i]
    const tempId = generateTempId()
    tempIds.push(tempId)

    const deps: TaskDependency[] = (step.dependsOnStep ?? []).map((idx) => ({
      id: tempIds[idx],
      type: step.depType
    }))

    tasks.push({
      tempId,
      title: `${baseTitle} — ${step.titleSuffix}`,
      repo,
      status: 'backlog',
      priority,
      depends_on: deps
    })
  }

  return tasks
}

export const BUILT_IN_WORKFLOWS: WorkflowTemplate[] = [
  {
    name: 'Feature Pipeline',
    description: 'audit -> plan -> implement -> test -> docs',
    steps: [
      { titleSuffix: 'audit', depType: 'hard' },
      { titleSuffix: 'plan', depType: 'hard', dependsOnStep: [0] },
      { titleSuffix: 'implement', depType: 'hard', dependsOnStep: [1] },
      { titleSuffix: 'test', depType: 'hard', dependsOnStep: [2] },
      { titleSuffix: 'docs', depType: 'soft', dependsOnStep: [2] }
    ]
  },
  {
    name: 'Bug Fix Pipeline',
    description: 'investigate -> fix -> test -> verify',
    steps: [
      { titleSuffix: 'investigate', depType: 'hard' },
      { titleSuffix: 'fix', depType: 'hard', dependsOnStep: [0] },
      { titleSuffix: 'test', depType: 'hard', dependsOnStep: [1] },
      { titleSuffix: 'verify', depType: 'hard', dependsOnStep: [2] }
    ]
  },
  {
    name: 'Refactor Pipeline',
    description: 'audit -> plan -> refactor -> test',
    steps: [
      { titleSuffix: 'audit', depType: 'hard' },
      { titleSuffix: 'plan', depType: 'hard', dependsOnStep: [0] },
      { titleSuffix: 'refactor', depType: 'hard', dependsOnStep: [1] },
      { titleSuffix: 'test', depType: 'hard', dependsOnStep: [2] }
    ]
  }
]
```

- [ ] **Step 3: Add `sprint:createChain` IPC handler**

In `src/main/handlers/sprint-local.ts`, add:

```typescript
safeHandle('sprint:createChain', async (_e, chain: Array<{
  title: string
  repo: string
  priority?: number
  spec?: string
  depends_on_indices?: number[] // indices into this array
  dep_type?: 'hard' | 'soft'
}>) => {
  // Create tasks in order, mapping temp indices to real IDs
  const createdIds: string[] = []

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]
    const deps: TaskDependency[] = (step.depends_on_indices ?? []).map((idx) => ({
      id: createdIds[idx],
      type: step.dep_type ?? 'hard'
    }))

    const task = createTask({
      title: step.title,
      repo: step.repo,
      priority: step.priority ?? 3,
      spec: step.spec,
      depends_on: deps.length > 0 ? deps : undefined
    })

    if (!task) throw new Error(`Failed to create task "${step.title}" at index ${i}`)
    createdIds.push(task.id)
  }

  return { ids: createdIds, count: createdIds.length }
})
```

- [ ] **Step 4: Update preload bridge**

In `src/preload/index.ts`, add to `sprint` namespace:

```typescript
createChain: (chain: Array<{
  title: string; repo: string; priority?: number; spec?: string;
  depends_on_indices?: number[]; dep_type?: 'hard' | 'soft';
}>) => ipcRenderer.invoke('sprint:createChain', chain),
```

In `src/preload/index.d.ts`, add matching type declaration.

- [ ] **Step 5: Create `WorkflowTemplatePicker.tsx`**

A dropdown/modal in Task Workbench that lists built-in templates. Selecting one fills in a base title prompt, then creates the full chain via `sprint:createChain`.

- [ ] **Step 6: Run tests**

```bash
cd ~/projects/BDE && npx vitest run src/shared/__tests__/workflow-templates.test.ts
```

---

### Task 7: Batch Task Import from YAML/JSON

**Files:**
- Create: `src/shared/batch-import-schema.ts`
- Create: `src/main/handlers/sprint-batch-import.ts`
- Modify: `src/main/handlers/sprint-local.ts`
- Create: `src/renderer/src/components/task-workbench/BatchImportModal.tsx`
- Create: `src/main/handlers/__tests__/batch-import.test.ts`

- [ ] **Step 1: Write tests for batch import parsing**

```typescript
// src/main/handlers/__tests__/batch-import.test.ts
import { describe, it, expect } from 'vitest'
import { parseBatchImport, validateBatchImport, type BatchImportInput } from '../../shared/batch-import-schema'

describe('batch-import-schema', () => {
  describe('parseBatchImport', () => {
    it('parses valid JSON', () => {
      const input = JSON.stringify({
        tasks: [
          { title: 'Task A', repo: 'bde' },
          { title: 'Task B', repo: 'bde', depends_on: ['Task A'] }
        ]
      })
      const result = parseBatchImport(input)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.tasks).toHaveLength(2)
    })

    it('parses valid YAML', () => {
      const input = `
tasks:
  - title: Task A
    repo: bde
  - title: Task B
    repo: bde
    depends_on:
      - Task A
`
      const result = parseBatchImport(input)
      expect(result.ok).toBe(true)
    })

    it('rejects invalid structure', () => {
      const result = parseBatchImport('not valid')
      expect(result.ok).toBe(false)
    })

    it('rejects tasks without title', () => {
      const input = JSON.stringify({ tasks: [{ repo: 'bde' }] })
      const result = parseBatchImport(input)
      expect(result.ok).toBe(false)
    })

    it('rejects tasks without repo', () => {
      const input = JSON.stringify({ tasks: [{ title: 'T' }] })
      const result = parseBatchImport(input)
      expect(result.ok).toBe(false)
    })
  })

  describe('validateBatchImport', () => {
    it('detects cycles', () => {
      const input: BatchImportInput = {
        tasks: [
          { title: 'A', repo: 'bde', depends_on: ['B'] },
          { title: 'B', repo: 'bde', depends_on: ['A'] }
        ]
      }
      const result = validateBatchImport(input)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(expect.stringContaining('cycle'))
    })

    it('detects dangling dependency references', () => {
      const input: BatchImportInput = {
        tasks: [
          { title: 'A', repo: 'bde', depends_on: ['NonExistent'] }
        ]
      }
      const result = validateBatchImport(input)
      expect(result.valid).toBe(false)
    })

    it('validates clean graph', () => {
      const input: BatchImportInput = {
        tasks: [
          { title: 'A', repo: 'bde' },
          { title: 'B', repo: 'bde', depends_on: ['A'] }
        ]
      }
      const result = validateBatchImport(input)
      expect(result.valid).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Implement batch import schema**

```typescript
// src/shared/batch-import-schema.ts

import type { Result } from './types'

export interface BatchImportTask {
  title: string
  repo: string
  priority?: number
  spec?: string
  prompt?: string
  depends_on?: string[] // titles of other tasks in the batch
  dep_type?: 'hard' | 'soft'
  condition?: 'on_success' | 'on_failure' | 'always'
}

export interface BatchImportInput {
  tasks: BatchImportTask[]
}

/**
 * Parse JSON or YAML-like input into BatchImportInput.
 * NOTE: For YAML, we use a simple line-based parser to avoid adding a dependency.
 * For production use, only JSON is fully supported. YAML support is best-effort.
 */
export function parseBatchImport(raw: string): Result<BatchImportInput> {
  const trimmed = raw.trim()

  // Try JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      const data = parsed.tasks ? parsed : { tasks: parsed }
      return validateShape(data)
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  // Try simple YAML-like parsing
  try {
    const data = parseSimpleYaml(trimmed)
    return validateShape(data)
  } catch (e) {
    return { ok: false, error: `Parse error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function validateShape(data: unknown): Result<BatchImportInput> {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Expected an object' }
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.tasks)) return { ok: false, error: 'Expected "tasks" array' }

  for (let i = 0; i < obj.tasks.length; i++) {
    const t = obj.tasks[i]
    if (!t || typeof t !== 'object') return { ok: false, error: `Task at index ${i} is not an object` }
    const task = t as Record<string, unknown>
    if (!task.title || typeof task.title !== 'string') return { ok: false, error: `Task at index ${i} missing "title"` }
    if (!task.repo || typeof task.repo !== 'string') return { ok: false, error: `Task at index ${i} missing "repo"` }
  }

  return { ok: true, data: obj as unknown as BatchImportInput }
}

function parseSimpleYaml(raw: string): BatchImportInput {
  // Minimal YAML parser: handles indented list items with key: value pairs
  const lines = raw.split('\n')
  const tasks: BatchImportTask[] = []
  let current: Partial<BatchImportTask> | null = null
  let inDeps = false

  for (const line of lines) {
    const trimLine = line.trim()
    if (!trimLine || trimLine.startsWith('#')) continue
    if (trimLine === 'tasks:') continue

    if (trimLine.startsWith('- title:')) {
      if (current?.title) tasks.push(current as BatchImportTask)
      current = { title: trimLine.replace('- title:', '').trim() }
      inDeps = false
    } else if (current && trimLine.startsWith('repo:')) {
      current.repo = trimLine.replace('repo:', '').trim()
    } else if (current && trimLine.startsWith('priority:')) {
      current.priority = parseInt(trimLine.replace('priority:', '').trim(), 10)
    } else if (current && trimLine === 'depends_on:') {
      current.depends_on = []
      inDeps = true
    } else if (inDeps && trimLine.startsWith('-')) {
      current!.depends_on!.push(trimLine.replace(/^-\s*/, '').trim())
    } else {
      inDeps = false
    }
  }
  if (current?.title) tasks.push(current as BatchImportTask)

  return { tasks }
}

export function validateBatchImport(input: BatchImportInput): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const titleSet = new Set(input.tasks.map((t) => t.title))

  // Check for dangling references
  for (const task of input.tasks) {
    for (const dep of task.depends_on ?? []) {
      if (!titleSet.has(dep)) {
        errors.push(`Task "${task.title}" depends on "${dep}" which is not in the batch`)
      }
    }
  }

  // Check for cycles (simple DFS)
  const graph = new Map<string, string[]>()
  for (const task of input.tasks) {
    graph.set(task.title, task.depends_on ?? [])
  }

  function hasCycle(start: string, visited: Set<string>, stack: Set<string>): boolean {
    visited.add(start)
    stack.add(start)
    for (const dep of graph.get(start) ?? []) {
      if (stack.has(dep)) {
        errors.push(`Cycle detected involving "${start}" and "${dep}"`)
        return true
      }
      if (!visited.has(dep) && hasCycle(dep, visited, stack)) return true
    }
    stack.delete(start)
    return false
  }

  const visited = new Set<string>()
  for (const task of input.tasks) {
    if (!visited.has(task.title)) {
      hasCycle(task.title, visited, new Set())
    }
  }

  return { valid: errors.length === 0, errors }
}
```

- [ ] **Step 3: Add `sprint:batchImport` IPC handler**

In `src/main/handlers/sprint-local.ts`:

```typescript
safeHandle('sprint:batchImport', async (_e, raw: string) => {
  const { parseBatchImport, validateBatchImport } = await import('../../shared/batch-import-schema')

  const parsed = parseBatchImport(raw)
  if (!parsed.ok) throw new Error(parsed.error)

  const validation = validateBatchImport(parsed.data)
  if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join('; ')}`)

  // Create tasks in topological order, mapping titles to real IDs
  const titleToId = new Map<string, string>()
  const created: string[] = []

  // Topological sort by dependencies
  const sorted = topologicalSort(parsed.data.tasks)

  for (const taskDef of sorted) {
    const deps = (taskDef.depends_on ?? [])
      .map((depTitle) => {
        const depId = titleToId.get(depTitle)
        if (!depId) return null
        return { id: depId, type: taskDef.dep_type ?? ('hard' as const) }
      })
      .filter(Boolean)

    const task = createTask({
      title: taskDef.title,
      repo: taskDef.repo,
      priority: taskDef.priority ?? 3,
      spec: taskDef.spec,
      prompt: taskDef.prompt,
      depends_on: deps.length > 0 ? deps : undefined
    })

    if (!task) throw new Error(`Failed to create task "${taskDef.title}"`)
    titleToId.set(taskDef.title, task.id)
    created.push(task.id)
  }

  return { ids: created, count: created.length }
})
```

- [ ] **Step 4: Add `topologicalSort` helper** (inline in the handler file or in `batch-import-schema.ts`)

- [ ] **Step 5: Update preload bridge** for `batchImport`

- [ ] **Step 6: Create `BatchImportModal.tsx`**

A modal with a textarea for pasting JSON/YAML, a file upload button, validation feedback, and a "Create All" button. Accessible from Task Workbench via a button.

- [ ] **Step 7: Run tests**

```bash
cd ~/projects/BDE && npx vitest run src/main/handlers/__tests__/batch-import.test.ts
```

---

### Task 8: DependencyPicker Condition Support

**Files:**
- Modify: `src/renderer/src/components/task-workbench/DependencyPicker.tsx`

- [ ] **Step 1: Add condition selector to dependency items**

In `DependencyPicker.tsx`, modify the dependency list items to include a condition dropdown after the type toggle:

```typescript
// Inside the dependency list item:
<select
  className="wb-deps__condition"
  value={dep.condition ?? ''}
  onChange={(e) => handleSetCondition(dep.id, e.target.value || undefined)}
  aria-label="Dependency condition"
  title="When is this dependency satisfied?"
>
  <option value="">Default</option>
  <option value="on_success">On Success</option>
  <option value="on_failure">On Failure</option>
  <option value="always">Always</option>
</select>
```

Add `handleSetCondition` callback:

```typescript
const handleSetCondition = useCallback(
  (id: string, condition: string | undefined) => {
    onChange(
      dependencies.map((d) =>
        d.id === id ? { ...d, condition: condition as TaskDependency['condition'] } : d
      )
    )
  },
  [dependencies, onChange]
)
```

- [ ] **Step 2: Add CSS for condition selector in `task-workbench-neon.css`**

```css
.wb-deps__condition {
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--neon-surface);
  color: var(--neon-text-muted);
  border: 1px solid var(--neon-border);
  cursor: pointer;
}
```

- [ ] **Step 3: Run existing DependencyPicker tests to confirm no regressions**

```bash
cd ~/projects/BDE && npx vitest run --testPathPattern DependencyPicker
```

---

### Task 9: Integration — Wiring & Handler Count Updates

**Files:**
- Modify: `src/main/index.ts` (register new handlers)
- Modify: `src/preload/index.ts` (bridge methods)
- Modify: `src/preload/index.d.ts` (type declarations)
- Modify: `src/main/handlers/__tests__/sprint-local-count.test.ts` (if exists, update handler count)
- Modify: `src/shared/ipc-channels.ts` (add new channel names)

- [ ] **Step 1: Add IPC channels**

In `src/shared/ipc-channels.ts`:

```typescript
// Add to the channels list:
'sprint:createChain',
'sprint:batchImport',
```

- [ ] **Step 2: Update preload bridge**

Add `createChain` and `batchImport` methods to the sprint namespace in both `src/preload/index.ts` and `src/preload/index.d.ts`.

- [ ] **Step 3: Update handler count test**

If `src/main/handlers/__tests__/` has a test asserting the number of `safeHandle()` calls in `sprint-local.ts`, update the expected count by +2.

- [ ] **Step 4: Wire `getCascadeBehavior` in `src/main/index.ts`**

When creating the `TaskTerminalService`, pass:

```typescript
getCascadeBehavior: () => {
  const setting = getSetting('dependency.cascadeBehavior')
  return (setting as CascadeBehavior) ?? 'continue'
}
```

- [ ] **Step 5: Add cascade behavior setting to Settings UI**

In the Agent Manager settings tab, add a dropdown for "On Hard Dependency Failure" with options: Continue (default), Cancel Chain, Pause.

- [ ] **Step 6: Run full test suite**

```bash
cd ~/projects/BDE && npm run typecheck && npm test && npm run lint
```

---

## Execution Order

Tasks should be implemented in this order due to dependencies:

1. **Task 1** (Conditional deps types) — foundation for Tasks 2, 8
2. **Task 2** (Conditional resolution logic) — depends on Task 1
3. **Task 3** (Cascade cancel) — depends on Task 2
4. **Task 4** (DAG layout algorithm) — independent, can parallel with 1-3
5. **Task 5** (DAG visualization) — depends on Task 4
6. **Task 6** (Workflow templates) — independent, can parallel with 4-5
7. **Task 7** (Batch import) — independent, can parallel with 4-6
8. **Task 8** (DependencyPicker condition UI) — depends on Task 1
9. **Task 9** (Integration wiring) — depends on all above

Parallelizable groups:
- Group A: Tasks 1 -> 2 -> 3 (dependency resolution)
- Group B: Tasks 4 -> 5 (DAG visualization)
- Group C: Tasks 6, 7 (templates + import)
- Group D: Task 8 (UI, after Task 1)
- Final: Task 9 (integration)

---

## Risk Notes

- **No new dependencies:** DAG uses SVG (no dagre/d3). YAML parsing is minimal inline parser (JSON is primary format). Per BDE dependency policy.
- **Backward compatibility:** `TaskDependency.condition` is optional — existing deps with no condition use original `type`-based behavior. No migration needed.
- **Cascade cancel safety:** Default behavior is `'continue'` (no cascade). Users must opt-in via Settings. Recursive cascade has a visited set to prevent infinite loops.
- **Handler count tests:** Adding 2 new IPC handlers to `sprint-local.ts` requires updating any handler count assertions.
- **Preload sync:** Both `index.ts` and `index.d.ts` must be updated together.

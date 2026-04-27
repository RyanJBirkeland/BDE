/**
 * Dependency graph — pure in-memory data structure for task dependency edges.
 *
 * Owns the forward/reverse adjacency maps and the algorithms that operate on
 * them (cycle detection, dependency satisfaction, reverse-index lookup).
 * Contains zero I/O and zero blocking-policy logic.
 *
 * `dependency-service.ts` imports this and adds the blocking-policy layer
 * (shouldBlock decisions, epic integration, `checkTaskDependencies`).
 */

import { HARD_SATISFIED_STATUSES, FAILURE_STATUSES, TERMINAL_STATUSES, isTaskStatus } from '../../shared/task-state-machine'
import type { TaskDependency } from '../../shared/types'

// ============================================================================
// DependencyIndex interface (public contract for the graph)
// ============================================================================

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

// ============================================================================
// Satisfaction helpers
// ============================================================================

function satisfiesCondition(
  condition: 'on_success' | 'on_failure' | 'always',
  status: import('../../shared/task-state-machine').TaskStatus
): boolean {
  if (condition === 'on_success') return HARD_SATISFIED_STATUSES.has(status)
  if (condition === 'on_failure') return FAILURE_STATUSES.has(status)
  return TERMINAL_STATUSES.has(status)
}

function satisfiesLegacyType(
  dep: TaskDependency,
  taskId: string,
  status: import('../../shared/task-state-machine').TaskStatus,
  logger?: { warn: (msg: string) => void }
): boolean {
  // DEPRECATED: `condition` will be required in a future version. This branch
  // will be removed once all existing deps are migrated.
  ;(logger ?? console).warn(
    `[deprecation] Dependency ${dep.id} on task ${taskId} has no "condition" field — ` +
      `falling back to type="${dep.type ?? 'hard'}" behavior. ` +
      `Set an explicit condition ("on_success", "on_failure", or "always") to silence this warning.`
  )
  if (dep.type === 'hard') return HARD_SATISFIED_STATUSES.has(status)
  return TERMINAL_STATUSES.has(status)
}

function isDependencySatisfied(
  dep: TaskDependency,
  taskId: string,
  getTaskStatus: (id: string) => string | undefined,
  logger?: { warn: (msg: string) => void }
): boolean {
  const rawStatus = getTaskStatus(dep.id)
  if (rawStatus === undefined) return true
  if (!isTaskStatus(rawStatus)) return false
  return dep.condition
    ? satisfiesCondition(dep.condition, rawStatus)
    : satisfiesLegacyType(dep, taskId, rawStatus, logger)
}

// ============================================================================
// DependencyGraph class
// ============================================================================

/**
 * In-memory directed graph of task dependency edges.
 *
 * Implements the `DependencyIndex` interface so it is a drop-in for all
 * existing callers that type-parameterise on that interface.
 */
export class DependencyGraph implements DependencyIndex {
  private readonly reverseMap = new Map<string, Set<string>>()
  private readonly forwardMap = new Map<string, Set<string>>()

  private addEdges(taskId: string, deps: TaskDependency[] | null): void {
    if (!deps || deps.length === 0) {
      this.forwardMap.delete(taskId)
      return
    }
    const depIds = new Set<string>()
    for (const dep of deps) {
      depIds.add(dep.id)
      let set = this.reverseMap.get(dep.id)
      if (!set) {
        set = new Set()
        this.reverseMap.set(dep.id, set)
      }
      set.add(taskId)
    }
    this.forwardMap.set(taskId, depIds)
  }

  private removeEdges(taskId: string): void {
    const oldDeps = this.forwardMap.get(taskId)
    if (oldDeps) {
      for (const depId of oldDeps) {
        const dependents = this.reverseMap.get(depId)
        if (dependents) {
          dependents.delete(taskId)
          if (dependents.size === 0) {
            this.reverseMap.delete(depId)
          }
        }
      }
    }
    this.forwardMap.delete(taskId)
  }

  rebuild(tasks: Array<{ id: string; depends_on: TaskDependency[] | null }>): void {
    this.reverseMap.clear()
    this.forwardMap.clear()
    for (const task of tasks) this.addEdges(task.id, task.depends_on)
  }

  update(taskId: string, deps: TaskDependency[] | null): void {
    this.removeEdges(taskId)
    this.addEdges(taskId, deps)
  }

  remove(taskId: string): void {
    this.removeEdges(taskId)
    this.reverseMap.delete(taskId)
  }

  getDependents(taskId: string): Set<string> {
    return this.reverseMap.get(taskId) ?? new Set()
  }

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
  areDependenciesSatisfied(
    taskId: string,
    deps: TaskDependency[],
    getTaskStatus: (id: string) => string | undefined,
    logger?: { warn: (msg: string) => void }
  ): { satisfied: boolean; blockedBy: string[] } {
    if (deps.length === 0) return { satisfied: true, blockedBy: [] }
    const blockedBy: string[] = []
    for (const dep of deps) {
      if (!isDependencySatisfied(dep, taskId, getTaskStatus, logger)) {
        blockedBy.push(dep.id)
      }
    }
    return { satisfied: blockedBy.length === 0, blockedBy }
  }
}

/**
 * Factory function for callers that prefer a functional interface.
 * Returns a `DependencyGraph` instance typed as `DependencyIndex`.
 */
export function createDependencyIndex(): DependencyIndex {
  return new DependencyGraph()
}

// ============================================================================
// Cycle detection
// ============================================================================

export function detectCycle(
  taskId: string,
  proposedDeps: TaskDependency[],
  getDepsForTask: (id: string) => TaskDependency[] | null
): string[] | null {
  for (const dep of proposedDeps) {
    if (dep.id === taskId) return [taskId, taskId]
  }
  for (const dep of proposedDeps) {
    const visited = new Set<string>()
    const path: string[] = [taskId, dep.id]
    function dfs(current: string): string[] | null {
      if (current === taskId) return [...path]
      if (visited.has(current)) return null
      visited.add(current)
      const deps = getDepsForTask(current)
      if (!deps) return null
      for (const dependency of deps) {
        path.push(dependency.id)
        const cycleFound = dfs(dependency.id)
        if (cycleFound) return cycleFound
        path.pop()
      }
      return null
    }
    const cycle = dfs(dep.id)
    if (cycle) return cycle
  }
  return null
}

// ============================================================================
// Graph validation
// ============================================================================

export type DependencyGraphValidation =
  | { valid: true }
  | { valid: false; error: string }
  | { valid: false; cycle: string[] }

export interface ValidateDependencyGraphDeps {
  getTask: (id: string) => { id: string; depends_on: TaskDependency[] | null } | null
  listTasks: () => Array<{ id: string; depends_on: TaskDependency[] | null }>
}

/**
 * Pure validation for a proposed dependency edit. Returns a discriminated union
 * so callers can branch on missing-target vs cycle without parsing strings.
 *
 * Two checks, in order:
 *   1. Every proposed dep id must resolve to an existing task.
 *   2. Adding the proposed deps must not form a cycle.
 */
export function validateDependencyGraph(
  taskId: string,
  proposedDeps: TaskDependency[],
  deps: ValidateDependencyGraphDeps
): DependencyGraphValidation {
  for (const dep of proposedDeps) {
    if (!deps.getTask(dep.id)) {
      return { valid: false, error: `Task ${dep.id} not found` }
    }
  }
  const taskDeps = new Map(deps.listTasks().map((t) => [t.id, t.depends_on]))
  const cycle = detectCycle(taskId, proposedDeps, (id) => taskDeps.get(id) ?? null)
  if (cycle) return { valid: false, cycle }
  return { valid: true }
}

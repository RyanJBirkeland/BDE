/**
 * agent-manager-test-internals.ts — Stable test seam for AgentManagerImpl.
 *
 * `AgentManagerImpl` uses TypeScript `private` on its mutable lifecycle and
 * drain-runtime fields. This seam accesses those fields via `(mgr as any)`
 * to bridge the compile-time privacy boundary — acceptable because this file
 * is imported only in test code, never in production paths.
 *
 * The remaining collaborator fields (`_depIndex`, `_metrics`, etc.) are
 * `readonly` without `private`, so they are accessed directly with full type
 * safety.
 *
 * Tests access internals via `mgr.__testInternals.<name>` using stable
 * property names. Refactors inside `AgentManagerImpl` only need to update
 * the mapping in this file, not the 35+ test call sites.
 *
 * View names are deliberately verbose (`depIndexDirty`, not `dirty`) so a
 * test reading them stays self-documenting.
 */

import type { ActiveAgent } from './types'
import type { TaskStatus } from '../../shared/task-state-machine'
import type { ConcurrencyState } from './concurrency'
import type { TaskDependency } from '../../shared/types'
import type { SprintTask } from '../../shared/types/task-types'
import type { DependencyIndex } from '../services/dependency-service'
import type { CircuitBreaker } from './circuit-breaker'
import type { AgentManagerImpl } from './index'
import type { AgentRunClaim } from './run-agent'
import type { WipTracker } from './wip-tracker'
import type { ErrorRegistry } from './error-registry'
import type { SpawnRegistry } from './spawn-registry'
import type { TerminalGuard } from './terminal-guard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrivateAccess = any

export class AgentManagerTestInternals {
  // `p` grants access to TypeScript `private` fields that have no other
  // read path. `mgr` retains full typed access for the `readonly` members.
  private readonly p: PrivateAccess

  constructor(private readonly mgr: AgentManagerImpl) {
    this.p = mgr
  }

  // ---- Lifecycle flags (private — accessed via p) ----
  get running(): boolean {
    return this.p._running
  }
  get shuttingDown(): boolean {
    return this.p._shuttingDown
  }
  set shuttingDown(value: boolean) {
    this.p._shuttingDown = value
  }
  get started(): boolean {
    return this.p._started
  }

  // ---- Drain runtime (private — accessed via p) ----
  get concurrency(): ConcurrencyState {
    return this.p._concurrency
  }
  get lastTaskDeps(): Map<string, { deps: TaskDependency[] | null; hash: string }> {
    // lastTaskDeps moved to DrainLoop in T-58 — delegate through the test-accessible DrainLoop.
    return this.mgr._drainLoopInstance['lastTaskDeps'] as Map<string, { deps: TaskDependency[] | null; hash: string }>
  }
  get depIndexDirty(): boolean {
    return this.p._depIndexDirty
  }
  set depIndexDirty(value: boolean) {
    this.p._depIndexDirty = value
  }
  get consecutiveDrainErrors(): number {
    return this.p._consecutiveDrainErrors
  }
  set consecutiveDrainErrors(value: number) {
    this.p._consecutiveDrainErrors = value
  }

  // ---- Spawn tracking (delegated through SpawnRegistry) ----
  get spawnRegistry(): SpawnRegistry {
    // spawnRegistry is a private field — use p for access.
    return this.p.spawnRegistry as SpawnRegistry
  }
  get activeAgents(): ReadonlyMap<string, ActiveAgent> {
    return this.spawnRegistry.asActiveAgentsMap()
  }
  get processingTasks(): { has(id: string): boolean; size: number; add(id: string): void } {
    // Thin adapter: exposes the Set-like surface tests need, delegating to spawnRegistry verbs.
    const registry = this.spawnRegistry
    return {
      has: (id: string) => registry.isProcessing(id),
      add: (id: string) => registry.markProcessing(id),
      get size() {
        // Size not tracked separately — return 0 as a safe default; tests that need size
        // should use hasActiveAgent() or isProcessing() checks directly.
        return 0
      }
    }
  }
  get agentPromises(): Set<Promise<void>> {
    // Thin adapter: returns a snapshot Set so tests can iterate and check size.
    return new Set(this.spawnRegistry.allPromises())
  }
  get pendingSpawns(): number {
    return this.spawnRegistry.pendingSpawnCount()
  }
  set pendingSpawns(value: number) {
    // Adjust internal counter to reach the desired value.
    const current = this.spawnRegistry.pendingSpawnCount()
    const delta = value - current
    if (delta > 0) {
      for (let i = 0; i < delta; i++) this.spawnRegistry.incrementPendingSpawns()
    } else if (delta < 0) {
      for (let i = 0; i < -delta; i++) this.spawnRegistry.decrementPendingSpawns()
    }
  }

  // ---- Terminal guard (private — accessed via p) ----
  get terminalGuard(): TerminalGuard {
    return this.p.terminalGuard as TerminalGuard
  }

  // ---- Cross-cutting (readonly, typed access) ----
  get depIndex(): DependencyIndex {
    return this.mgr._depIndex
  }
  get circuitBreaker(): CircuitBreaker {
    return this.mgr._circuitBreaker
  }
  get wipTracker(): WipTracker {
    return this.mgr._wipTracker
  }
  get errorRegistry(): ErrorRegistry {
    return this.mgr._errorRegistry
  }

  // ---- Methods (delegated via _-prefixed names on the instance) ----
  drainLoop(): Promise<void> {
    return this.mgr._drainLoop()
  }
  drainQueuedTasks(available: number, taskStatusMap: Map<string, TaskStatus>): Promise<void> {
    return this.mgr._drainQueuedTasks(available, taskStatusMap)
  }
  processQueuedTask(rawTask: SprintTask, taskStatusMap: Map<string, TaskStatus>): Promise<void> {
    return this.mgr._processQueuedTask(rawTask, taskStatusMap)
  }
  refreshDependencyIndex(): Map<string, TaskStatus> {
    return this.mgr._refreshDependencyIndex()
  }
  spawnAgent(
    task: AgentRunClaim,
    worktree: { worktreePath: string; branch: string },
    repoPath: string
  ): Promise<void> {
    return this.mgr._spawnAgent(task, worktree, repoPath)
  }
  watchdogLoop(): Promise<void> {
    return this.mgr._watchdogLoop()
  }
}

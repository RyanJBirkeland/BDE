/**
 * agent-manager-test-internals.ts — Stable test seam for AgentManagerImpl.
 *
 * `AgentManagerImpl` exposes ~17 underscore-prefixed members ("private by
 * convention, not by keyword") that tests reach into directly. Renames to
 * those members previously broke 35+ test sites — Phase-A T-9 was the
 * specific case where the cost forced us to limit a class extraction to
 * the timer handles (the only group tests didn't touch).
 *
 * This module provides a typed facade between the tests and the underlying
 * fields. Tests import the view via `mgr.__testInternals` and use stable
 * property names; refactors inside `AgentManagerImpl` only need to update
 * the mapping in this file.
 *
 * View names are deliberately verbose (`depIndexDirty`, not `dirty`) so a
 * test reading them stays self-documenting.
 */

import type { ActiveAgent } from './types'
import type { ConcurrencyState } from './concurrency'
import type { TaskDependency } from '../../shared/types'
import type { SprintTask } from '../../shared/types/task-types'
import type { DependencyIndex } from '../services/dependency-service'
import type { CircuitBreaker } from './circuit-breaker'
import type { AgentManagerImpl } from './index'
import type { AgentRunClaim } from './run-agent'
import type { WipTracker } from './wip-tracker'
import type { ErrorRegistry } from './error-registry'

export class AgentManagerTestInternals {
  constructor(private readonly mgr: AgentManagerImpl) {}

  // ---- Lifecycle flags ----
  get running(): boolean {
    return this.mgr._running
  }
  get shuttingDown(): boolean {
    return this.mgr._shuttingDown
  }
  set shuttingDown(value: boolean) {
    this.mgr._shuttingDown = value
  }
  get started(): boolean {
    return this.mgr._started
  }

  // ---- Drain runtime ----
  get concurrency(): ConcurrencyState {
    return this.mgr._concurrency
  }
  get lastTaskDeps(): Map<string, { deps: TaskDependency[] | null; hash: string }> {
    return this.mgr._lastTaskDeps
  }
  get depIndexDirty(): boolean {
    return this.mgr._depIndexDirty
  }
  set depIndexDirty(value: boolean) {
    this.mgr._depIndexDirty = value
  }
  get consecutiveDrainErrors(): number {
    return this.mgr._consecutiveDrainErrors
  }
  set consecutiveDrainErrors(value: number) {
    this.mgr._consecutiveDrainErrors = value
  }

  // ---- Spawn tracking ----
  get activeAgents(): Map<string, ActiveAgent> {
    return this.mgr._activeAgents
  }
  get processingTasks(): Set<string> {
    return this.mgr._processingTasks
  }
  get agentPromises(): Set<Promise<void>> {
    return this.mgr._agentPromises
  }
  get pendingSpawns(): number {
    return this.mgr._pendingSpawns
  }
  set pendingSpawns(value: number) {
    this.mgr._pendingSpawns = value
  }

  // ---- Cross-cutting ----
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

  // ---- Methods (delegated) ----
  drainLoop(): Promise<void> {
    return this.mgr._drainLoop()
  }
  drainQueuedTasks(available: number, taskStatusMap: Map<string, string>): Promise<void> {
    return this.mgr._drainQueuedTasks(available, taskStatusMap)
  }
  processQueuedTask(rawTask: SprintTask, taskStatusMap: Map<string, string>): Promise<void> {
    return this.mgr._processQueuedTask(rawTask, taskStatusMap)
  }
  refreshDependencyIndex(): Map<string, string> {
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

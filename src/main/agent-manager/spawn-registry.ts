/**
 * SpawnRegistry — owns all in-flight agent tracking state.
 *
 * Centralizes the four mutable collections that track pipeline agents
 * currently in-flight: active agents, processing-task guards, agent promises,
 * and the pending-spawn counter. Exposes a verb-shaped mutation API so no
 * caller ever manipulates the underlying collections directly.
 */

import type { ActiveAgent } from './types'

export class SpawnRegistry {
  private readonly activeAgents = new Map<string, ActiveAgent>()
  private readonly processingTasks = new Set<string>()
  private readonly agentPromises = new Set<Promise<void>>()
  private pendingSpawns = 0

  // ---- Active agent verbs ----

  registerAgent(agent: ActiveAgent): void {
    this.activeAgents.set(agent.taskId, agent)
  }

  removeAgent(taskId: string): void {
    this.activeAgents.delete(taskId)
  }

  getAgent(taskId: string): ActiveAgent | undefined {
    return this.activeAgents.get(taskId)
  }

  hasActiveAgent(taskId: string): boolean {
    return this.activeAgents.has(taskId)
  }

  /** Read-only iteration over all currently active agents. */
  allAgents(): IterableIterator<ActiveAgent> {
    return this.activeAgents.values()
  }

  activeAgentCount(): number {
    return this.activeAgents.size
  }

  /**
   * Returns the underlying activeAgents map as a `ReadonlyMap` for callers
   * that need to pass the collection by reference (e.g. WatchdogLoopDeps,
   * DrainLoopDeps) but should not mutate it directly. The type prevents
   * callers from using `set`/`delete` on the reference.
   */
  asActiveAgentsMap(): ReadonlyMap<string, ActiveAgent> {
    return this.activeAgents
  }

  // ---- Processing-task guard verbs ----

  markProcessing(taskId: string): void {
    this.processingTasks.add(taskId)
  }

  unmarkProcessing(taskId: string): void {
    this.processingTasks.delete(taskId)
  }

  isProcessing(taskId: string): boolean {
    return this.processingTasks.has(taskId)
  }

  // ---- Agent promise verbs ----

  trackPromise(promise: Promise<void>): void {
    this.agentPromises.add(promise)
  }

  forgetPromise(promise: Promise<void>): void {
    this.agentPromises.delete(promise)
  }

  /** Read-only iteration over all in-flight agent promises. */
  allPromises(): IterableIterator<Promise<void>> {
    return this.agentPromises.values()
  }

  // ---- Pending-spawn counter verbs ----

  incrementPendingSpawns(): void {
    this.pendingSpawns++
  }

  /** Decrements the pending-spawn counter, flooring at 0 to prevent negative values. */
  decrementPendingSpawns(): void {
    this.pendingSpawns = Math.max(0, this.pendingSpawns - 1)
  }

  pendingSpawnCount(): number {
    return this.pendingSpawns
  }
}

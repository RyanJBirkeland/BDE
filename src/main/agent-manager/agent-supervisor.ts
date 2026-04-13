import type { Logger } from '../logger'
import type { ActiveAgent, AgentManagerConfig, WatchdogAction } from './types'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { ConcurrencyState } from './concurrency'
import type { MetricsCollector } from './metrics'
import { checkAgent } from './watchdog'
import { pruneStaleWorktrees } from './worktree'
import { recoverOrphans } from './orphan-recovery'
import { CircuitBreaker } from './circuit-breaker'
import { handleWatchdogVerdict } from './watchdog-handler'
import { nowIso } from '../../shared/time'

/**
 * AgentSupervisor manages watchdog monitoring, circuit breaking, orphan recovery,
 * and worktree pruning.
 */
export interface AgentSupervisor {
  readonly circuitBreaker: CircuitBreaker

  /**
   * Run watchdog check on all active agents.
   * Kills agents that exceed limits and applies verdict side effects.
   */
  runWatchdog(
    activeAgents: Map<string, ActiveAgent>,
    processingTasks: Set<string>,
    concurrency: ConcurrencyState,
    onTaskTerminal: (taskId: string, status: string) => Promise<void>
  ): Promise<ConcurrencyState>

  /**
   * Run orphan recovery to re-queue abandoned tasks.
   */
  runOrphanRecovery(activeAgents: Map<string, ActiveAgent>): Promise<void>

  /**
   * Run worktree pruning to clean up stale worktrees.
   */
  runWorktreePrune(activeAgents: Map<string, ActiveAgent>): Promise<void>
}

export interface AgentSupervisorDeps {
  repo: ISprintTaskRepository
  config: AgentManagerConfig
  metrics: MetricsCollector
  logger: Logger
}

export class AgentSupervisorImpl implements AgentSupervisor {
  readonly circuitBreaker: CircuitBreaker

  constructor(private readonly deps: AgentSupervisorDeps) {
    this.circuitBreaker = new CircuitBreaker(deps.logger)
  }

  async runWatchdog(
    activeAgents: Map<string, ActiveAgent>,
    processingTasks: Set<string>,
    concurrency: ConcurrencyState,
    onTaskTerminal: (taskId: string, status: string) => Promise<void>
  ): Promise<ConcurrencyState> {
    let updatedConcurrency = concurrency

    // Collect agents to kill before iterating to avoid mutating Map during iteration
    const agentsToKill: Array<{ agent: ActiveAgent; verdict: WatchdogAction }> = []
    for (const agent of activeAgents.values()) {
      if (processingTasks.has(agent.taskId)) continue
      const verdict = checkAgent(agent, Date.now(), this.deps.config)
      if (verdict !== 'ok') {
        agentsToKill.push({ agent, verdict })
      }
    }

    // Process kills
    for (const { agent, verdict } of agentsToKill) {
      this.deps.logger.warn(`[agent-supervisor] Watchdog killing task ${agent.taskId}: ${verdict}`)
      this.deps.metrics.recordWatchdogVerdict(verdict)
      if (verdict === 'rate-limit-loop') {
        this.deps.metrics.increment('retriesQueued')
      }

      try {
        agent.handle.abort()
      } catch (err) {
        this.deps.logger.warn(`[agent-supervisor] Failed to abort agent ${agent.taskId}: ${err}`)
      }

      // Delete agent — activeCount is derived from activeAgents.size
      activeAgents.delete(agent.taskId)

      // Get verdict decision, then apply side effects
      const now = nowIso()
      const maxRuntimeMs = agent.maxRuntimeMs ?? this.deps.config.maxRuntimeMs
      const result = handleWatchdogVerdict(verdict, updatedConcurrency, now, maxRuntimeMs)
      updatedConcurrency = result.concurrency

      if (result.taskUpdate) {
        try {
          this.deps.repo.updateTask(agent.taskId, result.taskUpdate)
        } catch (err) {
          this.deps.logger.warn(
            `[agent-supervisor] Failed to update task ${agent.taskId} after ${verdict}: ${err}`
          )
        }
      }

      if (result.shouldNotifyTerminal && result.terminalStatus) {
        onTaskTerminal(agent.taskId, result.terminalStatus).catch((err) =>
          this.deps.logger.warn(
            `[agent-supervisor] Failed onTerminal for task ${agent.taskId} after ${verdict}: ${err}`
          )
        )
      }
    }

    return updatedConcurrency
  }

  async runOrphanRecovery(activeAgents: Map<string, ActiveAgent>): Promise<void> {
    try {
      await recoverOrphans((id: string) => activeAgents.has(id), this.deps.repo, this.deps.logger)
    } catch (err) {
      this.deps.logger.error(`[agent-supervisor] Orphan recovery error: ${err}`)
    }
  }

  async runWorktreePrune(activeAgents: Map<string, ActiveAgent>): Promise<void> {
    const isReviewTask = (taskId: string): boolean => {
      try {
        const task = this.deps.repo.getTask(taskId)
        return task?.status === 'review'
      } catch {
        return false
      }
    }

    try {
      await pruneStaleWorktrees(
        this.deps.config.worktreeBase,
        (id: string) => activeAgents.has(id),
        this.deps.logger,
        isReviewTask
      )
    } catch (err) {
      this.deps.logger.error(`[agent-supervisor] Worktree prune error: ${err}`)
    }
  }
}

export function createAgentSupervisor(deps: AgentSupervisorDeps): AgentSupervisor {
  return new AgentSupervisorImpl(deps)
}

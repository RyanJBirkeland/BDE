import type { Logger } from '../logger'
import type { ActiveAgent, AgentManagerConfig } from './types'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { RunAgentDeps, RunAgentTask } from './run-agent'
import type { ConcurrencyState } from './concurrency'
import type { MetricsCollector } from './metrics'
import type { DependencyResolver } from './dependency-resolver'
import type { AgentSupervisor } from './agent-supervisor'
import { runAgent as _runAgent } from './run-agent'
import { availableSlots, tryRecover } from './concurrency'
import { setupWorktree } from './worktree'
import { checkOAuthToken } from './oauth-checker'
import { getRepoPaths } from '../paths'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { EXECUTOR_ID, NOTES_MAX_LENGTH } from './types'
import { formatBlockedNote } from '../services/dependency-service'

/**
 * TaskScheduler manages the drain loop, task selection, claiming, and spawning.
 */
export interface TaskScheduler {
  /**
   * Run one iteration of the drain loop.
   * Fetches queued tasks, checks dependencies, claims tasks, and spawns agents.
   */
  runDrain(
    shuttingDown: boolean,
    activeAgents: Map<string, ActiveAgent>,
    processingTasks: Set<string>,
    agentPromises: Set<Promise<void>>,
    concurrency: ConcurrencyState,
    onTaskTerminal: (taskId: string, status: string) => Promise<void>
  ): Promise<ConcurrencyState>

  // Internal methods exposed for testing
  processQueuedTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>,
    processingTasks: Set<string>,
    agentPromises: Set<Promise<void>>,
    onTaskTerminal: (taskId: string, status: string) => Promise<void>
  ): Promise<void>

  mapQueuedTask(raw: Record<string, unknown>): {
    id: string
    title: string
    prompt: string | null
    spec: string | null
    repo: string
    retry_count: number
    fast_fail_count: number
    notes: string | null
    playground_enabled: boolean
    max_runtime_ms: number | null
    max_cost_usd: number | null
    model: string | null
    group_id: string | null
  } | null

  checkAndBlockDeps(
    taskId: string,
    rawDeps: unknown,
    taskStatusMap: Map<string, string>
  ): boolean
}

export interface TaskSchedulerDeps {
  repo: ISprintTaskRepository
  config: AgentManagerConfig
  runAgentDeps: RunAgentDeps
  dependencyResolver: DependencyResolver
  supervisor: AgentSupervisor
  metrics: MetricsCollector
  logger: Logger
}

export class TaskSchedulerImpl implements TaskScheduler {
  constructor(private readonly deps: TaskSchedulerDeps) {}

  async runDrain(
    shuttingDown: boolean,
    activeAgents: Map<string, ActiveAgent>,
    processingTasks: Set<string>,
    agentPromises: Set<Promise<void>>,
    concurrency: ConcurrencyState,
    onTaskTerminal: (taskId: string, status: string) => Promise<void>
  ): Promise<ConcurrencyState> {
    let updatedConcurrency = concurrency

    this.deps.logger.info(
      `[task-scheduler] Drain loop starting (shuttingDown=${shuttingDown}, slots=${availableSlots(updatedConcurrency, activeAgents.size)})`
    )

    if (shuttingDown) return updatedConcurrency

    if (this.deps.supervisor.circuitBreaker.isOpen()) {
      this.deps.logger.warn(
        `[task-scheduler] Skipping drain — circuit breaker open until ${new Date(
          this.deps.supervisor.circuitBreaker.openUntilTimestamp
        ).toISOString()}`
      )
      return updatedConcurrency
    }

    this.deps.metrics.increment('drainLoopCount')
    const drainStart = Date.now()

    // Incrementally update dependency index
    const taskStatusMap = this.deps.dependencyResolver.updateIndexes()

    const available = availableSlots(updatedConcurrency, activeAgents.size)
    if (available <= 0) return updatedConcurrency

    try {
      const tokenOk = await checkOAuthToken(this.deps.logger)
      if (!tokenOk) return updatedConcurrency

      this.deps.logger.info(`[task-scheduler] Fetching queued tasks (limit=${available})...`)
      const queued = this.fetchQueuedTasks(available)
      this.deps.logger.info(`[task-scheduler] Found ${queued.length} queued tasks`)

      for (const raw of queued) {
        if (shuttingDown) break

        // Re-check slots before each task — an earlier iteration may have filled a slot
        if (availableSlots(updatedConcurrency, activeAgents.size) <= 0) {
          this.deps.logger.info('[task-scheduler] No slots available — stopping drain iteration')
          break
        }

        try {
          await this.processQueuedTask(
            raw,
            taskStatusMap,
            processingTasks,
            agentPromises,
            onTaskTerminal
          )
        } catch (err) {
          this.deps.logger.error(
            `[task-scheduler] Failed to process task ${(raw as Record<string, unknown>).id}: ${err}`
          )
        }
      }
    } catch (err) {
      this.deps.logger.error(`[task-scheduler] Drain loop error: ${err}`)
    }

    this.deps.metrics.setLastDrainDuration(Date.now() - drainStart)
    updatedConcurrency = tryRecover(updatedConcurrency, Date.now())

    return updatedConcurrency
  }

  fetchQueuedTasks(limit: number): Array<Record<string, unknown>> {
    return this.deps.repo.getQueuedTasks(limit) as unknown as Array<Record<string, unknown>>
  }

  claimTask(taskId: string): boolean {
    return this.deps.repo.claimTask(taskId, EXECUTOR_ID) !== null
  }

  resolveRepoPath(repoSlug: string): string | null {
    const repoPaths = getRepoPaths()
    return repoPaths[repoSlug.toLowerCase()] ?? null
  }

  async processQueuedTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>,
    processingTasks: Set<string>,
    agentPromises: Set<Promise<void>>,
    onTaskTerminal: (taskId: string, status: string) => Promise<void>
  ): Promise<void> {
    const taskId = raw.id as string
    if (processingTasks.has(taskId)) return
    processingTasks.add(taskId)

    try {
      const task = this.mapQueuedTask(raw)
      if (!task) return // Skip tasks with invalid fields

      const rawDeps = raw.dependsOn ?? raw.depends_on
      if (rawDeps && this.checkAndBlockDeps(task.id, rawDeps, taskStatusMap)) return

      const repoPath = this.resolveRepoPath(task.repo)
      if (!repoPath) {
        this.deps.logger.warn(
          `[task-scheduler] No repo path for "${task.repo}" — setting task ${task.id} to error`
        )
        try {
          this.deps.repo.updateTask(task.id, {
            status: 'error',
            notes: `Repo "${task.repo}" is not configured in BDE settings. Add it in Settings > Repos, then reset this task to queued.`,
            claimed_by: null
          })
        } catch (err) {
          this.deps.logger.warn(
            `[task-scheduler] Failed to update task ${task.id} after repo resolution failure: ${err}`
          )
        }
        await onTaskTerminal(task.id, 'error').catch((err) =>
          this.deps.logger.warn(`[task-scheduler] onTerminal failed for ${task.id}: ${err}`)
        )
        return
      }

      const claimed = this.claimTask(task.id)
      if (!claimed) {
        this.deps.logger.info(`[task-scheduler] Task ${task.id} already claimed — skipping`)
        return
      }

      // Refresh snapshot: re-fetch statuses of tasks that may have changed
      try {
        const freshTasks = this.deps.repo.getTasksWithDependencies()
        taskStatusMap.clear()
        for (const t of freshTasks) {
          taskStatusMap.set(t.id, t.status)
        }
      } catch {
        // non-fatal: stale map is better than aborting the drain
      }

      let wt: { worktreePath: string; branch: string }
      try {
        wt = await setupWorktree({
          repoPath,
          worktreeBase: this.deps.config.worktreeBase,
          taskId: task.id,
          title: task.title,
          groupId: task.group_id ?? undefined,
          logger: this.deps.logger
        })
      } catch (err) {
        const errMsg = getErrorMessage(err)
        this.deps.logger.error(
          `[task-scheduler] setupWorktree failed for task ${task.id}: ${errMsg}`
        )
        const fullNote = `Worktree setup failed: ${errMsg}`
        const notes =
          fullNote.length > NOTES_MAX_LENGTH
            ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3))
            : fullNote
        this.deps.repo.updateTask(task.id, {
          status: 'error',
          completed_at: nowIso(),
          notes,
          claimed_by: null
        })
        await onTaskTerminal(task.id, 'error').catch((err) =>
          this.deps.logger.warn(`[task-scheduler] onTerminal failed for ${task.id}: ${err}`)
        )
        return
      }

      this.spawnAgent(task, wt, repoPath, agentPromises)
    } finally {
      processingTasks.delete(taskId)
    }
  }

  spawnAgent(
    task: RunAgentTask,
    wt: { worktreePath: string; branch: string },
    repoPath: string,
    agentPromises: Set<Promise<void>>
  ): void {
    this.deps.metrics.increment('agentsSpawned')
    const p = _runAgent(task, wt, repoPath, this.deps.runAgentDeps)
      .catch((err) => {
        this.deps.logger.error(`[task-scheduler] runAgent failed for task ${task.id}: ${err}`)
      })
      .finally(() => {
        agentPromises.delete(p)
      })
    agentPromises.add(p)
  }

  mapQueuedTask(raw: Record<string, unknown>): {
    id: string
    title: string
    prompt: string | null
    spec: string | null
    repo: string
    retry_count: number
    fast_fail_count: number
    notes: string | null
    playground_enabled: boolean
    max_runtime_ms: number | null
    max_cost_usd: number | null
    model: string | null
    group_id: string | null
  } | null {
    // Validate required fields
    if (!raw.id || typeof raw.id !== 'string') {
      this.deps.logger.warn(
        `[task-scheduler] Task missing or invalid 'id' field: ${JSON.stringify(raw)}`
      )
      return null
    }
    if (!raw.title || typeof raw.title !== 'string') {
      this.deps.logger.warn(`[task-scheduler] Task ${raw.id} missing or invalid 'title' field`)
      return null
    }
    if (!raw.repo || typeof raw.repo !== 'string') {
      this.deps.logger.warn(`[task-scheduler] Task ${raw.id} missing or invalid 'repo' field`)
      return null
    }

    return {
      id: raw.id,
      title: raw.title,
      prompt: (raw.prompt as string) ?? null,
      spec: (raw.spec as string) ?? null,
      repo: raw.repo,
      retry_count: Number(raw.retry_count) || 0,
      fast_fail_count: Number(raw.fast_fail_count) || 0,
      notes: (raw.notes as string) ?? null,
      playground_enabled: Boolean(raw.playground_enabled),
      max_runtime_ms: Number(raw.max_runtime_ms) || null,
      max_cost_usd: Number(raw.max_cost_usd) || null,
      model: (raw.model as string) ?? null,
      group_id: (raw.group_id as string) ?? null
    }
  }

  checkAndBlockDeps(
    taskId: string,
    rawDeps: unknown,
    taskStatusMap: Map<string, string>
  ): boolean {
    try {
      const deps = typeof rawDeps === 'string' ? JSON.parse(rawDeps) : rawDeps
      if (Array.isArray(deps) && deps.length > 0) {
        const { satisfied, blockedBy } =
          this.deps.dependencyResolver.depIndex.areDependenciesSatisfied(
            taskId,
            deps,
            (depId: string) => taskStatusMap.get(depId)
          )
        if (!satisfied) {
          this.deps.logger.info(
            `[task-scheduler] Task ${taskId} has unsatisfied deps [${blockedBy.join(', ')}] — auto-blocking`
          )
          try {
            this.deps.repo.updateTask(taskId, {
              status: 'blocked',
              notes: formatBlockedNote(blockedBy),
              claimed_by: null
            })
          } catch (err) {
            this.deps.logger.warn(
              `[task-scheduler] Failed to block task ${taskId} with unsatisfied deps: ${err}`
            )
          }
          return true
        }
      }
    } catch (err) {
      // If dep parsing fails, set task to error instead of silently proceeding
      this.deps.logger.error(`[task-scheduler] Task ${taskId} has malformed depends_on data: ${err}`)
      try {
        this.deps.repo.updateTask(taskId, {
          status: 'error',
          notes: 'Malformed depends_on field - cannot validate dependencies',
          claimed_by: null
        })
      } catch (updateErr) {
        this.deps.logger.warn(
          `[task-scheduler] Failed to update task ${taskId} after dep parse error: ${updateErr}`
        )
      }
      return true // Block the task
    }
    return false
  }
}

export function createTaskScheduler(deps: TaskSchedulerDeps): TaskScheduler {
  return new TaskSchedulerImpl(deps)
}

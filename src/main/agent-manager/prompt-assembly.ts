/**
 * Task validation and prompt context preparation.
 *
 * Validates that a task has executable content, fetches upstream context
 * from dependencies, reads the prior scratchpad, and assembles the full
 * agent prompt string.
 */
import type { Logger } from '../logger'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { RunAgentTask, RunAgentDeps } from './run-agent'
import { cleanupWorktree } from './worktree'
import { buildAgentPrompt } from '../lib/prompt-composer'
import { BDE_TASK_MEMORY_DIR } from '../paths'
import { nowIso } from '../../shared/time'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskDependency } from '../../shared/types'

/**
 * Logs a worktree cleanup warning with consistent format.
 */
function logCleanupWarning(
  taskId: string,
  worktreePath: string,
  err: unknown,
  logger: Logger
): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  logger.warn(
    `[agent-manager] Stale worktree for task ${taskId} at ${worktreePath} — manual cleanup needed: ${detail}`
  )
}

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
      logCleanupWarning(task.id, worktree.worktreePath, cleanupErr, logger)
    }
    throw new Error('Task has no content')
  }
}

/**
 * Fetches upstream task specs for context propagation.
 * Iterates declared dependencies, resolves each done task's spec,
 * and returns an array of context entries for the agent prompt.
 */
export function fetchUpstreamContext(
  deps: TaskDependency[] | null | undefined,
  repo: IAgentTaskRepository,
  logger: Logger
): Array<{ title: string; spec: string; partial_diff?: string }> {
  const upstreamContext: Array<{ title: string; spec: string; partial_diff?: string }> = []
  if (!deps || deps.length === 0) return upstreamContext
  for (const dep of deps) {
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
  return upstreamContext
}

/**
 * Creates the task scratchpad directory (idempotent) and reads any prior
 * progress.md content. Returns an empty string on first run.
 */
export function readPriorScratchpad(taskId: string): string {
  const scratchpadDir = join(BDE_TASK_MEMORY_DIR, taskId)
  mkdirSync(scratchpadDir, { recursive: true })
  try {
    return readFileSync(join(scratchpadDir, 'progress.md'), 'utf-8')
  } catch {
    // Expected on first run
    return ''
  }
}

/**
 * Assembles the full run context for an agent: upstream context, prior scratchpad,
 * and the built prompt. No task mutations, no callbacks.
 */
export async function assembleRunContext(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  deps: RunAgentDeps
): Promise<string> {
  const { logger, repo } = deps
  const taskContent = (task.prompt || task.spec || task.title || '').trim()
  const upstreamContext = fetchUpstreamContext(task.depends_on, repo, logger)
  const priorScratchpad = readPriorScratchpad(task.id)

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


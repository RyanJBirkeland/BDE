/**
 * Adhoc promotion service — validates and promotes a completed adhoc agent
 * worktree into the Code Review queue as a sprint task.
 */
import { existsSync } from 'node:fs'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { createLogger } from '../logger'
import { createReviewTaskFromAdhoc } from './sprint-service'
import type { AgentMeta } from '../agent-history'

const log = createLogger('adhoc-promotion-service')

export interface PromoteAdhocParams {
  agentId: string
  agent: AgentMeta
}

export interface PromoteAdhocResult {
  ok: boolean
  taskId?: string
  error?: string
}

/**
 * Derive a display title from the agent's freeform task text.
 * Takes the first non-blank line, capped at 120 characters.
 */
function deriveTitleFromTask(taskText: string): string {
  const firstLine =
    taskText
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? 'Promoted adhoc agent'
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine
}

/**
 * Verify the worktree has at least one commit beyond main.
 * Returns false if there are no commits to review; returns true on error
 * so the review UI can handle empty diffs itself.
 */
async function hasCommitsBeyondMain(worktreePath: string, branch: string): Promise<boolean> {
  const env = buildAgentEnv()
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', `origin/main..${branch}`],
      { cwd: worktreePath, env }
    )
    const commitCount = parseInt(stdout.trim(), 10)
    return Number.isFinite(commitCount) && commitCount > 0
  } catch (err) {
    log.warn(`[adhoc-promotion] commit count check failed: ${err}`)
    // Non-fatal — proceed anyway; the review UI will handle empty diffs
    return true
  }
}

/**
 * Validate agent preconditions and promote the adhoc worktree to a
 * sprint task in `review` status.
 */
export async function promoteAdhocToTask(
  agentId: string,
  agent: AgentMeta
): Promise<PromoteAdhocResult> {
  if (!agent.worktreePath) {
    return {
      ok: false,
      error:
        'Agent has no worktree — only adhoc agents spawned with worktree support can be promoted'
    }
  }

  if (!existsSync(agent.worktreePath)) {
    return { ok: false, error: `Worktree no longer exists at ${agent.worktreePath}` }
  }

  if (!agent.branch) {
    return { ok: false, error: 'Agent has no branch recorded' }
  }

  const hasWork = await hasCommitsBeyondMain(agent.worktreePath, agent.branch)
  if (!hasWork) {
    return {
      ok: false,
      error: 'Agent has not committed any work yet — nothing to promote'
    }
  }

  const title = deriveTitleFromTask(agent.task)

  const task = createReviewTaskFromAdhoc({
    title,
    repo: agent.repo,
    spec: agent.task,
    worktreePath: agent.worktreePath,
    branch: agent.branch
  })

  if (!task) {
    return { ok: false, error: 'Failed to create review task — see logs' }
  }

  log.info(`[adhoc-promotion] Promoted agent ${agentId} → sprint task ${task.id}`)
  return { ok: true, taskId: task.id }
}

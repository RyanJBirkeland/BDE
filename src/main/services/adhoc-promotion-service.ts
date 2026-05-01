/**
 * Adhoc promotion service — validates and promotes a completed adhoc agent
 * worktree into the Code Review queue as a sprint task.
 */
import { existsSync } from 'node:fs'
import { execFileAsync } from '../lib/async-utils'
import { resolveDefaultBranch } from '../lib/default-branch'
import { buildAgentEnv } from '../env-utils'
import { createLogger } from '../logger'
import { createReviewTaskFromAdhoc } from './sprint-service'
import { getAgentMeta, setAgentSprintTaskId } from '../agent-history'

const log = createLogger('adhoc-promotion-service')

export interface PromoteAdhocOptions {
  autoCommitIfDirty?: boolean
  trigger?: 'close' | 'button' | 'tool'
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
 * Verify the worktree has at least one commit beyond the repo's default branch.
 * Returns false if there are no commits to review; returns true on error
 * so the review UI can handle empty diffs itself.
 */
async function hasCommitsBeyondMain(worktreePath: string, branch: string): Promise<boolean> {
  const env = buildAgentEnv()
  try {
    const defaultBranch = await resolveDefaultBranch(worktreePath)
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', `origin/${defaultBranch}..${branch}`],
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

async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const env = buildAgentEnv()
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    env
  })
  return stdout.trim().length > 0
}

async function commitAllChanges(worktreePath: string): Promise<void> {
  const env = buildAgentEnv()
  await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, env })
  await execFileAsync('git', ['commit', '-m', 'chore: capture uncommitted work on session close'], {
    cwd: worktreePath,
    env
  })
}

/**
 * Validate agent preconditions and promote the adhoc worktree to a
 * sprint task in `review` status.
 *
 * Idempotent: if the agent was already promoted (`sprintTaskId` set),
 * returns the existing task id without creating a duplicate.
 */
export async function promoteAdhocToTask(
  agentId: string,
  options: PromoteAdhocOptions = {}
): Promise<PromoteAdhocResult> {
  const agent = await getAgentMeta(agentId)
  if (!agent) {
    return { ok: false, error: `Agent ${agentId} not found` }
  }

  if (agent.sprintTaskId) {
    return { ok: true, taskId: agent.sprintTaskId }
  }

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

  let hasWork = await hasCommitsBeyondMain(agent.worktreePath, agent.branch)
  if (!hasWork && options.autoCommitIfDirty) {
    try {
      const dirty = await isWorktreeDirty(agent.worktreePath)
      if (!dirty) {
        return { ok: false, error: 'Agent has not committed any work yet — nothing to promote' }
      }
      await commitAllChanges(agent.worktreePath)
      hasWork = await hasCommitsBeyondMain(agent.worktreePath, agent.branch)
    } catch (err) {
      return {
        ok: false,
        error: `Auto-commit failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
  if (!hasWork) {
    return {
      ok: false,
      error: 'Agent has not committed any work yet — nothing to promote'
    }
  }

  const title = deriveTitleFromTask(agent.task)

  const task = await createReviewTaskFromAdhoc({
    title,
    repo: agent.repo,
    spec: agent.task,
    worktreePath: agent.worktreePath,
    branch: agent.branch
  })

  if (!task) {
    return { ok: false, error: 'Failed to create review task — see logs' }
  }

  setAgentSprintTaskId(agentId, task.id)
  log.info(
    `[adhoc-promotion] Promoted agent ${agentId} → sprint task ${task.id} (trigger=${options.trigger ?? 'button'})`
  )
  return { ok: true, taskId: task.id }
}

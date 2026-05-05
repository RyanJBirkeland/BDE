/**
 * PR group build service — git operations + PR creation engine for PR groups.
 *
 * Handles building a GitHub PR from a PR group. For 1-task groups, pushes the
 * existing task branch and creates a PR directly. For 2+ task groups, squash-
 * merges each task branch (in topological dep order) into a rollup branch,
 * then creates one PR covering all tasks.
 *
 * All tasks in the group must be in `approved` status with a preserved worktree.
 * Group status transitions: composing → building → open (or back to composing
 * on failure).
 */
import { join } from 'path'
import { randomBytes } from 'crypto'
import { execFileAsync } from '../lib/async-utils'
import { createLogger } from '../logger'
import { validateGitRef, getWorktreeBase } from '../lib/review-paths'
import { sanitizeForGit, createNewPr } from '../agent-manager/pr-operations'
import { GIT_EXEC_TIMEOUT_MS } from '../agent-manager/worktree-lifecycle'
import { getRepoConfig, getGhRepo } from '../paths'
import { getTask, notifySprintMutation } from './sprint-service'
import { getErrorMessage } from '../../shared/errors'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { SprintTask } from '../../shared/types/task-types'
import type { PrGroup } from '../../shared/types/task-types'
import { getPrGroup, updatePrGroup } from '../data/pr-group-queries'
import { buildAgentEnv } from '../env-utils'

const logger = createLogger('pr-group-build')

// ============================================================================
// Public interface
// ============================================================================

export type BuildGroupResult =
  | { success: true; prUrl: string; prNumber: number }
  | { success: false; error: string; conflictingFiles?: string[] | undefined }

export interface DryRunConflictResult {
  hasConflicts: boolean
  conflictingFiles: string[]
}

export interface PrGroupBuildService {
  buildGroup(groupId: string): Promise<BuildGroupResult>
  checkConflicts(groupId: string): Promise<DryRunConflictResult>
}

export function createPrGroupBuildService(repo: ISprintTaskRepository): PrGroupBuildService {
  return {
    buildGroup: (groupId) => buildGroup(groupId, repo),
    checkConflicts: (groupId) => checkGroupConflicts(groupId),
  }
}

// ============================================================================
// Build orchestration
// ============================================================================

async function buildGroup(groupId: string, repo: ISprintTaskRepository): Promise<BuildGroupResult> {
  const group = getPrGroup(groupId)
  if (!group) return { success: false, error: `PR group ${groupId} not found` }
  if (group.status !== 'composing') return { success: false, error: `Group is already ${group.status}` }
  if (group.task_order.length === 0) return { success: false, error: 'No tasks in group' }

  const tasks = loadApprovedGroupTasks(group.task_order)
  const repoName = tasks[0]!.repo
  const repoConfig = getRepoConfig(repoName)
  if (!repoConfig) return { success: false, error: `Repository "${repoName}" is not configured` }

  const ghRepo = getGhRepo(repoName)
  if (!ghRepo) return { success: false, error: `GitHub owner/repo not configured for "${repoName}"` }

  validateGitRef(group.branch_name)
  const env = buildAgentEnv()

  updatePrGroup(groupId, { status: 'building' })

  try {
    const ordered = topoSort(tasks)

    if (ordered.length === 1) {
      return await buildSingleTaskPr(ordered[0]!, group, ghRepo, env, repo, groupId)
    } else {
      return await buildRollupPr(ordered, group, repoConfig.localPath, ghRepo, env, repo, groupId)
    }
  } catch (err) {
    updatePrGroup(groupId, { status: 'composing' })
    return { success: false, error: getErrorMessage(err) }
  }
}

// ============================================================================
// Single-task PR path
// ============================================================================

async function buildSingleTaskPr(
  task: SprintTask,
  group: PrGroup,
  ghRepo: string,
  env: NodeJS.ProcessEnv,
  repo: ISprintTaskRepository,
  groupId: string
): Promise<BuildGroupResult> {
  const branch = await currentBranch(task.worktree_path!, env)
  await execFileAsync('git', ['push', '-u', 'origin', branch], {
    cwd: task.worktree_path!,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS,
  })

  const title = group.title || sanitizeForGit(task.title)
  const body = group.description ?? buildSingleTaskPrBody(task)
  const { prUrl, prNumber } = await createNewPr(task.worktree_path!, branch, title, ghRepo, env, logger, body)

  if (!prUrl || prNumber == null) {
    updatePrGroup(groupId, { status: 'composing' })
    return { success: false, error: 'PR creation failed — no URL returned' }
  }

  await updateTaskPrFields([task], prNumber, prUrl, repo)
  updatePrGroup(groupId, { status: 'open', prNumber, prUrl })
  logger.info(`[pr-group] built single-task PR ${prUrl} for group ${groupId}`)
  return { success: true, prUrl, prNumber }
}

// ============================================================================
// Rollup PR path (2+ tasks)
// ============================================================================

async function buildRollupPr(
  ordered: SprintTask[],
  group: PrGroup,
  repoPath: string,
  ghRepo: string,
  env: NodeJS.ProcessEnv,
  repo: ISprintTaskRepository,
  groupId: string
): Promise<BuildGroupResult> {
  await fetchOriginMain(repoPath, env)
  const rollupPath = join(getWorktreeBase(), 'rollup', randomBytes(4).toString('hex'))
  await createRollupWorktree(repoPath, group.branch_name, rollupPath, env)

  try {
    const mergeResult = await squashMergeTasks(rollupPath, ordered, env)
    if (!mergeResult.success) {
      updatePrGroup(groupId, { status: 'composing' })
      return { success: false, error: mergeResult.error, conflictingFiles: mergeResult.conflictingFiles }
    }

    await execFileAsync('git', ['push', '-u', 'origin', group.branch_name], {
      cwd: rollupPath,
      env,
      timeout: GIT_EXEC_TIMEOUT_MS,
    })

    const body = group.description ?? buildRollupPrBody(ordered)
    const { prUrl, prNumber } = await createNewPr(rollupPath, group.branch_name, group.title, ghRepo, env, logger, body)

    if (!prUrl || prNumber == null) {
      updatePrGroup(groupId, { status: 'composing' })
      return { success: false, error: 'PR creation failed — no URL returned' }
    }

    await updateTaskPrFields(ordered, prNumber, prUrl, repo)
    updatePrGroup(groupId, { status: 'open', prNumber, prUrl })
    logger.info(`[pr-group] built rollup PR ${prUrl} for group ${groupId} (${ordered.length} tasks)`)
    return { success: true, prUrl, prNumber }
  } finally {
    await cleanupWorktree(repoPath, rollupPath, group.branch_name, env)
  }
}

// ============================================================================
// Dry-run conflict check
// ============================================================================

async function checkGroupConflicts(groupId: string): Promise<DryRunConflictResult> {
  const group = getPrGroup(groupId)
  if (!group || group.task_order.length < 2) return { hasConflicts: false, conflictingFiles: [] }

  const tasks = loadApprovedGroupTasks(group.task_order)
  const ordered = topoSort(tasks)
  const repoName = ordered[0]!.repo
  const repoConfig = getRepoConfig(repoName)
  if (!repoConfig) return { hasConflicts: false, conflictingFiles: [] }

  const env = buildAgentEnv()
  const repoPath = repoConfig.localPath
  const dryRunBranch = `dry-run-${randomBytes(4).toString('hex')}`
  const rollupPath = join(getWorktreeBase(), 'rollup-dry', randomBytes(4).toString('hex'))

  await fetchOriginMain(repoPath, env)
  await createRollupWorktree(repoPath, dryRunBranch, rollupPath, env)

  try {
    for (const task of ordered) {
      const branch = await currentBranch(task.worktree_path!, env)
      try {
        await execFileAsync('git', ['merge', '--no-commit', '--no-ff', branch], {
          cwd: rollupPath,
          env,
          timeout: GIT_EXEC_TIMEOUT_MS,
        })
        // Successful dry-merge: reset and continue to the next task
        await execFileAsync('git', ['merge', '--abort'], { cwd: rollupPath, env, timeout: GIT_EXEC_TIMEOUT_MS }).catch(() => {})
        await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: rollupPath, env, timeout: GIT_EXEC_TIMEOUT_MS })
      } catch {
        const conflictingFiles = await extractConflictFiles(rollupPath, env)
        await execFileAsync('git', ['merge', '--abort'], { cwd: rollupPath, env, timeout: GIT_EXEC_TIMEOUT_MS }).catch(() => {})
        return { hasConflicts: true, conflictingFiles }
      }
    }
    return { hasConflicts: false, conflictingFiles: [] }
  } finally {
    await cleanupWorktree(repoPath, rollupPath, dryRunBranch, env).catch(() => {})
  }
}

// ============================================================================
// Git helpers
// ============================================================================

async function fetchOriginMain(repoPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync('git', ['fetch', 'origin', 'main'], {
    cwd: repoPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS,
  })
}

async function createRollupWorktree(
  repoPath: string,
  branchName: string,
  path: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFileAsync('git', ['worktree', 'add', '-b', branchName, path, 'origin/main'], {
    cwd: repoPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS,
  })
}

async function currentBranch(worktreePath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
    cwd: worktreePath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS,
  })
  const branch = stdout.trim()
  if (!branch) throw new Error(`Could not determine branch for worktree at ${worktreePath}`)
  return branch
}

interface SquashSuccess { success: true }
interface SquashFailure { success: false; error: string; conflictingFiles: string[] }

async function squashMergeTasks(
  rollupPath: string,
  tasks: SprintTask[],
  env: NodeJS.ProcessEnv
): Promise<SquashSuccess | SquashFailure> {
  for (const task of tasks) {
    const branch = await currentBranch(task.worktree_path!, env)
    try {
      await execFileAsync('git', ['merge', '--squash', branch], {
        cwd: rollupPath,
        env,
        timeout: GIT_EXEC_TIMEOUT_MS,
      })
    } catch {
      const conflictingFiles = await extractConflictFiles(rollupPath, env)
      await execFileAsync('git', ['merge', '--abort'], {
        cwd: rollupPath,
        env,
        timeout: GIT_EXEC_TIMEOUT_MS,
      }).catch(() => {})
      return { success: false, error: `Merge conflict in task "${task.title}"`, conflictingFiles }
    }
    await execFileAsync(
      'git',
      ['commit', '-m', `feat: ${sanitizeForGit(task.title)} (#${task.id.slice(0, 8)})`],
      { cwd: rollupPath, env, timeout: GIT_EXEC_TIMEOUT_MS }
    )
  }
  return { success: true }
}

async function extractConflictFiles(path: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', '--diff-filter=U'],
      { cwd: path, env, timeout: GIT_EXEC_TIMEOUT_MS }
    )
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function cleanupWorktree(
  repoPath: string,
  path: string,
  branch: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFileAsync('git', ['worktree', 'remove', '--force', path], {
    cwd: repoPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS,
  }).catch((err) => {
    logger.warn(`[pr-group] cleanup worktree: ${getErrorMessage(err)}`)
  })
  await execFileAsync('git', ['branch', '-D', branch], {
    cwd: repoPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS,
  }).catch(() => {})
}

// ============================================================================
// Task helpers
// ============================================================================

function loadApprovedGroupTasks(taskIds: string[]): SprintTask[] {
  return taskIds.map((id) => {
    const task = getTask(id)
    if (!task) throw new Error(`Task ${id} not found`)
    if (task.status !== 'approved') throw new Error(`Task "${task.title}" is not in approved status`)
    if (!task.worktree_path) throw new Error(`Task "${task.title}" has no worktree`)
    return task
  })
}

async function updateTaskPrFields(
  tasks: SprintTask[],
  prNumber: number,
  prUrl: string,
  repo: ISprintTaskRepository
): Promise<void> {
  await Promise.all(
    tasks.map(async (task) => {
      const updated = await repo.updateTask(
        task.id,
        { pr_number: prNumber, pr_url: prUrl, pr_status: 'open' },
        { caller: 'pr-group-build' }
      )
      if (updated) notifySprintMutation('updated', updated)
    })
  )
}

function buildSingleTaskPrBody(task: SprintTask): string {
  return (task.spec ?? task.prompt ?? `## Summary\n\n${sanitizeForGit(task.title)}`).slice(0, 4000)
}

function buildRollupPrBody(tasks: SprintTask[]): string {
  const taskList = tasks
    .map((t) => `- **${sanitizeForGit(t.title)}** (\`${t.id.slice(0, 8)}\`)`)
    .join('\n')
  return `## Bundled Tasks\n\n${taskList}\n\n🤖 PR built by FLEET`
}

// ============================================================================
// Topological sort (exported for testing)
// ============================================================================

/**
 * Orders tasks so each task appears after its in-group dependencies.
 * Tasks with no inter-group dependencies preserve their input order.
 * Uses Kahn's algorithm (BFS). Cycles (prevented at creation time) are
 * appended in original order as a safety fallback.
 */
export function topoSort(tasks: SprintTask[]): SprintTask[] {
  const idSet = new Set(tasks.map((t) => t.id))
  const indexById = new Map(tasks.map((t, i) => [t.id, i]))
  const inDegree = new Map(tasks.map((t) => [t.id, 0]))
  const successors = new Map(tasks.map((t) => [t.id, [] as string[]]))

  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      if (idSet.has(dep.id)) {
        successors.get(dep.id)!.push(task.id)
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
      }
    }
  }

  const queue = tasks
    .filter((t) => inDegree.get(t.id) === 0)
    .sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0))

  const result: SprintTask[] = []
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  while (queue.length > 0) {
    const task = queue.shift()!
    result.push(task)
    for (const nextId of successors.get(task.id) ?? []) {
      const deg = (inDegree.get(nextId) ?? 1) - 1
      inDegree.set(nextId, deg)
      if (deg === 0) queue.push(taskById.get(nextId)!)
    }
  }

  // Append any tasks in a cycle (creation-time detection prevents this in
  // practice) so the caller at least gets all tasks back in some order.
  if (result.length < tasks.length) {
    const resultIds = new Set(result.map((t) => t.id))
    tasks.filter((t) => !resultIds.has(t.id)).forEach((t) => result.push(t))
  }

  return result
}

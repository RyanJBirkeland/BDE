/**
 * Review rollup service — bundles multiple review tasks into a single PR.
 *
 * Creates a temporary worktree from origin/main, squash-merges each task
 * branch in topological dep order, pushes the rollup branch, and opens one
 * GitHub PR. All bundled tasks receive pr_number/pr_url/pr_status='open' so
 * the Sprint PR Poller transitions them all to done when that single PR merges.
 *
 * Git strategy: squash-per-task (each task collapses to one commit). On merge
 * conflict the operation aborts and returns the conflicting files — no partial
 * state is committed.
 *
 * Use `createReviewRollupService(repo)` at the composition root.
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

const logger = createLogger('review-rollup')

// ============================================================================
// Public interface
// ============================================================================

export interface BuildRollupPrInput {
  taskIds: string[]
  branchName: string
  prTitle: string
  prBody?: string | undefined
  env: NodeJS.ProcessEnv
}

export type BuildRollupPrResult =
  | { success: true; prUrl: string; prNumber: number }
  | { success: false; error: string; conflictingFiles?: string[] | undefined }

export interface ReviewRollupService {
  buildRollupPr(input: BuildRollupPrInput): Promise<BuildRollupPrResult>
}

export function createReviewRollupService(repo: ISprintTaskRepository): ReviewRollupService {
  return { buildRollupPr: (input) => buildRollupPrWithRepo(input, repo) }
}

// ============================================================================
// Internal implementation
// ============================================================================

async function buildRollupPrWithRepo(
  input: BuildRollupPrInput,
  repo: ISprintTaskRepository
): Promise<BuildRollupPrResult> {
  const { taskIds, branchName, prTitle, prBody, env } = input

  if (taskIds.length === 0) return { success: false, error: 'No tasks selected' }

  validateGitRef(branchName)

  const tasks = loadTasksOrThrow(taskIds)
  const repoName = requireCommonRepo(tasks)
  const repoConfig = getRepoConfig(repoName)
  if (!repoConfig) return { success: false, error: `Repository "${repoName}" is not configured` }

  const ghRepo = getGhRepo(repoName)
  if (!ghRepo) {
    return {
      success: false,
      error: `GitHub owner/repo not configured for "${repoName}". Set githubOwner and githubRepo in Settings → Repositories.`
    }
  }

  const ordered = topoSort(tasks)
  const branches = await resolveTaskBranches(ordered, env)

  const rollupPath = join(getWorktreeBase(), 'rollup', randomBytes(4).toString('hex'))
  const repoPath = repoConfig.localPath

  await fetchOriginMain(repoPath, env)
  await createRollupWorktree(repoPath, branchName, rollupPath, env)

  try {
    const mergeResult = await squashMergeBranches(rollupPath, ordered, branches, env)
    if (!mergeResult.success) {
      return { success: false, error: mergeResult.error, conflictingFiles: mergeResult.conflictingFiles }
    }

    await pushRollupBranch(rollupPath, branchName, env)

    const body = prBody ?? buildRollupPrBody(ordered)
    const { prUrl, prNumber } = await createNewPr(rollupPath, branchName, prTitle, ghRepo, env, logger, body)

    if (!prUrl || prNumber === null) {
      return { success: false, error: 'PR creation failed — no URL returned from gh' }
    }

    await updateTaskPrFields(ordered, prNumber, prUrl, repo)
    logger.info(`[rollup] created rollup PR ${prUrl} for ${ordered.length} tasks`)
    return { success: true, prUrl, prNumber }
  } finally {
    await cleanupRollupWorktree(repoPath, rollupPath, branchName, env)
  }
}

// ============================================================================
// Git operations
// ============================================================================

async function fetchOriginMain(repoPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync('git', ['fetch', 'origin', 'main'], {
    cwd: repoPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS
  })
}

async function createRollupWorktree(
  repoPath: string,
  branchName: string,
  rollupPath: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFileAsync('git', ['worktree', 'add', '-b', branchName, rollupPath, 'origin/main'], {
    cwd: repoPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS
  })
}

interface MergeResult {
  success: true
}

interface MergeFailure {
  success: false
  error: string
  conflictingFiles?: string[]
}

async function squashMergeBranches(
  rollupPath: string,
  tasks: SprintTask[],
  branches: string[],
  env: NodeJS.ProcessEnv
): Promise<MergeResult | MergeFailure> {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!
    const branch = branches[i]!

    try {
      await execFileAsync('git', ['merge', '--squash', branch], {
        cwd: rollupPath,
        env,
        timeout: GIT_EXEC_TIMEOUT_MS
      })
    } catch {
      const conflictingFiles = await extractConflictFiles(rollupPath, env)
      await abortMerge(rollupPath, env)
      return {
        success: false,
        error: `Merge conflict in task "${task.title}" (branch ${branch})`,
        conflictingFiles
      }
    }

    const shortId = task.id.slice(0, 8)
    const commitMessage = `feat: ${sanitizeForGit(task.title)} (#${shortId})`
    await execFileAsync('git', ['commit', '-m', commitMessage], {
      cwd: rollupPath,
      env,
      timeout: GIT_EXEC_TIMEOUT_MS
    })
  }
  return { success: true }
}

async function extractConflictFiles(
  rollupPath: string,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', '--diff-filter=U'],
      { cwd: rollupPath, env, timeout: GIT_EXEC_TIMEOUT_MS }
    )
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function abortMerge(rollupPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFileAsync('git', ['merge', '--abort'], {
      cwd: rollupPath,
      env,
      timeout: GIT_EXEC_TIMEOUT_MS
    })
  } catch {
    // Best-effort; worktree cleanup happens in finally block
  }
}

async function pushRollupBranch(
  rollupPath: string,
  branchName: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFileAsync('git', ['push', '-u', 'origin', branchName], {
    cwd: rollupPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS
  })
}

async function cleanupRollupWorktree(
  repoPath: string,
  rollupPath: string,
  branchName: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', rollupPath], {
      cwd: repoPath,
      env,
      timeout: GIT_EXEC_TIMEOUT_MS
    })
  } catch (err) {
    logger.warn(`[rollup] Failed to remove rollup worktree ${rollupPath}: ${getErrorMessage(err)}`)
  }
  try {
    await execFileAsync('git', ['branch', '-D', branchName], {
      cwd: repoPath,
      env,
      timeout: GIT_EXEC_TIMEOUT_MS
    })
  } catch {
    // Branch already deleted (e.g. push failed) — not an error
  }
}

// ============================================================================
// Task helpers
// ============================================================================

function loadTasksOrThrow(taskIds: string[]): SprintTask[] {
  return taskIds.map((id) => {
    const task = getTask(id)
    if (!task) throw new Error(`Task ${id} not found`)
    if (task.status !== 'review') throw new Error(`Task "${task.title}" is not in review status`)
    if (!task.worktree_path) throw new Error(`Task "${task.title}" has no worktree`)
    return task
  })
}

function requireCommonRepo(tasks: SprintTask[]): string {
  const repos = new Set(tasks.map((t) => t.repo))
  if (repos.size !== 1) {
    throw new Error('All selected tasks must belong to the same repository')
  }
  return [...repos][0]!
}

async function resolveTaskBranches(
  tasks: SprintTask[],
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  return Promise.all(
    tasks.map(async (task) => {
      const { stdout } = await execFileAsync(
        'git',
        ['branch', '--show-current'],
        { cwd: task.worktree_path!, env, timeout: GIT_EXEC_TIMEOUT_MS }
      )
      const branch = stdout.trim()
      if (!branch) throw new Error(`Could not determine branch for task "${task.title}"`)
      return branch
    })
  )
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
        { caller: 'review-rollup' }
      )
      if (updated) notifySprintMutation('updated', updated)
    })
  )
}

function buildRollupPrBody(tasks: SprintTask[]): string {
  const taskList = tasks
    .map((t) => `- **${sanitizeForGit(t.title)}** (\`${t.id.slice(0, 8)}\`)`)
    .join('\n')
  return `## Bundled Tasks\n\n${taskList}\n\n🤖 Rollup PR created by FLEET`
}

// ============================================================================
// Topological sort
// ============================================================================

/**
 * Orders tasks so each task appears after its dependencies within the
 * selected set. Tasks with no inter-dependencies preserve input order.
 * Uses Kahn's algorithm (BFS).
 */
export function topoSort(tasks: SprintTask[]): SprintTask[] {
  const idSet = new Set(tasks.map((t) => t.id))
  const indexById = new Map(tasks.map((t, i) => [t.id, i]))

  // Build in-degree and adjacency for edges within the selected set only
  const inDegree = new Map(tasks.map((t) => [t.id, 0]))
  const successors = new Map(tasks.map((t) => [t.id, [] as string[]]))

  for (const task of tasks) {
    const deps = task.depends_on ?? []
    for (const dep of deps) {
      if (idSet.has(dep.id)) {
        // dep.id must come before task.id
        successors.get(dep.id)!.push(task.id)
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
      }
    }
  }

  // Start with tasks that have no in-set dependencies; stable-sort by original index
  const queue = tasks
    .filter((t) => inDegree.get(t.id) === 0)
    .sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0))

  const result: SprintTask[] = []
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  while (queue.length > 0) {
    const task = queue.shift()!
    result.push(task)
    const nexts = (successors.get(task.id) ?? [])
      .map((id) => ({ id, deg: (inDegree.get(id) ?? 1) - 1 }))
    for (const { id, deg } of nexts) {
      inDegree.set(id, deg)
      if (deg === 0) queue.push(taskById.get(id)!)
    }
  }

  // If cycle detected (shouldn't happen — creation-time cycle detection),
  // append remaining tasks in original order
  if (result.length < tasks.length) {
    const resultIds = new Set(result.map((t) => t.id))
    tasks.filter((t) => !resultIds.has(t.id)).forEach((t) => result.push(t))
  }

  return result
}

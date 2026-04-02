/**
 * Review IPC handlers — code review actions for the in-app review station.
 *
 * Provides diff viewing, commit listing, local merge, PR creation,
 * revision requests, and task discard for worktree-based agent tasks.
 */
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import {
  getTask as _getTask,
  updateTask as _updateTask
} from '../data/sprint-queries'
import { notifySprintMutation } from './sprint-listeners'
import { getSettingJson } from '../settings'
import { buildAgentEnv } from '../env-utils'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const logger = createLogger('review-handlers')

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
}

let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null

export function setReviewOnStatusTerminal(fn: (taskId: string, status: string) => void): void {
  _onStatusTerminal = fn
}

/**
 * Parse git diff --numstat output into structured file objects.
 * Each line: "additions\tdeletions\tfilepath"
 */
function parseNumstat(
  numstat: string,
  patchMap: Map<string, string>
): Array<{ path: string; status: string; additions: number; deletions: number; patch: string }> {
  return numstat
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
      const filePath = parts.slice(2).join('\t')
      const status =
        additions > 0 && deletions > 0 ? 'modified' : additions > 0 ? 'added' : 'deleted'
      return {
        path: filePath,
        status,
        additions,
        deletions,
        patch: patchMap.get(filePath) ?? ''
      }
    })
}

function getRepoConfig(repoName: string): RepoConfig | null {
  const repos = getSettingJson<RepoConfig[]>('repos')
  return repos?.find((r) => r.name === repoName) ?? null
}

export function registerReviewHandlers(): void {
  const env = buildAgentEnv()

  // review:getDiff — get file list with additions/deletions for a worktree branch
  safeHandle('review:getDiff', async (_e, payload) => {
    const { worktreePath, base } = payload

    // Get numstat for structured data
    const { stdout: numstatOut } = await execFileAsync(
      'git',
      ['diff', '--numstat', `${base}...HEAD`],
      { cwd: worktreePath, env }
    )

    // Get full patch for file-level diffs
    const { stdout: patchOut } = await execFileAsync('git', ['diff', `${base}...HEAD`], {
      cwd: worktreePath,
      env,
      maxBuffer: 10 * 1024 * 1024 // 10MB for large diffs
    })

    // Build a map of filepath -> patch section
    const patchMap = new Map<string, string>()
    const patchSections = patchOut.split(/^diff --git /m)
    for (const section of patchSections) {
      if (!section.trim()) continue
      // Extract file path from "a/path b/path" line
      const match = section.match(/^a\/(.+?) b\//)
      if (match) {
        patchMap.set(match[1], 'diff --git ' + section)
      }
    }

    const files = numstatOut.trim() ? parseNumstat(numstatOut, patchMap) : []
    return { files }
  })

  // review:getCommits — list commits between base and HEAD
  safeHandle('review:getCommits', async (_e, payload) => {
    const { worktreePath, base } = payload

    const { stdout } = await execFileAsync(
      'git',
      ['log', `${base}..HEAD`, '--format=%H|%s|%an|%aI', '--reverse'],
      { cwd: worktreePath, env }
    )

    const commits = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, message, author, date] = line.split('|')
        return { hash, message, author, date }
      })

    return { commits }
  })

  // review:getFileDiff — get diff for a single file
  safeHandle('review:getFileDiff', async (_e, payload) => {
    const { worktreePath, filePath, base } = payload

    const { stdout } = await execFileAsync(
      'git',
      ['diff', `${base}...HEAD`, '--', filePath],
      {
        cwd: worktreePath,
        env,
        maxBuffer: 10 * 1024 * 1024
      }
    )

    return { diff: stdout }
  })

  // review:mergeLocally — merge agent branch into main repo
  safeHandle('review:mergeLocally', async (_e, payload) => {
    const { taskId, strategy } = payload

    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

    // Get branch name from the worktree
    const { stdout: branchName } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: task.worktree_path, env }
    )
    const branch = branchName.trim()

    // Resolve repo local path
    const repoConfig = getRepoConfig(task.repo)
    if (!repoConfig) throw new Error(`Repo "${task.repo}" not found in settings`)
    const repoPath = repoConfig.localPath

    try {
      if (strategy === 'squash') {
        await execFileAsync('git', ['merge', '--squash', branch], { cwd: repoPath, env })
        // Commit the squash merge
        await execFileAsync('git', ['commit', '-m', `${task.title} (#${taskId})`], {
          cwd: repoPath,
          env
        })
      } else if (strategy === 'rebase') {
        // Rebase the branch onto main, then fast-forward main
        await execFileAsync('git', ['rebase', 'HEAD', branch], { cwd: repoPath, env })
        await execFileAsync('git', ['merge', '--ff-only', branch], { cwd: repoPath, env })
      } else {
        // Default merge commit
        await execFileAsync(
          'git',
          ['merge', '--no-ff', branch, '-m', `Merge: ${task.title} (#${taskId})`],
          { cwd: repoPath, env }
        )
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // Abort the failed merge/rebase
      try {
        if (strategy === 'rebase') {
          await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath, env })
        } else {
          await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath, env })
        }
      } catch {
        /* abort is best-effort */
      }

      // Try to extract conflict file names
      const conflicts: string[] = []
      try {
        const { stdout: conflictOut } = await execFileAsync(
          'git',
          ['diff', '--name-only', '--diff-filter=U'],
          { cwd: repoPath, env }
        )
        conflicts.push(
          ...conflictOut
            .trim()
            .split('\n')
            .filter(Boolean)
        )
      } catch {
        /* best-effort */
      }

      return { success: false, conflicts, error: errMsg }
    }

    // Clean up worktree + branch
    try {
      await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], {
        cwd: repoPath,
        env
      })
    } catch {
      /* best-effort cleanup */
    }
    try {
      await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env })
    } catch {
      /* best-effort cleanup */
    }

    // Mark task done via terminal service
    const updated = _updateTask(taskId, {
      status: 'done',
      completed_at: new Date().toISOString(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    if (_onStatusTerminal) {
      _onStatusTerminal(taskId, 'done')
    } else {
      logger.warn(
        `[review:mergeLocally] Task ${taskId} done but _onStatusTerminal not set — deps won't resolve`
      )
    }

    return { success: true }
  })

  // review:createPr — push branch and create PR via gh CLI
  safeHandle('review:createPr', async (_e, payload) => {
    const { taskId, title, body } = payload

    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

    // Get branch name from the worktree
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: task.worktree_path, env }
    )
    const branch = branchOut.trim()

    // Push the branch
    await execFileAsync('git', ['push', '-u', 'origin', branch], {
      cwd: task.worktree_path,
      env
    })

    // Create PR via gh CLI
    const { stdout: prUrl } = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', title, '--body', body, '--head', branch],
      { cwd: task.worktree_path, env }
    )
    const trimmedPrUrl = prUrl.trim()

    // Extract PR number from URL (e.g., https://github.com/owner/repo/pull/123)
    const prNumberMatch = trimmedPrUrl.match(/\/pull\/(\d+)$/)
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : null

    // Update task with PR info
    const updated = _updateTask(taskId, {
      pr_url: trimmedPrUrl,
      pr_number: prNumber,
      pr_status: 'open'
    })
    if (updated) notifySprintMutation('updated', updated)

    // Clean up worktree (branch stays for the PR)
    try {
      const repoConfig = getRepoConfig(task.repo)
      if (repoConfig) {
        await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], {
          cwd: repoConfig.localPath,
          env
        })
        _updateTask(taskId, { worktree_path: null })
      }
    } catch {
      /* best-effort cleanup */
    }

    return { prUrl: trimmedPrUrl }
  })

  // review:requestRevision — send task back for another pass
  safeHandle('review:requestRevision', async (_e, payload) => {
    const { taskId, feedback, mode } = payload

    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const revisionNotes = `[Revision requested]: ${feedback}`
    const patch: Record<string, unknown> = {
      status: 'queued',
      claimed_by: null,
      notes: revisionNotes,
      started_at: null,
      completed_at: null,
      fast_fail_count: 0,
      needs_review: false,
      // Append feedback to spec so the agent sees it
      spec: task.spec
        ? `${task.spec}\n\n## Revision Feedback\n\n${feedback}`
        : feedback
    }

    // In fresh mode, clear the agent_run_id to start a new session
    if (mode === 'fresh') {
      patch.agent_run_id = null
    }

    const updated = _updateTask(taskId, patch)
    if (updated) notifySprintMutation('updated', updated)

    return { success: true }
  })

  // review:discard — clean up worktree + branch, cancel the task
  safeHandle('review:discard', async (_e, payload) => {
    const { taskId } = payload

    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    // Clean up worktree if it exists
    if (task.worktree_path) {
      const repoConfig = getRepoConfig(task.repo)
      if (repoConfig) {
        try {
          await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], {
            cwd: repoConfig.localPath,
            env
          })
        } catch {
          /* best-effort */
        }

        // Get and delete the branch
        try {
          const { stdout: branchOut } = await execFileAsync(
            'git',
            ['rev-parse', '--abbrev-ref', 'HEAD'],
            { cwd: task.worktree_path, env }
          )
          const branch = branchOut.trim()
          if (branch && branch !== 'HEAD') {
            await execFileAsync('git', ['branch', '-D', branch], {
              cwd: repoConfig.localPath,
              env
            })
          }
        } catch {
          /* best-effort — worktree may already be gone */
        }
      }
    }

    // Mark task cancelled via terminal service
    const updated = _updateTask(taskId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    if (_onStatusTerminal) {
      _onStatusTerminal(taskId, 'cancelled')
    } else {
      logger.warn(
        `[review:discard] Task ${taskId} cancelled but _onStatusTerminal not set — deps won't resolve`
      )
    }

    return { success: true }
  })
}

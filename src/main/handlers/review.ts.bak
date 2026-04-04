/**
 * Review IPC handlers — code review actions for the in-app review station.
 *
 * Provides diff viewing, commit listing, local merge, PR creation,
 * revision requests, and task discard for worktree-based agent tasks.
 */
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import { getTask as _getTask, updateTask as _updateTask } from '../data/sprint-queries'
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
      ['log', `${base}..HEAD`, '--format=%H%x00%s%x00%an%x00%aI', '--reverse'],
      { cwd: worktreePath, env }
    )

    const commits = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, message, author, date] = line.split('\x00')
        return { hash, message, author, date }
      })

    return { commits }
  })

  // review:getFileDiff — get diff for a single file
  safeHandle('review:getFileDiff', async (_e, payload) => {
    const { worktreePath, filePath, base } = payload

    const { stdout } = await execFileAsync('git', ['diff', `${base}...HEAD`, '--', filePath], {
      cwd: worktreePath,
      env,
      maxBuffer: 10 * 1024 * 1024
    })

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

    // Verify clean working tree before merge
    try {
      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: repoPath,
        env
      })
      if (statusOut.trim()) {
        throw new Error(
          'Working tree has uncommitted changes. Commit or stash them before merging.'
        )
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errMsg }
    }

    try {
      if (strategy === 'squash') {
        await execFileAsync('git', ['merge', '--squash', branch], { cwd: repoPath, env })
        // Commit the squash merge
        try {
          await execFileAsync('git', ['commit', '-m', `${task.title} (#${taskId})`], {
            cwd: repoPath,
            env
          })
        } catch (commitErr: unknown) {
          // Squash merge succeeded but commit failed — unstage to prevent silent corruption
          logger.error(`[review:mergeLocally] Squash commit failed for task ${taskId}, unstaging`)
          try {
            await execFileAsync('git', ['reset', 'HEAD'], { cwd: repoPath, env })
          } catch {
            logger.warn(`[review:mergeLocally] git reset HEAD failed — manual cleanup required`)
          }
          throw commitErr
        }
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
        conflicts.push(...conflictOut.trim().split('\n').filter(Boolean))
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
    _updateTask(taskId, {
      pr_url: trimmedPrUrl,
      pr_number: prNumber,
      pr_status: 'open'
    })

    // Clean up worktree (branch stays for the PR)
    try {
      const repoConfig = getRepoConfig(task.repo)
      if (repoConfig) {
        await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], {
          cwd: repoConfig.localPath,
          env
        })
      }
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
        `[review:createPr] Task ${taskId} done but _onStatusTerminal not set — deps won't resolve`
      )
    }

    return { prUrl: trimmedPrUrl }
  })

  // review:requestRevision — send task back for another pass
  //
  // INTENTIONAL TRANSITION: review → queued
  // This is the correct path for requesting revisions. The task returns to the
  // queue so the agent manager can pick it up and re-execute with the feedback
  // appended to the spec. The 'review' status is not a valid transition target
  // (it's a UI-only partition, not a DB status). Tasks awaiting review have
  // status='active' or 'done' with pr_status='open'.
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
      spec: task.spec ? `${task.spec}\n\n## Revision Feedback\n\n${feedback}` : feedback
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
        // Read branch name BEFORE removing worktree
        let branch: string | null = null
        try {
          const { stdout: branchOut } = await execFileAsync(
            'git',
            ['rev-parse', '--abbrev-ref', 'HEAD'],
            { cwd: task.worktree_path, env }
          )
          branch = branchOut.trim()
        } catch {
          /* best-effort — worktree may not exist */
        }

        // Remove worktree
        try {
          await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], {
            cwd: repoConfig.localPath,
            env
          })
        } catch {
          /* best-effort */
        }

        // Delete branch
        if (branch && branch !== 'HEAD') {
          try {
            await execFileAsync('git', ['branch', '-D', branch], {
              cwd: repoConfig.localPath,
              env
            })
          } catch {
            /* best-effort */
          }
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

  // review:shipIt — merge + push + done in one action
  safeHandle('review:shipIt', async (_e, payload) => {
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

    // Verify clean working tree
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      env
    })
    if (statusOut.trim()) {
      return {
        success: false,
        error: 'Working tree has uncommitted changes. Commit or stash first.'
      }
    }

    // Merge
    try {
      if (strategy === 'squash') {
        await execFileAsync('git', ['merge', '--squash', branch], { cwd: repoPath, env })
        try {
          await execFileAsync('git', ['commit', '-m', `${task.title} (#${taskId})`], {
            cwd: repoPath,
            env
          })
        } catch (commitErr) {
          try {
            await execFileAsync('git', ['reset', 'HEAD'], { cwd: repoPath, env })
          } catch {
            /* */
          }
          throw commitErr
        }
      } else if (strategy === 'rebase') {
        await execFileAsync('git', ['rebase', 'HEAD', branch], { cwd: repoPath, env })
        await execFileAsync('git', ['merge', '--ff-only', branch], { cwd: repoPath, env })
      } else {
        await execFileAsync(
          'git',
          ['merge', '--no-ff', branch, '-m', `Merge: ${task.title} (#${taskId})`],
          { cwd: repoPath, env }
        )
      }
    } catch (err) {
      // Abort failed merge/rebase
      try {
        if (strategy === 'rebase') {
          await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath, env })
        } else {
          await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath, env })
        }
      } catch {
        /* best-effort */
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    // Push
    let pushed = false
    try {
      await execFileAsync('git', ['push', 'origin', 'HEAD'], { cwd: repoPath, env })
      pushed = true
    } catch (pushErr) {
      logger.warn(`[review:shipIt] Push failed for task ${taskId}: ${pushErr}`)
      // Merge succeeded, push failed — still mark done but warn user
    }

    // Clean up worktree + branch
    try {
      await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], {
        cwd: repoPath,
        env
      })
    } catch {
      /* best-effort */
    }
    try {
      await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env })
    } catch {
      /* best-effort */
    }

    // Mark task done
    const updated = _updateTask(taskId, {
      status: 'done',
      completed_at: new Date().toISOString(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    if (_onStatusTerminal) {
      _onStatusTerminal(taskId, 'done')
    }

    return { success: true, pushed }
  })
||||||| 5faba97c

  // review:shipIt — merge locally + push to origin + mark done in one action
  safeHandle('review:shipIt', async (_e, payload) => {
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

    // Verify clean working tree
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      env
    })
    if (statusOut.trim()) {
      return {
        success: false,
        error: 'Working tree has uncommitted changes. Commit or stash first.'
      }
    }

    // Merge
    try {
      if (strategy === 'squash') {
        await execFileAsync('git', ['merge', '--squash', branch], { cwd: repoPath, env })
        try {
          await execFileAsync('git', ['commit', '-m', `${task.title} (#${taskId})`], {
            cwd: repoPath,
            env
          })
        } catch (commitErr) {
          try {
            await execFileAsync('git', ['reset', 'HEAD'], { cwd: repoPath, env })
          } catch {
            /* best-effort */
          }
          throw commitErr
        }
      } else if (strategy === 'rebase') {
        await execFileAsync('git', ['rebase', 'HEAD', branch], { cwd: repoPath, env })
        await execFileAsync('git', ['merge', '--ff-only', branch], { cwd: repoPath, env })
      } else {
        await execFileAsync(
          'git',
          ['merge', '--no-ff', branch, '-m', `Merge: ${task.title} (#${taskId})`],
          { cwd: repoPath, env }
        )
      }
    } catch (err) {
      // Abort failed merge/rebase
      try {
        if (strategy === 'rebase') {
          await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath, env })
        } else {
          await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath, env })
        }
      } catch {
        /* best-effort */
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    // Push
    let pushed = false
    try {
      await execFileAsync('git', ['push', 'origin', 'HEAD'], { cwd: repoPath, env })
      pushed = true
    } catch (pushErr) {
      logger.warn(`[review:shipIt] Push failed for task ${taskId}: ${pushErr}`)
      // Merge succeeded, push failed — still mark done but warn user
    }

    // Clean up worktree + branch
    try {
      await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], {
        cwd: repoPath,
        env
      })
    } catch {
      /* best-effort */
    }
    try {
      await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env })
    } catch {
      /* best-effort */
    }

    // Mark task done
    const updated = _updateTask(taskId, {
      status: 'done',
      completed_at: new Date().toISOString(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    if (_onStatusTerminal) {
      _onStatusTerminal(taskId, 'done')
    }

    return { success: true, pushed }
  })

  // review:generateSummary — generate AI review summary for a task
  safeHandle('review:generateSummary', async (_e, payload) => {
    const { taskId } = payload

    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (!task.worktree_path) throw new Error('Task has no worktree')

    // Get diff stat
    const { stdout: diffStat } = await execFileAsync(
      'git',
      ['diff', '--stat', 'origin/main...HEAD'],
      { cwd: task.worktree_path, env, maxBuffer: 10 * 1024 * 1024 }
    )

    const { buildReviewSummaryPrompt } = await import('../services/review-summary')
    const prompt = buildReviewSummaryPrompt(diffStat, task.title)

    // Use SDK for summary generation (haiku for speed)
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const { buildAgentEnv } = await import('../env-utils')
    const agentEnv = buildAgentEnv()

    const queryHandle = sdk.query({
      prompt,
      options: {
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 1,
        env: agentEnv as Record<string, string>,
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
        settingSources: ['user', 'project', 'local']
      }
    })

    let fullText = ''
    try {
      for await (const msg of queryHandle) {
        if (typeof msg !== 'object' || msg === null) continue
        const m = msg as Record<string, unknown>
        if (m.type === 'assistant') {
          const message = m.message as Record<string, unknown> | undefined
          const content = message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as Record<string, unknown>
              if (b.type === 'text' && typeof b.text === 'string') {
                fullText += b.text
              }
            }
          }
        }
      }
    } finally {
      // Cleanup
    }

    return { summary: fullText.trim() }
  })
}

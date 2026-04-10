/**
 * Review IPC handlers — code review actions for the in-app review station.
 *
 * Provides diff viewing, commit listing, local merge, PR creation,
 * revision requests, and task discard for worktree-based agent tasks.
 */
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import { getTask as _getTask, updateTask as _updateTask } from '../services/sprint-service'
import { notifySprintMutation } from './sprint-listeners'
import { getSettingJson } from '../settings'
import { buildAgentEnv } from '../env-utils'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  mergeAgentBranch,
  cleanupWorktree,
  executeMergeStrategy
} from '../services/review-merge-service'
import { runPostMergeDedup } from '../services/post-merge-dedup'
import { BDE_TASK_MEMORY_DIR } from '../paths'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { rebaseOntoMain, pushBranch, checkExistingPr } from '../agent-manager/git-operations'

const execFileAsync = promisify(execFile)
const logger = createLogger('review-handlers')

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
}

export interface ReviewHandlersDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
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
  const target = repoName.toLowerCase()
  return repos?.find((r) => r.name.toLowerCase() === target) ?? null
}

export function registerReviewHandlers(deps: ReviewHandlersDeps): void {
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

    // Execute merge via service
    const result = await mergeAgentBranch({
      worktreePath: task.worktree_path,
      branch,
      repoPath,
      strategy,
      taskId,
      taskTitle: task.title,
      env
    })

    if (!result.success) {
      return { success: false, error: result.error, conflicts: result.conflicts }
    }

    // Post-merge CSS dedup warnings
    try {
      const dedupReport = await runPostMergeDedup(repoPath)
      if (dedupReport?.warnings.length) {
        const existing = _getTask(taskId)
        const warnText = `\n\n## CSS Near-Duplicate Warnings\n${dedupReport.warnings.join('\n')}`
        _updateTask(taskId, { notes: (existing?.notes || '') + warnText })
      }
    } catch (err) {
      logger.warn(`[review:mergeLocally] Post-merge dedup failed (non-fatal): ${err}`)
    }

    // Clean up worktree + branch
    await cleanupWorktree(task.worktree_path, branch, repoPath, env)

    // Mark task done via terminal service
    const updated = _updateTask(taskId, {
      status: 'done',
      completed_at: nowIso(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    deps.onStatusTerminal(taskId, 'done')

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
    const pushResult = await pushBranch(task.worktree_path, branch, env, logger)
    if (!pushResult.success) {
      throw new Error(pushResult.error || 'Push failed')
    }

    // Check for existing PR or create new one
    const existing = await checkExistingPr(task.worktree_path, branch, env, logger)
    const repoConfig = getRepoConfig(task.repo)
    let prUrl: string | null
    let prNumber: number | null

    if (existing) {
      prUrl = existing.prUrl
      prNumber = existing.prNumber
    } else {
      const result = await execFileAsync(
        'gh',
        ['pr', 'create', '--title', title, '--body', body, '--head', branch],
        { cwd: task.worktree_path, env }
      )
      const trimmedPrUrl = result.stdout.trim()
      const prNumberMatch = trimmedPrUrl.match(/\/pull\/(\d+)$/)
      prUrl = trimmedPrUrl
      prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : null
    }

    if (!prUrl) {
      throw new Error('PR creation failed')
    }

    // Update task with PR info
    _updateTask(taskId, {
      pr_url: prUrl,
      pr_number: prNumber ?? null,
      pr_status: 'open'
    })

    // Clean up worktree (branch stays for the PR)
    if (repoConfig) {
      await cleanupWorktree(task.worktree_path, branch, repoConfig.localPath, env)
    }

    // Mark task done via terminal service
    const updated = _updateTask(taskId, {
      status: 'done',
      completed_at: nowIso(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    deps.onStatusTerminal(taskId, 'done')

    return { prUrl }
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

        if (branch && branch !== 'HEAD') {
          await cleanupWorktree(task.worktree_path, branch, repoConfig.localPath, env)
        }
      }
    }

    // Clean up task scratchpad
    try {
      rmSync(join(BDE_TASK_MEMORY_DIR, taskId), { recursive: true, force: true })
    } catch {
      /* best-effort */
    }

    // Mark task cancelled via terminal service
    const updated = _updateTask(taskId, {
      status: 'cancelled',
      completed_at: nowIso(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    deps.onStatusTerminal(taskId, 'cancelled')

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

    // Verify main checkout is on `main` branch
    const { stdout: currentBranchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: repoPath, env }
    )
    const currentBranch = currentBranchOut.trim()
    if (currentBranch !== 'main') {
      return {
        success: false,
        error: `Main repo checkout is on branch "${currentBranch}", not "main". Switch to main before shipping.`
      }
    }

    // Fetch origin/main and fast-forward local main
    try {
      logger.info(`[review:shipIt] Fetching origin/main for task ${taskId}`)
      await execFileAsync('git', ['fetch', 'origin', 'main'], { cwd: repoPath, env })
      logger.info(`[review:shipIt] Fast-forwarding local main to origin/main`)
      await execFileAsync('git', ['merge', '--ff-only', 'origin/main'], { cwd: repoPath, env })
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err)
      logger.error(`[review:shipIt] Fetch/FF failed for task ${taskId}: ${errMsg}`)
      return {
        success: false,
        error: `Failed to sync local main with origin: ${errMsg}`
      }
    }

    // Rebase agent branch onto origin/main
    const rebaseResult = await rebaseOntoMain(task.worktree_path, env, logger)
    if (!rebaseResult.success) {
      return { success: false, error: `Rebase failed: ${rebaseResult.notes}` }
    }

    // Execute merge strategy
    const mergeResult = await executeMergeStrategy(
      branch,
      repoPath,
      strategy,
      taskId,
      task.title,
      env
    )
    if (!mergeResult.success) {
      return { success: false, error: mergeResult.error, conflicts: mergeResult.conflicts }
    }

    // Post-merge CSS dedup
    try {
      const dedupReport = await runPostMergeDedup(repoPath)
      if (dedupReport?.warnings.length) {
        const existing = _getTask(taskId)
        const warnText = `\n\n## CSS Near-Duplicate Warnings\n${dedupReport.warnings.join('\n')}`
        _updateTask(taskId, { notes: (existing?.notes || '') + warnText })
      }
    } catch (err) {
      logger.warn(`[review:shipIt] Post-merge dedup failed (non-fatal): ${err}`)
    }

    // Push
    let pushed = false
    try {
      await execFileAsync('git', ['push', 'origin', 'HEAD'], { cwd: repoPath, env })
      pushed = true
    } catch (pushErr) {
      logger.warn(`[review:shipIt] Push failed for task ${taskId}: ${pushErr}`)
    }

    // Clean up worktree + branch
    await cleanupWorktree(task.worktree_path, branch, repoPath, env)

    // Mark task done
    const updated = _updateTask(taskId, {
      status: 'done',
      completed_at: nowIso(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    deps.onStatusTerminal(taskId, 'done')

    return { success: true, pushed }
  })

  // review:rebase — manually rebase agent branch onto current origin/main
  safeHandle('review:rebase', async (_e, payload) => {
    const { taskId } = payload

    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

    // Rebase via service
    const result = await rebaseOntoMain(task.worktree_path, env, logger)
    if (!result.success) {
      // Extract conflict files
      const conflicts: string[] = []
      try {
        const { stdout: conflictOut } = await execFileAsync(
          'git',
          ['diff', '--name-only', '--diff-filter=U'],
          { cwd: task.worktree_path, env }
        )
        conflicts.push(...conflictOut.trim().split('\n').filter(Boolean))
      } catch {
        /* best-effort */
      }
      return { success: false, error: result.notes, conflicts }
    }

    // Get the new base SHA and persist it
    const { stdout: baseShaOut } = await execFileAsync('git', ['rev-parse', 'origin/main'], {
      cwd: task.worktree_path,
      env
    })
    const baseSha = baseShaOut.trim()

    const updated = _updateTask(taskId, {
      rebase_base_sha: baseSha,
      rebased_at: nowIso()
    })
    if (updated) notifySprintMutation('updated', updated)

    return { success: true, baseSha }
  })

  // review:checkFreshness — check if task's rebase is current with origin/main
  safeHandle('review:checkFreshness', async (_e, payload) => {
    const { taskId } = payload

    const task = _getTask(taskId)
    if (!task) return { status: 'unknown' as const }
    if (!task.rebase_base_sha) return { status: 'unknown' as const }

    try {
      const repoConfig = getRepoConfig(task.repo)
      if (!repoConfig) return { status: 'unknown' as const }

      await execFileAsync('git', ['fetch', 'origin', 'main'], {
        cwd: repoConfig.localPath,
        env
      })

      const { stdout: currentShaOut } = await execFileAsync('git', ['rev-parse', 'origin/main'], {
        cwd: repoConfig.localPath,
        env
      })
      const currentSha = currentShaOut.trim()

      if (currentSha === task.rebase_base_sha) {
        return { status: 'fresh' as const, commitsBehind: 0 }
      }

      // Count commits between task's base and current origin/main
      const { stdout: countOut } = await execFileAsync(
        'git',
        ['rev-list', '--count', `${task.rebase_base_sha}..origin/main`],
        { cwd: repoConfig.localPath, env }
      )
      const commitsBehind = parseInt(countOut.trim(), 10)

      return { status: 'stale' as const, commitsBehind }
    } catch (err: unknown) {
      logger.warn(`[review:checkFreshness] Error for task ${taskId}: ${err}`)
      return { status: 'unknown' as const }
    }
  })

  // review:generateSummary — AI-generated review summary (stub, not implemented)
  safeHandle('review:generateSummary', async (_e, _payload) => {
    logger.warn('review:generateSummary called but not implemented — returning empty summary')
    return { summary: '' }
  })

  // review:checkAutoReview — check if task qualifies for auto-review
  safeHandle('review:checkAutoReview', async (_e, payload) => {
    const { taskId } = payload

    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (!task.worktree_path) {
      return {
        shouldAutoMerge: false,
        shouldAutoApprove: false,
        matchedRule: null
      }
    }

    // Load auto-review rules from settings
    const rules = getSettingJson<
      Array<{
        id: string
        name: string
        enabled: boolean
        conditions: {
          maxLinesChanged?: number
          filePatterns?: string[]
          excludePatterns?: string[]
        }
        action: 'auto-merge' | 'auto-approve'
      }>
    >('autoReview.rules')
    if (!rules || rules.length === 0) {
      return {
        shouldAutoMerge: false,
        shouldAutoApprove: false,
        matchedRule: null
      }
    }

    // Get file diff stats
    const { stdout: numstatOut } = await execFileAsync(
      'git',
      ['diff', '--numstat', 'origin/main...HEAD'],
      { cwd: task.worktree_path, env }
    )

    if (!numstatOut.trim()) {
      // No changes — don't auto-merge
      return {
        shouldAutoMerge: false,
        shouldAutoApprove: false,
        matchedRule: null
      }
    }

    // Parse numstat into file summaries
    const files = numstatOut
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t')
        const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
        const filePath = parts.slice(2).join('\t')
        return { path: filePath, additions, deletions }
      })

    // Evaluate rules (import dynamically to avoid circular deps)
    const { evaluateAutoReviewRules } = await import('../services/auto-review')
    const result = evaluateAutoReviewRules(rules, files)

    if (!result) {
      return {
        shouldAutoMerge: false,
        shouldAutoApprove: false,
        matchedRule: null
      }
    }

    return {
      shouldAutoMerge: result.action === 'auto-merge',
      shouldAutoApprove: result.action === 'auto-approve',
      matchedRule: result.rule.name
    }
  })
}

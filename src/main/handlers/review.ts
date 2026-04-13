/**
 * Review IPC handlers — code review actions for the in-app review station.
 *
 * Provides diff viewing, commit listing, local merge, PR creation,
 * revision requests, and task discard for worktree-based agent tasks.
 *
 * NOTE: These handlers are thin adapters. Business logic lives in
 * review-orchestration-service.ts. Handlers should unpack IPC payloads,
 * call the service, and return results.
 */
import { resolve } from 'path'
import { homedir } from 'os'
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import { getSettingJson, getSetting } from '../settings'
import { buildAgentEnv } from '../env-utils'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { parseNumstat } from '../services/review-merge-service'
import * as reviewOrchestration from '../services/review-orchestration-service'

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

function getRepoConfig(repoName: string): RepoConfig | null {
  const repos = getSettingJson<RepoConfig[]>('repos')
  const target = repoName.toLowerCase()
  return repos?.find((r) => r.name.toLowerCase() === target) ?? null
}

/**
 * Safe git ref pattern: commit SHAs, branch names, and remote refs.
 * Allows: a-z A-Z 0-9 / _ . -
 * Rejects: leading dashes (option flags), path traversal (..), shell metacharacters,
 *          tilde (~), caret (^), and other git special syntax.
 * Max length: 200 characters (git itself limits ref names to ~256 bytes).
 */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,198}$/

function validateGitRef(ref: string | undefined | null): void {
  if (!ref || !SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git ref: "${ref}". Must match pattern [a-zA-Z0-9/_.-], max 200 chars.`)
  }
}

/**
 * Returns the configured worktree base directory, defaulting to ~/worktrees/bde.
 * Resolved to an absolute path (no trailing slash).
 */
function getWorktreeBase(): string {
  const configured = getSetting('agentManager.worktreeBase')
  const raw = configured ?? `${homedir()}/worktrees/bde`
  return resolve(raw)
}

/**
 * Validates that a renderer-supplied worktreePath is inside the configured
 * worktree base directory. Throws if not.
 *
 * Security: prevents a compromised renderer from running git commands in
 * arbitrary directories (e.g. /etc, /).
 */
function validateWorktreePath(worktreePath: string | undefined | null): void {
  if (!worktreePath) {
    throw new Error('Invalid worktree path: must not be empty.')
  }
  const resolved = resolve(worktreePath)
  const base = getWorktreeBase()
  if (!resolved.startsWith(base + '/') && resolved !== base) {
    throw new Error(
      `Invalid worktree path: "${worktreePath}" is not inside the configured worktree base (${base}).`
    )
  }
}

/**
 * Validates a renderer-supplied file path for use inside a git diff command.
 * Rejects absolute paths and path traversal sequences.
 *
 * Security: git diff with '--' separator passes the file path directly to git;
 * absolute paths or traversal could reference files outside the worktree.
 */
function validateFilePath(filePath: string | undefined | null): void {
  if (!filePath) {
    throw new Error('Invalid file path: must not be empty.')
  }
  if (filePath.startsWith('/')) {
    throw new Error(`Invalid file path: "${filePath}" must not be an absolute path.`)
  }
  if (filePath.includes('..')) {
    throw new Error(`Invalid file path: "${filePath}" must not contain path traversal sequences.`)
  }
}

export function registerReviewHandlers(deps: ReviewHandlersDeps): void {
  const env = buildAgentEnv()

  // ============================================================================
  // Query Handlers (stay here — no orchestration needed)
  // ============================================================================

  // review:getDiff — get file list with additions/deletions for a worktree branch
  safeHandle('review:getDiff', async (_e, payload) => {
    const { worktreePath, base } = payload
    validateGitRef(base)
    validateWorktreePath(worktreePath)

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
    validateGitRef(base)
    validateWorktreePath(worktreePath)

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
    validateGitRef(base)
    validateWorktreePath(worktreePath)
    validateFilePath(filePath)

    const { stdout } = await execFileAsync('git', ['diff', `${base}...HEAD`, '--', filePath], {
      cwd: worktreePath,
      env,
      maxBuffer: 10 * 1024 * 1024
    })

    return { diff: stdout }
  })

  // review:checkFreshness — check if task's rebase is current with origin/main
  safeHandle('review:checkFreshness', async (_e, payload) => {
    const { taskId } = payload

    // Import task functions inline to avoid top-level coupling
    const { getTask } = await import('../services/sprint-service')
    const task = getTask(taskId)
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

    const { getTask } = await import('../services/sprint-service')
    const task = getTask(taskId)
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

    // Evaluate rules
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

  // ============================================================================
  // Action Handlers (thin wrappers to orchestration service)
  // ============================================================================

  safeHandle('review:mergeLocally', async (_e, payload) => {
    return reviewOrchestration.mergeLocally({
      taskId: payload.taskId,
      strategy: payload.strategy,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
  })

  safeHandle('review:createPr', async (_e, payload) => {
    const result = await reviewOrchestration.createPr({
      taskId: payload.taskId,
      title: payload.title,
      body: payload.body,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
    if (!result.success || !result.prUrl) {
      throw new Error(result.error || 'PR creation failed')
    }
    return { prUrl: result.prUrl }
  })

  safeHandle('review:requestRevision', async (_e, payload) => {
    return reviewOrchestration.requestRevision({
      taskId: payload.taskId,
      feedback: payload.feedback,
      mode: payload.mode
    })
  })

  safeHandle('review:discard', async (_e, payload) => {
    return reviewOrchestration.discard({
      taskId: payload.taskId,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
  })

  safeHandle('review:shipIt', async (_e, payload) => {
    return reviewOrchestration.shipIt({
      taskId: payload.taskId,
      strategy: payload.strategy,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
  })

  safeHandle('review:rebase', async (_e, payload) => {
    return reviewOrchestration.rebase({
      taskId: payload.taskId,
      env
    })
  })
}

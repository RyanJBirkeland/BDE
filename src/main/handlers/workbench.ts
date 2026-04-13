/**
 * Task Workbench IPC handlers — AI-assisted task creation.
 */
import { safeHandle } from '../ipc-utils'
import { checkAuthStatus } from '../auth-guard'
import { getRepoPath } from '../git'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { listTasks } from '../services/sprint-service'
import type { AgentManager } from '../agent-manager'
import { createSpecQualityService } from '../services/spec-quality/factory'
import type { SpecQualityResult } from '../../shared/spec-quality/types'
import { runSdkStreaming } from '../sdk-streaming'
import { extractTasksFromPlan } from '../services/plan-extractor'
import { buildChatPrompt, getCopilotSdkOptions } from '../services/copilot-service'
import { generateSpec } from '../services/spec-generation-service'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'

const execFileAsync = promisify(execFile)
const log = createLogger('workbench')

/** Module-level singleton — created once, reused across all checkSpec calls. */
const specQualityService = createSpecQualityService()

type CheckStatus = 'pass' | 'warn' | 'fail'
interface CheckField { status: CheckStatus; message: string }

/** Maps a SpecQualityResult to the { clarity, scope, filesExist } shape the renderer expects. */
function mapQualityResult(result: SpecQualityResult): {
  clarity: CheckField
  scope: CheckField
  filesExist: CheckField
} {
  // clarity — blocked by any error; warned by prescriptiveness issue; otherwise pass
  const SCOPE_CODES = new Set(['TOO_MANY_FILES', 'TOO_MANY_STEPS', 'SPEC_TOO_LONG'] as const)
  const FILES_CODES = new Set(['FILES_SECTION_NO_PATHS'] as const)

  const scopeIssues = result.issues.filter(i => SCOPE_CODES.has(i.code as 'TOO_MANY_FILES'))
  const filesIssues = result.issues.filter(i => FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS'))
  const clarityIssues = result.issues.filter(
    i => !SCOPE_CODES.has(i.code as 'TOO_MANY_FILES') && !FILES_CODES.has(i.code as 'FILES_SECTION_NO_PATHS')
  )

  const clarityErrors = clarityIssues.filter(i => i.severity === 'error')
  const clarityWarnings = clarityIssues.filter(i => i.severity === 'warning')

  let clarity: CheckField
  if (clarityErrors.length > 0) {
    const messages = clarityErrors.map(i => i.message).join('; ')
    clarity = { status: 'fail', message: messages }
  } else if (clarityWarnings.length > 0) {
    clarity = { status: 'warn', message: clarityWarnings[0].message }
  } else {
    clarity = { status: 'pass', message: 'Spec is clear and actionable' }
  }

  const scopeErrors = scopeIssues.filter(i => i.severity === 'error')
  const scopeWarnings = scopeIssues.filter(i => i.severity === 'warning')
  let scope: CheckField
  if (scopeErrors.length > 0) {
    scope = { status: 'fail', message: scopeErrors.map(i => i.message).join('; ') }
  } else if (scopeWarnings.length > 0) {
    scope = { status: 'warn', message: scopeWarnings[0].message }
  } else {
    scope = { status: 'pass', message: 'Scope looks achievable in one session' }
  }

  const filesErrors = filesIssues.filter(i => i.severity === 'error')
  const filesWarnings = filesIssues.filter(i => i.severity === 'warning')
  let filesExist: CheckField
  if (filesErrors.length > 0) {
    filesExist = { status: 'fail', message: filesErrors.map(i => i.message).join('; ') }
  } else if (filesWarnings.length > 0) {
    filesExist = { status: 'warn', message: filesWarnings[0].message }
  } else {
    filesExist = { status: 'pass', message: 'File paths look specific and plausible' }
  }

  return { clarity, scope, filesExist }
}

/** Active streaming handles, keyed by streamId. */
const activeStreams = new Map<string, { close: () => void }>()

export function registerWorkbenchHandlers(am?: AgentManager): void {
  // --- Fully implemented: Operational validation checks ---
  safeHandle('workbench:checkOperational', async (_e, input: { repo: string }) => {
    const { repo } = input

    // Auth check
    const authStatus = await checkAuthStatus()
    let authResult: { status: 'pass' | 'warn' | 'fail'; message: string }
    if (!authStatus.tokenFound) {
      authResult = {
        status: 'fail',
        message: 'No Claude subscription token found — run: claude login'
      }
    } else if (authStatus.tokenExpired) {
      authResult = {
        status: 'fail',
        message: 'Claude subscription token expired — run: claude login'
      }
    } else if (authStatus.expiresAt) {
      const hoursUntilExpiry = (authStatus.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)
      if (hoursUntilExpiry < 1) {
        authResult = {
          status: 'warn',
          message: `Token expires in ${Math.round(hoursUntilExpiry * 60)} minutes`
        }
      } else {
        authResult = { status: 'pass', message: 'Authentication valid' }
      }
    } else {
      authResult = { status: 'pass', message: 'Authentication valid' }
    }

    // Repo path check (case-insensitive — renderer may send 'BDE')
    const repoPath = getRepoPath(repo)
    let repoPathResult: { status: 'pass' | 'fail'; message: string; path?: string }
    if (!repoPath) {
      repoPathResult = { status: 'fail', message: `No path configured for repo "${repo}"` }
    } else {
      repoPathResult = { status: 'pass', message: 'Repo path configured', path: repoPath }
    }

    // Git clean check
    let gitCleanResult: { status: 'pass' | 'warn'; message: string }
    if (repoPath) {
      try {
        const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
          cwd: repoPath,
          encoding: 'utf-8'
        })
        if (stdout.trim().length === 0) {
          gitCleanResult = { status: 'pass', message: 'Working directory clean' }
        } else {
          gitCleanResult = {
            status: 'warn',
            message: 'Uncommitted changes present (agent may conflict)'
          }
        }
      } catch (err) {
        gitCleanResult = {
          status: 'warn',
          message: `Unable to check git status: ${(err as Error).message}`
        }
      }
    } else {
      gitCleanResult = {
        status: 'warn',
        message: 'Cannot check git status (repo path not configured)'
      }
    }

    // Conflict check: query for other active/queued tasks on same repo
    let noConflictResult: { status: 'pass' | 'warn' | 'fail'; message: string }
    try {
      const tasks = listTasks()
      const conflicting = tasks.filter(
        (t) => t.repo === repo && ['active', 'queued'].includes(t.status)
      )

      if (conflicting.length === 0) {
        noConflictResult = { status: 'pass', message: 'No conflicting tasks' }
      } else {
        const activeCount = conflicting.filter((t) => t.status === 'active').length
        const queuedCount = conflicting.filter((t) => t.status === 'queued').length
        if (activeCount > 0) {
          noConflictResult = {
            status: 'fail',
            message: `${activeCount} active task(s) on this repo`
          }
        } else {
          noConflictResult = {
            status: 'warn',
            message: `${queuedCount} queued task(s) on this repo`
          }
        }
      }
    } catch (err) {
      noConflictResult = {
        status: 'warn',
        message: `Error checking for conflicts: ${(err as Error).message}`
      }
    }

    // Agent slots available check
    let slotsAvailableResult: {
      status: 'pass' | 'warn'
      message: string
      available: number
      max: number
    }
    if (!am) {
      slotsAvailableResult = {
        status: 'warn',
        message: 'Agent manager not available',
        available: 0,
        max: 0
      }
    } else {
      const status = am.getStatus()
      const available = status.concurrency
        ? status.concurrency.maxSlots - status.concurrency.activeCount
        : 0
      const max = status.concurrency?.maxSlots ?? 0
      if (available > 0) {
        slotsAvailableResult = {
          status: 'pass',
          message: `${available} of ${max} slots available`,
          available,
          max
        }
      } else {
        slotsAvailableResult = {
          status: 'warn',
          message: 'All agent slots occupied (task will wait in queue)',
          available: 0,
          max
        }
      }
    }

    return {
      auth: authResult,
      repoPath: repoPathResult,
      gitClean: gitCleanResult,
      noConflict: noConflictResult,
      slotsAvailable: slotsAvailableResult
    }
  })

  // --- Fully implemented: Repo research via grep ---
  safeHandle('workbench:researchRepo', async (_e, input: { query: string; repo: string }) => {
    const { query, repo } = input

    const repoPath = getRepoPath(repo)
    if (!repoPath) {
      return {
        content: `Error: No path configured for repo "${repo}"`,
        filesSearched: [],
        totalMatches: 0
      }
    }

    try {
      const { stdout } = await execFileAsync('grep', ['-rn', '-i', '--', query, '.'], {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024 // 5MB
      })

      const lines = stdout.trim().split('\n').filter(Boolean)
      const fileMap = new Map<string, string[]>()

      for (const line of lines) {
        const match = line.match(/^(.+?):(\d+):(.*)$/)
        if (!match) continue
        const [, file, lineNum, content] = match
        if (!fileMap.has(file)) {
          fileMap.set(file, [])
        }
        fileMap.get(file)!.push(`${lineNum}: ${content.trim()}`)
      }

      const filesSearched = Array.from(fileMap.keys()).slice(0, 10)
      const totalMatches = fileMap.size

      let content = `Found ${totalMatches} file(s) matching "${query}" (showing first 10):\n\n`
      for (const file of filesSearched) {
        const matches = fileMap.get(file)!.slice(0, 3) // 3 lines per file
        content += `**${file}**\n${matches.join('\n')}\n\n`
      }

      return { content, filesSearched, totalMatches }
    } catch (err: unknown) {
      // grep exits with code 1 when no matches found
      if ((err as { code?: number }).code === 1) {
        return {
          content: `No matches found for "${query}" in repo "${repo}"`,
          filesSearched: [],
          totalMatches: 0
        }
      }
      return {
        content: `Error searching repo: ${(err as Error).message}`,
        filesSearched: [],
        totalMatches: 0
      }
    }
  })

  // NOTE: The non-streaming `workbench:chat` IPC handler was removed.
  // It is fully superseded by `workbench:chatStream`, which is the only
  // path the renderer uses. Removing the handler also removes a defense-
  // in-depth gap: the old non-streaming path did not pass the copilot
  // tool restrictions through to the SDK, so it would have run with
  // `bypassPermissions` and full Edit/Write/Bash access. Do not re-add
  // this channel without routing it through `getCopilotSdkOptions`.

  // --- AI-powered streaming chat ---
  safeHandle('workbench:chatStream', async (e, input) => {
    // Case-insensitive lookup — the renderer sends e.g. `repo: 'BDE'` but
    // the underlying map is keyed by lowercase name.
    const repoPath = getRepoPath(input.formContext.repo)
    const streamId = `copilot-${Date.now()}`

    // Fail fast if the repo is not configured: code-awareness depends on a
    // valid `cwd`, and silently falling back to `process.cwd()` (the BDE app
    // directory) means the copilot would operate on the wrong codebase.
    if (!repoPath) {
      const message = `Repo "${input.formContext.repo}" is not configured — code-awareness unavailable. Add the repo in Settings → Repositories.`
      try {
        e.sender.send('workbench:chatChunk', {
          streamId,
          chunk: '',
          done: true,
          error: message
        })
      } catch {
        /* window may have closed */
      }
      return { streamId }
    }

    const prompt = buildChatPrompt(input.messages, input.formContext, repoPath)

    // Fire-and-forget: stream runs in background, pushes chunks to renderer
    runSdkStreaming(
      prompt,
      (chunk) => {
        try {
          e.sender.send('workbench:chatChunk', { streamId, chunk, done: false })
        } catch {
          /* window may have closed */
        }
      },
      activeStreams,
      streamId,
      undefined,
      getCopilotSdkOptions(repoPath, {
        onToolUse: (event) => {
          try {
            e.sender.send('workbench:chatChunk', {
              streamId,
              chunk: '',
              done: false,
              toolUse: { name: event.name, input: event.input }
            })
          } catch {
            /* window may have closed */
          }
        }
      })
    )
      .then((fullText) => {
        try {
          e.sender.send('workbench:chatChunk', { streamId, chunk: '', done: true, fullText })
        } catch {
          /* window may have closed */
        }
      })
      .catch((err) => {
        try {
          e.sender.send('workbench:chatChunk', {
            streamId,
            chunk: '',
            done: true,
            error: (err as Error).message
          })
        } catch {
          /* window may have closed */
        }
      })
      .catch((err) =>
        log.error(`[workbench] unhandled rejection in chatStream: ${getErrorMessage(err)}`)
      )

    return { streamId }
  })

  // --- Cancel active stream ---
  safeHandle('workbench:cancelStream', async (_e, streamId) => {
    const handle = activeStreams.get(streamId)
    if (handle) {
      handle.close()
      activeStreams.delete(streamId)
      return { ok: true }
    }
    return { ok: false }
  })

  // --- AI-powered spec generation ---
  safeHandle('workbench:generateSpec', async (_e, input: { title: string; repo: string; templateHint: string }) => {
      const spec = await generateSpec(input)
      return { spec }
    }
  )

  // --- AI-powered spec checks ---
  safeHandle('workbench:checkSpec', async (_e, input: { title: string; repo: string; spec: string; specType?: string | null }) => {
      const result = await specQualityService.validateFull(input.spec)
      return mapQualityResult(result)
    }
  )

  // --- Plan extraction ---
  safeHandle('workbench:extractPlan', async (_e, markdown: string) => {
    const tasks = extractTasksFromPlan(markdown)
    return { tasks }
  })
}

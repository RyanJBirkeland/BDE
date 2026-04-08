/**
 * Task Workbench IPC handlers — AI-assisted task creation.
 */
import { safeHandle } from '../ipc-utils'
import { checkAuthStatus } from '../auth-guard'
import { getRepoPath } from '../git'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { listTasks } from '../data/sprint-queries'
import { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'
import type { AgentManager } from '../agent-manager'
import { checkSpecSemantic } from '../spec-semantic-check'
import { buildAgentPrompt } from '../agent-manager/prompt-composer'
import { runSdkStreaming, type SdkStreamingOptions } from '../sdk-streaming'
import { extractTasksFromPlan } from '../services/plan-extractor'

const execFileAsync = promisify(execFile)

/** Active streaming handles, keyed by streamId. */
const activeStreams = new Map<string, { close: () => void }>()

/** Run a single-turn SDK query (non-streaming). Returns the text response. */
async function runSdkPrint(
  prompt: string,
  timeoutMs = 120_000,
  options?: SdkStreamingOptions
): Promise<string> {
  return runSdkStreaming(prompt, () => {}, activeStreams, `print-${Date.now()}`, timeoutMs, options)
}

export function buildChatPrompt(
  messages: Array<{ role: string; content: string }>,
  formContext: { title: string; repo: string; spec: string },
  repoPath?: string
): string {
  return buildAgentPrompt({
    agentType: 'copilot',
    messages,
    formContext,
    repoPath,
    repoName: formContext.repo
  })
}

/**
 * Read-only tools the copilot may use against the target repo.
 * Anything not in this list (Edit, Write, Bash, etc.) is unavailable.
 */
export const COPILOT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob'] as const

/**
 * Defense-in-depth: tools the copilot must NEVER run, even if the SDK
 * defaults shift. Pairs with COPILOT_ALLOWED_TOOLS for read-only enforcement.
 * The denylist is intentionally broad — anything that mutates files, executes
 * commands, fetches the network, spawns subagents, or escapes the chat loop
 * must be explicitly listed here, not just absent from the allowlist.
 */
export const COPILOT_DISALLOWED_TOOLS = [
  'Edit',
  'Write',
  'Bash',
  'KillBash',
  'BashOutput',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
  'ExitPlanMode',
  'TodoWrite',
  'SlashCommand'
] as const

/**
 * Hard ceiling on per-turn copilot spend. With `maxTurns: 8` the copilot can
 * chain Read/Grep many times — without a dollar cap, a prompt-injected loop
 * could rack up real cost. The SDK aborts the query if exceeded.
 */
export const COPILOT_MAX_BUDGET_USD = 0.5

/** Maximum turns for the copilot — enough to chain Grep → Read → answer. */
export const COPILOT_MAX_TURNS = 8

/**
 * Build the SDK options used for every copilot invocation. Centralized so
 * that all IPC paths (streaming and non-streaming) get the same restricted
 * tool list, dollar ceiling, and turn limit. NEVER bypass this helper.
 */
export function getCopilotSdkOptions(
  repoPath: string | undefined,
  extras?: Pick<SdkStreamingOptions, 'onToolUse'>
): SdkStreamingOptions {
  return {
    cwd: repoPath,
    tools: [...COPILOT_ALLOWED_TOOLS],
    disallowedTools: [...COPILOT_DISALLOWED_TOOLS],
    maxTurns: COPILOT_MAX_TURNS,
    maxBudgetUsd: COPILOT_MAX_BUDGET_USD,
    ...(extras?.onToolUse ? { onToolUse: extras.onToolUse } : {})
  }
}

export function buildSpecGenerationPrompt(input: {
  title: string
  repo: string
  templateHint: string
}): string {
  const scaffold = getTemplateScaffold(input.templateHint)
  return buildQuickSpecPrompt(input.title, input.repo, input.templateHint, scaffold)
}

export function registerWorkbenchHandlers(am?: AgentManager): void {
  // --- Fully implemented: Operational readiness checks ---
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
  safeHandle(
    'workbench:generateSpec',
    async (_e, input: { title: string; repo: string; templateHint: string }) => {
      const prompt = buildSpecGenerationPrompt(input)
      try {
        const result = await runSdkPrint(prompt)
        return { spec: result || `# ${input.title}\n\n(No spec generated)` }
      } catch (err) {
        return { spec: `# ${input.title}\n\nError generating spec: ${(err as Error).message}` }
      }
    }
  )

  // --- AI-powered spec checks ---
  safeHandle(
    'workbench:checkSpec',
    async (_e, input: { title: string; repo: string; spec: string; specType?: string | null }) => {
      const summary = await checkSpecSemantic({
        ...input,
        specType: (input.specType as import('../../shared/spec-validation').SpecType) ?? null
      })
      return summary.results // Returns { clarity, scope, filesExist } — same shape as before
    }
  )

  // --- Plan extraction ---
  safeHandle('workbench:extractPlan', async (_e, markdown: string) => {
    const tasks = extractTasksFromPlan(markdown)
    return { tasks }
  })
}

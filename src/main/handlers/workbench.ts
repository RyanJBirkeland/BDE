/**
 * Task Workbench IPC handlers — AI-assisted task creation.
 */
import { safeHandle } from '../ipc-utils'
import { checkAuthStatus } from '../auth-guard'
import { getRepoPaths } from '../git'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { listTasks } from '../data/sprint-queries'
import { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'
import { buildAgentEnv } from '../env-utils'
import type { AgentManager } from '../agent-manager'
import { checkSpecSemantic } from '../spec-semantic-check'

const execFileAsync = promisify(execFile)

/** Active streaming handles, keyed by streamId. */
const activeStreams = new Map<string, { close: () => void }>()

/**
 * Run a single-turn SDK query with streaming — pushes text chunks to the
 * provided callback as they arrive. Returns the full output on completion.
 */
async function runSdkStreaming(
  prompt: string,
  onChunk: (chunk: string) => void,
  streamId: string,
  timeoutMs = 180_000
): Promise<string> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const env = buildAgentEnv()

  const queryHandle = sdk.query({
    prompt,
    options: {
      model: 'claude-sonnet-4-5',
      maxTurns: 1,
      env: env as Record<string, string>,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      settingSources: ['user', 'project', 'local']
    }
  })

  activeStreams.set(streamId, { close: () => queryHandle.return() })

  let fullText = ''
  const timer = setTimeout(() => {
    queryHandle.return()
    activeStreams.delete(streamId)
  }, timeoutMs)

  try {
    for await (const msg of queryHandle) {
      if (typeof msg !== 'object' || msg === null) continue
      const m = msg as Record<string, unknown>

      // Extract text from assistant messages
      if (m.type === 'assistant') {
        const message = m.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') {
              fullText += b.text
              onChunk(b.text)
            }
          }
        }
      }
    }
  } finally {
    clearTimeout(timer)
    activeStreams.delete(streamId)
  }

  return fullText.trim()
}

/** Run a single-turn SDK query (non-streaming). Returns the text response. */
async function runSdkPrint(prompt: string, timeoutMs = 120_000): Promise<string> {
  return runSdkStreaming(prompt, () => {}, `print-${Date.now()}`, timeoutMs)
}

export function buildChatPrompt(
  messages: Array<{ role: string; content: string }>,
  formContext: { title: string; repo: string; spec: string }
): string {
  const contextBlock = [
    `[Task Context] Title: "${formContext.title}", Repo: ${formContext.repo}`,
    formContext.spec ? `Spec draft:\n${formContext.spec}` : '(no spec yet)'
  ].join('\n')

  const history = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `You are a text-only assistant helping craft a coding agent task. You have context about the task being created.

CONSTRAINTS:
- You are a text-only assistant. You cannot open URLs, render previews, generate images, or use tools.
- Keep responses focused and under 500 words. Use markdown for structure.
- When asked to research, reference specific file paths from the codebase.
- When asked to draft spec sections, use markdown with ## headings.
- Do not promise capabilities you do not have (opening browsers, visual mockups, etc.).

${contextBlock}

---

${history}

Respond helpfully and concisely.`
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

    // Repo path check
    const repoPaths = getRepoPaths()
    const repoPath = repoPaths[repo]
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

    const repoPaths = getRepoPaths()
    const repoPath = repoPaths[repo]
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
    } catch (err: any) {
      // grep exits with code 1 when no matches found
      if (err.code === 1) {
        return {
          content: `No matches found for "${query}" in repo "${repo}"`,
          filesSearched: [],
          totalMatches: 0
        }
      }
      return {
        content: `Error searching repo: ${err.message}`,
        filesSearched: [],
        totalMatches: 0
      }
    }
  })

  // --- AI-powered chat ---
  safeHandle(
    'workbench:chat',
    async (
      _e,
      input: {
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
        formContext: { title: string; repo: string; spec: string }
      }
    ) => {
      const prompt = buildChatPrompt(input.messages, input.formContext)
      try {
        const result = await runSdkPrint(prompt)
        return { content: result || 'No response received.' }
      } catch (err) {
        return { content: `Error: ${(err as Error).message}` }
      }
    }
  )

  // --- AI-powered streaming chat ---
  safeHandle('workbench:chatStream', async (e, input) => {
    const prompt = buildChatPrompt(input.messages, input.formContext)
    const streamId = `copilot-${Date.now()}`

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
      streamId
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
      const summary = await checkSpecSemantic({ ...input, specType: (input.specType as import('../../shared/spec-validation').SpecType) ?? null })
      return summary.results // Returns { clarity, scope, filesExist } — same shape as before
    }
  )
}

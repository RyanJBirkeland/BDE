/**
 * Task Workbench IPC handlers — AI-assisted task creation.
 */
import { safeHandle } from '../ipc-utils'
import { checkAuthStatus } from '../auth-guard'
import { getRepoPaths } from '../git'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getSupabaseClient } from '../data/supabase-client'
import { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'

const execFileAsync = promisify(execFile)

function augmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`]
  env.PATH = [...extraPaths, ...(env.PATH ?? '').split(':')].filter(Boolean).join(':')
  return env
}

export function buildChatPrompt(
  messages: Array<{ role: string; content: string }>,
  formContext: { title: string; repo: string; spec: string }
): string {
  const contextBlock = [
    `[Task Context] Title: "${formContext.title}", Repo: ${formContext.repo}`,
    formContext.spec ? `Spec draft:\n${formContext.spec}` : '(no spec yet)',
  ].join('\n')

  const history = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `You are an AI assistant helping craft a coding agent task. You have context about the task being created.

${contextBlock}

---

${history}

Respond helpfully and concisely. If asked to research, reference specific file paths. If asked to draft spec sections, use markdown with ## headings.`
}

export function buildSpecGenerationPrompt(input: {
  title: string
  repo: string
  templateHint: string
}): string {
  const scaffold = getTemplateScaffold(input.templateHint)
  return buildQuickSpecPrompt(input.title, input.repo, input.templateHint, scaffold)
}

export function registerWorkbenchHandlers(): void {
  // --- Fully implemented: Operational readiness checks ---
  safeHandle('workbench:checkOperational', async (_e, input: { repo: string }) => {
    const { repo } = input

    // Auth check
    const authStatus = await checkAuthStatus()
    let authResult: { status: 'pass' | 'warn' | 'fail'; message: string }
    if (!authStatus.tokenFound) {
      authResult = { status: 'fail', message: 'No Claude subscription token found — run: claude login' }
    } else if (authStatus.tokenExpired) {
      authResult = { status: 'fail', message: 'Claude subscription token expired — run: claude login' }
    } else if (authStatus.expiresAt) {
      const hoursUntilExpiry = (authStatus.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)
      if (hoursUntilExpiry < 1) {
        authResult = { status: 'warn', message: `Token expires in ${Math.round(hoursUntilExpiry * 60)} minutes` }
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
          encoding: 'utf-8',
        })
        if (stdout.trim().length === 0) {
          gitCleanResult = { status: 'pass', message: 'Working directory clean' }
        } else {
          gitCleanResult = { status: 'warn', message: 'Uncommitted changes present (agent may conflict)' }
        }
      } catch (err) {
        gitCleanResult = { status: 'warn', message: `Unable to check git status: ${(err as Error).message}` }
      }
    } else {
      gitCleanResult = { status: 'warn', message: 'Cannot check git status (repo path not configured)' }
    }

    // Conflict check: query for other active/queued tasks on same repo
    let noConflictResult: { status: 'pass' | 'warn' | 'fail'; message: string }
    try {
      const { data, error } = await getSupabaseClient()
        .from('sprint_tasks')
        .select('status')
        .eq('repo', repo)
        .in('status', ['active', 'queued'])

      if (error) {
        noConflictResult = { status: 'warn', message: `Unable to check for conflicts: ${error.message}` }
      } else if (!data || data.length === 0) {
        noConflictResult = { status: 'pass', message: 'No conflicting tasks' }
      } else {
        const activeCount = data.filter((t) => t.status === 'active').length
        const queuedCount = data.filter((t) => t.status === 'queued').length
        if (activeCount > 0) {
          noConflictResult = { status: 'fail', message: `${activeCount} active task(s) on this repo` }
        } else {
          noConflictResult = { status: 'warn', message: `${queuedCount} queued task(s) on this repo` }
        }
      }
    } catch (err) {
      noConflictResult = { status: 'warn', message: `Error checking for conflicts: ${(err as Error).message}` }
    }

    // Agent slots available check
    let slotsAvailableResult: { status: 'pass' | 'warn'; message: string; available: number; max: number }
    const am = globalThis.__agentManager
    if (!am) {
      slotsAvailableResult = { status: 'warn', message: 'Agent manager not available', available: 0, max: 0 }
    } else {
      const status = am.getStatus()
      const available = status.concurrency ? status.concurrency.maxSlots - status.concurrency.activeCount : 0
      const max = status.concurrency?.maxSlots ?? 0
      if (available > 0) {
        slotsAvailableResult = { status: 'pass', message: `${available} of ${max} slots available`, available, max }
      } else {
        slotsAvailableResult = { status: 'warn', message: 'All agent slots occupied (task will wait in queue)', available: 0, max }
      }
    }

    return {
      auth: authResult,
      repoPath: repoPathResult,
      gitClean: gitCleanResult,
      noConflict: noConflictResult,
      slotsAvailable: slotsAvailableResult,
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
        totalMatches: 0,
      }
    }

    try {
      const { stdout } = await execFileAsync('grep', ['-rn', '-i', '--', query, '.'], {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024, // 5MB
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
          totalMatches: 0,
        }
      }
      return {
        content: `Error searching repo: ${err.message}`,
        filesSearched: [],
        totalMatches: 0,
      }
    }
  })

  // --- AI-powered chat ---
  safeHandle('workbench:chat', async (_e, input: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    formContext: { title: string; repo: string; spec: string }
  }) => {
    const prompt = buildChatPrompt(input.messages, input.formContext)
    try {
      const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
        encoding: 'utf-8',
        timeout: 60_000,
        env: augmentedEnv(),
      })
      return { content: stdout.trim() || 'No response received.' }
    } catch (err) {
      return { content: `Error: ${(err as Error).message}` }
    }
  })

  // --- AI-powered spec generation ---
  safeHandle('workbench:generateSpec', async (_e, input: { title: string; repo: string; templateHint: string }) => {
    const prompt = buildSpecGenerationPrompt(input)
    try {
      const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
        encoding: 'utf-8',
        timeout: 60_000,
        env: augmentedEnv(),
      })
      return { spec: stdout.trim() || `# ${input.title}\n\n(No spec generated)` }
    } catch (err) {
      return { spec: `# ${input.title}\n\nError generating spec: ${(err as Error).message}` }
    }
  })

  // --- AI-powered spec checks ---
  safeHandle('workbench:checkSpec', async (_e, input: { title: string; repo: string; spec: string }) => {
    const prompt = `You are reviewing a coding agent spec for quality. Return ONLY valid JSON (no markdown fencing).

Title: "${input.title}"
Repo: ${input.repo}
Spec:
${input.spec}

Assess the spec on three dimensions. For each, return status ("pass", "warn", or "fail") and a brief message.

1. clarity: Is the spec clear and actionable? Can an AI agent execute it without ambiguity?
2. scope: Is this achievable by one agent in one session? Or too broad?
3. filesExist: Are file paths specific and plausible? (You cannot verify they exist, so check if they look like real paths.)

Return JSON: {"clarity":{"status":"...","message":"..."},"scope":{"status":"...","message":"..."},"filesExist":{"status":"...","message":"..."}}`

    try {
      const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
        encoding: 'utf-8',
        timeout: 45_000,
        env: augmentedEnv(),
      })
      const parsed = JSON.parse(stdout.trim())
      return {
        clarity: parsed.clarity ?? { status: 'warn', message: 'Unable to assess clarity' },
        scope: parsed.scope ?? { status: 'warn', message: 'Unable to assess scope' },
        filesExist: parsed.filesExist ?? { status: 'warn', message: 'Unable to check files' },
      }
    } catch {
      return {
        clarity: { status: 'warn' as const, message: 'AI check unavailable' },
        scope: { status: 'warn' as const, message: 'AI check unavailable' },
        filesExist: { status: 'warn' as const, message: 'AI check unavailable' },
      }
    }
  })
}

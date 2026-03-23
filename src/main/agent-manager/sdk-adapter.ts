import type { AgentHandle } from './types'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Cache the OAuth token — Keychain access via execFileSync hangs Electron's
// main process. Read from Claude Code's credentials file on disk instead,
// with async execFile fallback.
let cachedOAuthToken: string | null = null

export function preloadOAuthToken(): void {
  try {
    const { readFileSync, existsSync } = require('node:fs')
    const { join } = require('node:path')
    const { homedir } = require('node:os')

    // Check for cached credentials file
    const credPaths = [
      join(homedir(), '.claude', 'credentials.json'),
      join(homedir(), '.claude', '.credentials.json'),
    ]

    for (const p of credPaths) {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf8')
        const payload = JSON.parse(raw)
        cachedOAuthToken = payload?.claudeAiOauth?.accessToken ?? null
        if (cachedOAuthToken) return
      }
    }

    // Fallback: read from Keychain asynchronously (non-blocking)
    const { execFile: execFileCb } = require('node:child_process')
    execFileCb('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err: Error | null, stdout: string) => {
      if (err || !stdout) return
      try {
        const payload = JSON.parse(stdout.trim())
        cachedOAuthToken = payload?.claudeAiOauth?.accessToken ?? null
      } catch { /* ignore */ }
    })
  } catch {
    cachedOAuthToken = null
  }
}

export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
}): Promise<AgentHandle> {
  const env = { ...process.env }

  // Use the pre-loaded OAuth token as ANTHROPIC_API_KEY.
  // This avoids the Keychain access hang inside Electron.
  if (cachedOAuthToken) {
    env.ANTHROPIC_API_KEY = cachedOAuthToken
  }

  // Ensure common tool paths are in PATH — Electron's PATH is often minimal
  const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`]
  const currentPath = env.PATH ?? ''
  env.PATH = [...extraPaths, ...currentPath.split(':')].filter(Boolean).join(':')

  // Try SDK first, fall back to CLI
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    return spawnViaSdk(sdk, opts, env)
  } catch {
    // SDK not available — use CLI fallback
  }

  return spawnViaCli(opts, env)
}

function spawnViaSdk(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  opts: { prompt: string; cwd: string; model: string },
  env: NodeJS.ProcessEnv,
): AgentHandle {
  const abortController = new AbortController()

  const queryResult = sdk.query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      cwd: opts.cwd,
      env: env as Record<string, string | undefined>,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController,
    },
  })

  // Extract sessionId from the first message that carries it
  let resolvedSessionId = randomUUID()

  async function* wrapMessages(): AsyncIterable<unknown> {
    for await (const msg of queryResult) {
      const m = msg as { session_id?: string }
      if (m.session_id && resolvedSessionId !== m.session_id) {
        resolvedSessionId = m.session_id as ReturnType<typeof randomUUID>
      }
      yield msg
    }
  }

  return {
    messages: wrapMessages(),
    get sessionId() {
      return resolvedSessionId
    },
    abort() {
      abortController.abort()
    },
    async steer(message: string) {
      console.warn(`[agent-manager] Steer in SDK mode is limited — message may not reach agent: "${message.slice(0, 100)}"`)
      await queryResult.interrupt()
      // Re-send via streamInput is not straightforward for a single query.
      // The interrupt signals the agent, then we log the steer message intention.
      // Full steer support requires streaming input mode; this is best-effort.
      void message
    },
  }
}

function spawnViaCli(
  opts: { prompt: string; cwd: string; model: string },
  env: NodeJS.ProcessEnv,
): AgentHandle {
  const child = spawn(
    'claude',
    [
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--model',
      opts.model,
      '--permission-mode',
      'bypassPermissions',
    ],
    {
      cwd: opts.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  const sessionId = randomUUID()

  // Send initial prompt via stdin
  child.stdin.write(
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: opts.prompt },
      parent_tool_use_id: null,
      session_id: sessionId,
    }) + '\n',
  )

  async function* parseMessages(): AsyncIterable<unknown> {
    let buffer = ''
    for await (const chunk of child.stdout) {
      buffer += (chunk as Buffer).toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          yield JSON.parse(line)
        } catch {
          /* skip non-JSON */
        }
      }
    }
  }

  return {
    messages: parseMessages(),
    sessionId,
    abort() {
      child.kill('SIGTERM')
    },
    async steer(message: string) {
      child.stdin.write(
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: message },
          parent_tool_use_id: null,
          session_id: sessionId,
        }) + '\n',
      )
    },
  }
}

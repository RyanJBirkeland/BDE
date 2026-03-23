import type { AgentHandle, Logger } from './types'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Cache the OAuth token from ~/.bde/oauth-token (written by BDE startup scripts
// or `claude login`). Keychain access (security CLI) hangs in Electron's main
// process, so we use a file-based approach instead.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

let cachedOAuthToken: string | null = null

export function preloadOAuthToken(): void {
  const tokenPath = join(homedir(), '.bde', 'oauth-token')
  try {
    if (existsSync(tokenPath)) {
      cachedOAuthToken = readFileSync(tokenPath, 'utf8').trim()
    }
  } catch {
    cachedOAuthToken = null
  }
}

export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  logger?: Logger
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
    return spawnViaSdk(sdk, opts, env, opts.logger)
  } catch {
    // SDK not available — use CLI fallback
  }

  return spawnViaCli(opts, env, opts.logger)
}

function spawnViaSdk(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  opts: { prompt: string; cwd: string; model: string },
  env: NodeJS.ProcessEnv,
  logger?: Logger,
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
      if (typeof msg === 'object' && msg !== null && 'session_id' in msg) {
        const sid = (msg as Record<string, unknown>).session_id
        if (typeof sid === 'string' && sid !== resolvedSessionId) {
          resolvedSessionId = sid as ReturnType<typeof randomUUID>
        }
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
      ;(logger ?? console).warn(`[agent-manager] Steer in SDK mode is limited — message may not reach agent: "${message.slice(0, 100)}"`)
      await queryResult.interrupt()
      // Re-send via streamInput is not straightforward for a single query.
      // The interrupt signals the agent, then we log the steer message intention.
      // Full steer support requires streaming input mode; this is best-effort.
    },
  }
}

function spawnViaCli(
  opts: { prompt: string; cwd: string; model: string },
  env: NodeJS.ProcessEnv,
  _logger?: Logger,
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

  // Drain stderr to prevent pipe buffer backpressure
  child.stderr.resume()

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
      if (!child.stdin.writable) return
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

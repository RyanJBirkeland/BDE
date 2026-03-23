import type { AgentHandle } from './types'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
}): Promise<AgentHandle> {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY // force subscription billing

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
      if (m.session_id && resolvedSessionId === resolvedSessionId) {
        resolvedSessionId = m.session_id
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

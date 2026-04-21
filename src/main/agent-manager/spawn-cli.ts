/**
 * CLI fallback agent spawn implementation.
 *
 * Spawns the `claude` binary as a child process, communicates via
 * stdin/stdout stream-json protocol, and caps V8 old-space heap.
 */
import type { AgentHandle, SteerResult } from './types'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * Per-agent V8 old-space heap cap (MB) applied to spawned Claude CLI
 * processes via NODE_OPTIONS=--max-old-space-size. Prevents 16GB machines
 * from OOMing under 8+ concurrent agents (each agent could otherwise
 * grow to 1-2GB RSS unbounded).
 */
export const AGENT_PROCESS_MAX_OLD_SPACE_MB = 1024

/**
 * Appends --max-old-space-size=<MB> to NODE_OPTIONS if not already present.
 * If the upstream env already specifies --max-old-space-size, the upstream
 * value is honored verbatim — even if it's higher OR lower than the cap.
 * This preserves caller intent (e.g. a debug session with a larger heap).
 *
 * Exported for testing.
 */
export function withMaxOldSpaceOption(existing: string | undefined, maxOldSpaceMb: number): string {
  const flag = `--max-old-space-size=${maxOldSpaceMb}`
  if (!existing || !existing.trim()) return flag
  // Avoid duplicate flag if caller already specified one
  if (/--max-old-space-size=/.test(existing)) return existing
  return `${existing} ${flag}`
}

export function spawnViaCli(
  opts: { prompt: string; cwd: string; model: string; maxBudgetUsd?: number | undefined },
  env: NodeJS.ProcessEnv,
  token: string | null,
  _logger?: unknown
): AgentHandle {
  // Set ANTHROPIC_API_KEY in env for CLI (CLI doesn't support auth parameter)
  if (token) {
    env = { ...env, ANTHROPIC_API_KEY: token }
  }

  // Cap V8 old-space heap per agent process to prevent OOM at scale.
  // Append to any pre-existing NODE_OPTIONS rather than overwriting.
  env = {
    ...env,
    NODE_OPTIONS: withMaxOldSpaceOption(env.NODE_OPTIONS, AGENT_PROCESS_MAX_OLD_SPACE_MB)
  }

  // Pass budget constraint via env var — the exact CLI flag name (--max-cost vs --budget)
  // is not verified against the binary here, so we use the env approach as a safe fallback.
  // TODO: verify --max-cost flag name against claude CLI and switch to args if confirmed.
  if (opts.maxBudgetUsd !== undefined) {
    env = { ...env, CLAUDE_MAX_COST_USD: String(opts.maxBudgetUsd) }
  }

  const child = spawn(
    'claude',
    [
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--model',
      opts.model
    ],
    {
      cwd: opts.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )

  // Cap listeners on child streams so multiple handler registrations from
  // tests or retries don't trigger Node's MaxListenersExceededWarning.
  child.stderr.setMaxListeners(5)

  // Capture stderr line-by-line and forward via onStderr callback
  let stderrBuffer = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString()
    const lines = stderrBuffer.split('\n')
    stderrBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && handle.onStderr) {
        handle.onStderr(trimmed)
      }
    }
  })
  child.stderr.on('end', () => {
    const trimmed = stderrBuffer.trim()
    if (trimmed && handle.onStderr) {
      handle.onStderr(trimmed)
    }
    stderrBuffer = ''
  })

  const sessionId = randomUUID()
  let exitCode: number | null = null

  // Track child process exit to expose exit code
  child.on('exit', (code) => {
    exitCode = code
  })

  // Send initial prompt via stdin
  child.stdin.write(
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: opts.prompt },
      parent_tool_use_id: null,
      session_id: sessionId
    }) + '\n'
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
    // After stdout ends, yield exit_code message if process exited
    if (exitCode !== null) {
      yield { type: 'exit_code', exit_code: exitCode }
    }
  }

  const handle: AgentHandle = {
    messages: parseMessages(),
    sessionId,
    abort() {
      child.kill('SIGTERM')
    },
    async steer(message: string): Promise<SteerResult> {
      try {
        if (!child.stdin.writable) {
          return { delivered: false, error: 'Agent stdin is no longer writable' }
        }
        child.stdin.write(
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: message },
            parent_tool_use_id: null,
            session_id: sessionId
          }) + '\n'
        )
        return { delivered: true }
      } catch (err) {
        return { delivered: false, error: String(err) }
      }
    }
  }

  return handle
}

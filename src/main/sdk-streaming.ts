/**
 * Shared SDK streaming utilities for Claude Agent SDK.
 */
import { buildAgentEnvWithAuth } from './env-utils'

/**
 * A tool-use event observed during streaming. Used to surface what the
 * agent is reading/searching to the UI so users can see it is grounded.
 */
export interface ToolUseEvent {
  name: string
  input: Record<string, unknown>
}

/**
 * Options for `runSdkStreaming`. Backwards-compatible — all optional.
 */
export interface SdkStreamingOptions {
  /** Working directory for the SDK session — used as the root for tool calls. */
  cwd?: string
  /**
   * Restrict the base set of tools available to the model. Pass `[]` to
   * disable all tools, or e.g. `['Read', 'Grep', 'Glob']` for read-only.
   * If omitted, the SDK uses its default Claude Code preset.
   */
  tools?: string[]
  /**
   * Defense-in-depth list of tools that must NEVER run, even if otherwise
   * allowed. Combined with `tools` for read-only enforcement.
   */
  disallowedTools?: string[]
  /** Maximum number of agent turns. Defaults to 1 (single-shot). */
  maxTurns?: number
  /** Optional callback fired whenever the agent invokes a tool. */
  onToolUse?: (event: ToolUseEvent) => void
}

/**
 * Run a single-turn SDK query with streaming — pushes text chunks to the
 * provided callback as they arrive. Returns the full output on completion.
 *
 * @param prompt - The prompt to send to the agent
 * @param onChunk - Callback invoked for each text chunk received
 * @param activeStreams - Map to track active streams for cancellation
 * @param streamId - Unique identifier for this stream
 * @param timeoutMs - Timeout in milliseconds (default: 180 seconds)
 * @param options - Optional SDK options (cwd, tool restriction, tool-use callback)
 * @returns The full text response after streaming completes
 */
export async function runSdkStreaming(
  prompt: string,
  onChunk: (chunk: string) => void,
  activeStreams: Map<string, { close: () => void }>,
  streamId: string,
  timeoutMs = 180_000,
  options: SdkStreamingOptions = {}
): Promise<string> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const env = buildAgentEnvWithAuth()

  const queryHandle = sdk.query({
    prompt,
    options: {
      model: 'claude-sonnet-4-5',
      maxTurns: options.maxTurns ?? 1,
      env: env as Record<string, string>,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      settingSources: ['user', 'project', 'local'],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
      ...(options.disallowedTools && options.disallowedTools.length > 0
        ? { disallowedTools: options.disallowedTools }
        : {})
    }
  })

  activeStreams.set(streamId, { close: () => queryHandle.return() })

  let fullText = ''
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    queryHandle.return()
    activeStreams.delete(streamId)
  }, timeoutMs)

  try {
    for await (const msg of queryHandle) {
      if (typeof msg !== 'object' || msg === null) continue
      const m = msg as Record<string, unknown>

      // Extract text and tool_use blocks from assistant messages
      if (m.type === 'assistant') {
        const message = m.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') {
              fullText += b.text
              onChunk(b.text)
            } else if (b.type === 'tool_use' && options.onToolUse) {
              const name = typeof b.name === 'string' ? b.name : 'unknown'
              const inputObj =
                b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {}
              options.onToolUse({ name, input: inputObj })
            }
          }
        }
      }
    }
  } finally {
    clearTimeout(timer)
    activeStreams.delete(streamId)
  }

  if (timedOut && !fullText.trim()) {
    throw new Error(`SDK streaming timed out after ${timeoutMs / 1000}s with no output`)
  }

  return fullText.trim()
}

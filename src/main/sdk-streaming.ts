/**
 * Shared SDK streaming utilities for Claude Agent SDK.
 */
import { buildAgentEnvWithAuth, getClaudeCliPath } from './env-utils'
import { asSDKMessage } from './agent-manager/sdk-adapter'

/**
 * A tool-use event observed during streaming. Used to surface what the
 * agent is reading/searching to the UI so users can see it is grounded.
 */
export interface ToolUseEvent {
  name: string
  input: Record<string, unknown>
}

/**
 * Options for `runSdkStreaming`.
 */
export interface SdkStreamingOptions {
  /** Working directory for the SDK session — used as the root for tool calls. */
  cwd?: string | undefined
  /**
   * Restrict the base set of tools available to the model. Pass `[]` to
   * disable all tools, or e.g. `['Read', 'Grep', 'Glob']` for read-only.
   * If omitted, the SDK uses its default Claude Code preset.
   */
  tools?: string[] | undefined
  /**
   * Defense-in-depth list of tools that must NEVER run, even if otherwise
   * allowed. Combined with `tools` for read-only enforcement.
   */
  disallowedTools?: string[] | undefined
  /** Maximum number of agent turns. Defaults to 1 (single-shot). */
  maxTurns?: number | undefined
  /**
   * Maximum spend in USD for this query. The SDK aborts if exceeded. Use this
   * as a hard ceiling on prompt-injected loops or runaway tool chains.
   */
  maxBudgetUsd?: number | undefined
  /** Optional callback fired whenever the agent invokes a tool. */
  onToolUse?: ((event: ToolUseEvent) => void) | undefined
  /**
   * Claude Code settings sources to load. Pass `[]` for spec-drafting agents
   * (copilot/synthesizer) to skip CLAUDE.md — they receive conventions via
   * their prompt instead, and loading the project settings file costs tokens
   * and can mislead them with implementation-focused guidelines.
   * Defaults to `['user', 'project', 'local']`.
   */
  settingSources?: Array<'user' | 'project' | 'local'> | undefined
  /**
   * Model ID to use for this query. Required — every call site must resolve
   * from `agents.backendConfig` via `resolveAgentRuntime(type).model` rather
   * than rely on a silent default.
   */
  model: string
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
  options: SdkStreamingOptions
): Promise<string> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const env = buildAgentEnvWithAuth()

  const queryHandle = sdk.query({
    prompt,
    options: {
      model: options.model,
      maxTurns: options.maxTurns ?? 1,
      env: env as Record<string, string>,
      pathToClaudeCodeExecutable: getClaudeCliPath(),
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      settingSources: options.settingSources ?? ['user', 'project', 'local'],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
      // Always forward disallowedTools when provided — empty array is a valid
      // (no-op) denylist and we want call sites to be explicit.
      ...(options.disallowedTools !== undefined
        ? { disallowedTools: options.disallowedTools }
        : {}),
      ...(options.maxBudgetUsd !== undefined ? { maxBudgetUsd: options.maxBudgetUsd } : {})
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
      const sdkMsg = asSDKMessage(msg)
      if (!sdkMsg) continue

      // Extract text and tool_use blocks from assistant messages
      if (sdkMsg.type === 'assistant') {
        const content = sdkMsg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== 'object') continue
            if (block.type === 'text' && typeof block.text === 'string') {
              fullText += block.text
              onChunk(block.text)
            } else if (block.type === 'tool_use' && options.onToolUse) {
              const name = typeof block.name === 'string' ? block.name : 'unknown'
              const inputObj = block.input && typeof block.input === 'object' ? block.input : {}
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

/**
 * Single-shot SDK call with no streaming callback — collects the full text and
 * returns it. Intended for JSON-mode agents (e.g. the reviewer auto-review pass)
 * where chunk-by-chunk rendering is not needed.
 *
 * @param prompt - The prompt to send
 * @param options - SDK options; `tools: []` disables all tools
 * @param timeoutMs - Timeout in milliseconds (default: 120 seconds)
 */
export async function runSdkOnce(
  prompt: string,
  options: SdkStreamingOptions,
  timeoutMs = 120_000
): Promise<string> {
  // Reuse runSdkStreaming by supplying a no-op onChunk. Tracking map is local.
  const activeStreams = new Map<string, { close: () => void }>()
  const streamId = `once-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return runSdkStreaming(prompt, () => {}, activeStreams, streamId, timeoutMs, options)
}

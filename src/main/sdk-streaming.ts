/**
 * Shared SDK streaming utilities for Claude Agent SDK.
 */
import { buildAgentEnvWithAuth } from './env-utils'

/**
 * Run a single-turn SDK query with streaming — pushes text chunks to the
 * provided callback as they arrive. Returns the full output on completion.
 *
 * @param prompt - The prompt to send to the agent
 * @param onChunk - Callback invoked for each text chunk received
 * @param activeStreams - Map to track active streams for cancellation
 * @param streamId - Unique identifier for this stream
 * @param timeoutMs - Timeout in milliseconds (default: 180 seconds)
 * @returns The full text response after streaming completes
 */
export async function runSdkStreaming(
  prompt: string,
  onChunk: (chunk: string) => void,
  activeStreams: Map<string, { close: () => void }>,
  streamId: string,
  timeoutMs = 180_000
): Promise<string> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const env = buildAgentEnvWithAuth()

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

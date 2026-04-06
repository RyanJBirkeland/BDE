/**
 * Extract test-run invocations from an agent event stream.
 *
 * Pairs `agent:tool_call` (Bash with a test command) with the subsequent
 * `agent:tool_result` for the same tool, returning the output text. Used by
 * the Review Detail "Tests" tab to surface the last test run without
 * forcing the user to scroll through hundreds of conversation events.
 */
import type { AgentEvent } from '../../../shared/types'

export interface TestRun {
  command: string
  output: string
  success: boolean
  timestamp: number
}

const TEST_COMMAND_PATTERN =
  /\b(npm (run )?test|yarn test|pnpm (run )?test|npx\s+vitest|vitest|jest|pytest|cargo test|go test)\b/i

function bashCommand(input: unknown): string {
  if (input && typeof input === 'object' && 'command' in input) {
    const cmd = (input as { command: unknown }).command
    if (typeof cmd === 'string') return cmd
  }
  return ''
}

function stringifyOutput(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object') {
    // Claude Code tool results often shape as { content: [{ type: 'text', text }] }
    const obj = output as Record<string, unknown>
    if (Array.isArray(obj.content)) {
      const parts = obj.content
        .map((c) => {
          if (c && typeof c === 'object' && 'text' in c) {
            const t = (c as { text: unknown }).text
            return typeof t === 'string' ? t : ''
          }
          return ''
        })
        .filter(Boolean)
      if (parts.length > 0) return parts.join('\n')
    }
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return String(output)
    }
  }
  return String(output)
}

/**
 * Walk the event stream, returning every Bash test-command invocation
 * with its captured output (if present). Returned in chronological order.
 */
export function extractTestRuns(events: readonly AgentEvent[] | undefined): TestRun[] {
  if (!events || events.length === 0) return []

  const runs: TestRun[] = []

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev.type !== 'agent:tool_call' || ev.tool !== 'Bash') continue
    const cmd = bashCommand(ev.input)
    if (!TEST_COMMAND_PATTERN.test(cmd)) continue

    // Look ahead for the matching tool_result (first Bash result after this call).
    let output = ''
    let success = true
    for (let j = i + 1; j < events.length; j++) {
      const next = events[j]
      if (next.type === 'agent:tool_result' && next.tool === 'Bash') {
        output = stringifyOutput(next.output) || next.summary || ''
        success = next.success
        break
      }
      // If another tool_call starts before we find a result, still bail.
      if (next.type === 'agent:tool_call') break
    }

    runs.push({
      command: cmd,
      output,
      success,
      timestamp: ev.timestamp
    })
  }

  return runs
}

/**
 * Return only the most recent test run, or null if none. Convenience wrapper
 * for the common case of "show me the final test output".
 */
export function extractLatestTestRun(events: readonly AgentEvent[] | undefined): TestRun | null {
  const runs = extractTestRuns(events)
  return runs.length > 0 ? runs[runs.length - 1] : null
}

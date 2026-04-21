/**
 * Derive a user-facing "phase" label from the agent's recent events.
 *
 * Looks back from the most recent event and maps it to a short status word
 * (e.g. "Exploring code", "Running tests") so the user gets a sense of what
 * the agent is actively doing right now.
 */
import type { AgentEvent } from '../../../shared/types'

export type AgentPhase =
  | 'Exploring code'
  | 'Writing code'
  | 'Running tests'
  | 'Committing'
  | 'Thinking'
  | 'Idle'

const EXPLORE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** How far back (ms) an event is considered "recent" for phase detection. */
const RECENT_WINDOW_MS = 60_000

function bashCommand(input: unknown): string {
  if (input && typeof input === 'object' && 'command' in input) {
    const cmd = (input as { command: unknown }).command
    if (typeof cmd === 'string') return cmd
  }
  return ''
}

/**
 * Return a phase label based on the latest meaningful event. Pure function —
 * exported separately from components so it can be unit-tested.
 */
export function derivePhaseLabel(
  events: readonly AgentEvent[] | undefined,
  now: number = Date.now()
): AgentPhase {
  if (!events || events.length === 0) return 'Idle'

  // Walk from most recent backward until we find a classifiable event.
  // Assumes events are loosely time-ordered (the SDK appends in order, so this
  // holds in practice). If out-of-order events become a concern, sort by
  // timestamp first — we exit on the first event outside RECENT_WINDOW_MS.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (!ev) continue
    if (now - ev.timestamp > RECENT_WINDOW_MS) return 'Idle'

    if (ev.type === 'agent:tool_call') {
      if (ev.tool === 'Bash') {
        const cmd = bashCommand(ev.input).toLowerCase()
        if (cmd.includes('git commit')) return 'Committing'
        if (/\b(npm (run )?test|vitest|jest|pytest|cargo test|go test)\b/.test(cmd)) {
          return 'Running tests'
        }
        // Unknown bash command — keep scanning for a more specific signal.
        continue
      }
      if (EXPLORE_TOOLS.has(ev.tool)) return 'Exploring code'
      if (WRITE_TOOLS.has(ev.tool)) return 'Writing code'
      continue
    }

    if (ev.type === 'agent:text' || ev.type === 'agent:thinking') {
      return 'Thinking'
    }
  }

  return 'Idle'
}

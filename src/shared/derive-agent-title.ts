/**
 * Derive a human-readable title from an agent task string.
 * Strips known preambles and extracts the first meaningful line.
 */

const KNOWN_PREAMBLES = [
  'You are a BDE (Birkeland Development Environment) agent.',
  "You are a Claude agent, built on Anthropic's Claude Agent SDK."
]

/**
 * Derive a display title for an agent from its task string.
 * @param task - The full task/prompt string
 * @param _source - The agent source type ('adhoc' | 'bde' | 'external') - reserved for future use
 * @returns A human-readable title (max 120 chars)
 */
export function deriveAgentTitle(task: string, _source: 'adhoc' | 'bde' | 'external'): string {
  if (!task || task.trim().length === 0) {
    return 'Untitled agent'
  }

  let working = task.trim()

  // Strip known preambles
  for (const preamble of KNOWN_PREAMBLES) {
    if (working.startsWith(preamble)) {
      working = working.slice(preamble.length).trim()
    }
  }

  // Extract first non-empty line
  const lines = working.split('\n').map((l) => l.trim())
  const firstLine = lines.find((l) => l.length > 0)

  if (!firstLine) {
    return 'Untitled agent'
  }

  // Cap at 120 characters
  if (firstLine.length <= 120) {
    return firstLine
  }

  return firstLine.slice(0, 117) + '...'
}

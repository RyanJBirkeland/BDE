/**
 * Helpers for the Task Workbench copilot UI.
 *
 * The keyword-matched research helpers (`isResearchQuery`, `extractSearchTerms`)
 * are kept for backward compatibility with the legacy `workbench:researchRepo`
 * IPC fallback path. The active copilot now has read-only Read/Grep/Glob tool
 * access and does its own research natively, so these are no longer wired into
 * `WorkbenchCopilot.tsx` for new requests.
 */

const RESEARCH_PATTERNS = [/research|search|find|look for|grep|where is|which file|show me/i]

/**
 * @deprecated Copilot now has native Read/Grep/Glob access; kept for back-compat.
 */
export function isResearchQuery(text: string): boolean {
  return RESEARCH_PATTERNS.some((p) => p.test(text))
}

/**
 * @deprecated Copilot now has native Read/Grep/Glob access; kept for back-compat.
 */
export function extractSearchTerms(text: string): string {
  return text
    .replace(
      /^(research|search|find|look for|grep|where is|which file|show me)\s*(the\s+)?(codebase\s+)?(for\s+)?/i,
      ''
    )
    .trim()
}

/**
 * Format a tool-use event from the copilot into a compact human-readable
 * string for the chat transcript. Examples:
 *   - "Reading src/main/handlers/git-handlers.ts"
 *   - "Searching for 'IPC channel'"
 *   - "Globbing **\/*.ts"
 */
export function formatToolUse(name: string, input: Record<string, unknown>): string {
  const str = (key: string): string | undefined => {
    const v = input[key]
    return typeof v === 'string' ? v : undefined
  }

  switch (name) {
    case 'Read': {
      const path = str('file_path') ?? str('path') ?? 'file'
      return `Reading ${shortenPath(path)}`
    }
    case 'Grep': {
      const pattern = str('pattern') ?? '?'
      const path = str('path')
      return path
        ? `Searching for "${pattern}" in ${shortenPath(path)}`
        : `Searching for "${pattern}"`
    }
    case 'Glob': {
      const pattern = str('pattern') ?? '?'
      return `Globbing ${pattern}`
    }
    default:
      return `Using ${name}`
  }
}

/**
 * Shorten an absolute path to its last 3 segments for compact display.
 */
function shortenPath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 3) return path
  return '…/' + segments.slice(-3).join('/')
}

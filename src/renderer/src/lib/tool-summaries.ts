/**
 * Formats tool call inputs into human-readable summaries.
 * Surfaces the most useful information (file paths, commands, patterns)
 * to avoid forcing users to expand raw JSON for common cases.
 */

/**
 * Truncates a string to maxLen characters, appending "..." if truncated.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '...'
}

/**
 * Safely reads a property from an unknown object.
 */
function getProp(obj: unknown, key: string): unknown {
  if (obj && typeof obj === 'object' && key in obj) {
    return (obj as Record<string, unknown>)[key]
  }
  return undefined
}

/**
 * Formats a tool call input into a human-readable summary line.
 * Returns null if the tool is unknown or the input doesn't match expected shape.
 */
export function formatToolSummary(tool: string, input: unknown): string | null {
  const toolLower = tool.toLowerCase()

  switch (toolLower) {
    case 'bash': {
      const command = getProp(input, 'command')
      if (typeof command === 'string') {
        return truncate(command, 100)
      }
      return null
    }

    case 'read': {
      const filePath = getProp(input, 'file_path')
      if (typeof filePath !== 'string') return null

      const offset = getProp(input, 'offset')
      const limit = getProp(input, 'limit')

      if (typeof offset === 'number' && typeof limit === 'number') {
        const end = offset + limit - 1
        return `${filePath}:${offset}-${end}`
      }
      if (typeof offset === 'number') {
        return `${filePath}:${offset}`
      }
      return filePath
    }

    case 'edit': {
      const filePath = getProp(input, 'file_path')
      const oldString = getProp(input, 'old_string')
      const newString = getProp(input, 'new_string')

      if (
        typeof filePath !== 'string' ||
        typeof oldString !== 'string' ||
        typeof newString !== 'string'
      ) {
        return null
      }

      const oldTrunc = truncate(oldString, 30)
      const newTrunc = truncate(newString, 30)
      return `${filePath} — replace "${oldTrunc}" → "${newTrunc}"`
    }

    case 'write': {
      const filePath = getProp(input, 'file_path')
      const content = getProp(input, 'content')

      if (typeof filePath !== 'string' || typeof content !== 'string') {
        return null
      }

      const chars = content.length
      return `${filePath} (${chars.toLocaleString()} chars)`
    }

    case 'grep': {
      const pattern = getProp(input, 'pattern')
      const path = getProp(input, 'path')

      if (typeof pattern !== 'string') return null

      if (typeof path === 'string') {
        return `pattern "${pattern}" in ${path}`
      }
      return `pattern "${pattern}"`
    }

    case 'glob': {
      const pattern = getProp(input, 'pattern')
      if (typeof pattern === 'string') {
        return pattern
      }
      return null
    }

    case 'agent': {
      const prompt = getProp(input, 'prompt')
      if (typeof prompt === 'string') {
        return truncate(prompt, 80)
      }
      return null
    }

    default:
      return null
  }
}

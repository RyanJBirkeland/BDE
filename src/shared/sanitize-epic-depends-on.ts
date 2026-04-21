import type { EpicDependency } from './types'

const VALID_CONDITIONS: ReadonlySet<EpicDependency['condition']> = new Set([
  'on_success',
  'always',
  'manual'
])

function isValidEpicDependency(candidate: unknown): candidate is EpicDependency {
  if (!candidate || typeof candidate !== 'object') return false
  const { id, condition } = candidate as Record<string, unknown>
  if (typeof id !== 'string' || !id.trim()) return false
  if (typeof condition !== 'string') return false
  return VALID_CONDITIONS.has(condition as EpicDependency['condition'])
}

/**
 * Sanitize a task_groups.depends_on value into a strongly-typed EpicDependency array.
 * Accepts JSON strings, arrays, or null/undefined. Invalid entries are filtered out;
 * invalid shapes return an empty array rather than throwing.
 */
export function sanitizeEpicDependsOn(value: unknown): EpicDependency[] {
  if (value == null) return []

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return []
    try {
      return sanitizeEpicDependsOn(JSON.parse(trimmed))
    } catch (err) {
      console.error('[sanitizeEpicDependsOn] Failed to parse depends_on string:', value, err)
      return []
    }
  }

  if (Array.isArray(value)) {
    return value.filter(isValidEpicDependency)
  }

  console.error('[sanitizeEpicDependsOn] Invalid depends_on type:', typeof value, value)
  return []
}

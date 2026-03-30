import type { TaskDependency } from './types'

/**
 * Sanitize depends_on field to prevent crashes when Supabase returns JSONB as string.
 * Ensures the field is always null or a valid TaskDependency array.
 */
export function sanitizeDependsOn(value: unknown): TaskDependency[] | null {
  // Handle null/undefined
  if (value == null) return null

  // If it's a string, try to parse it
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    try {
      const parsed = JSON.parse(value)
      return sanitizeDependsOn(parsed) // Recursive call
    } catch (err) {
      console.error('[sanitizeDependsOn] Failed to parse depends_on string:', value, err)
      return null
    }
  }

  // If it's an array, validate structure
  if (Array.isArray(value)) {
    if (value.length === 0) return null

    const validated = value.filter((dep) => {
      if (!dep || typeof dep !== 'object') return false
      const { id, type } = dep as Record<string, unknown>
      if (typeof id !== 'string' || !id.trim()) return false
      if (type !== 'hard' && type !== 'soft') return false
      return true
    })

    return validated.length > 0 ? (validated as TaskDependency[]) : null
  }

  // Invalid type
  console.error('[sanitizeDependsOn] Invalid depends_on type:', typeof value, value)
  return null
}

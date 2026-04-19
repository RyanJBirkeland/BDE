/**
 * Sanitize tags field to handle JSON deserialization from SQLite TEXT column.
 * Ensures the field is always null or a valid string array.
 */
export function sanitizeTags(value: unknown): string[] | null {
  // Handle null/undefined
  if (value == null) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    try {
      return sanitizeTags(JSON.parse(trimmed))
    } catch {
      // Legacy CSV format: tags seeded via direct SQL inserts bypass JSON.stringify.
      return sanitizeTags(trimmed.split(',').map((tag) => tag.trim()))
    }
  }

  // If it's an array, validate structure
  if (Array.isArray(value)) {
    if (value.length === 0) return null

    const validated = value.filter((tag) => typeof tag === 'string' && tag.trim() !== '')

    return validated.length > 0 ? (validated as string[]) : null
  }

  // Invalid type
  console.error('[sanitizeTags] Invalid tags type:', typeof value, value)
  return null
}

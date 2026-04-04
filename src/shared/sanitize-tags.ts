/**
 * Sanitize tags field to handle JSON deserialization from SQLite TEXT column.
 * Ensures the field is always null or a valid string array.
 */
export function sanitizeTags(value: unknown): string[] | null {
  // Handle null/undefined
  if (value == null) return null

  // If it's a string, try to parse it
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    try {
      const parsed = JSON.parse(value)
      return sanitizeTags(parsed) // Recursive call
    } catch (err) {
      console.error('[sanitizeTags] Failed to parse tags string:', value, err)
      return null
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

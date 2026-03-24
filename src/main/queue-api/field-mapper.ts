const CAMEL_TO_SNAKE: Record<string, string> = {
  agentRunId: 'agent_run_id', prUrl: 'pr_url', prNumber: 'pr_number',
  prStatus: 'pr_status', prMergeableState: 'pr_mergeable_state',
  retryCount: 'retry_count', fastFailCount: 'fast_fail_count',
  repoPath: 'repo_path', ghRepo: 'gh_repo', dependsOn: 'depends_on',
  startedAt: 'started_at', completedAt: 'completed_at',
  createdAt: 'created_at', updatedAt: 'updated_at',
  claimedBy: 'claimed_by', templateName: 'template_name',
}

const SNAKE_TO_CAMEL = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([c, s]) => [s, c])
)

// JSONB columns that need parsing if they come back as strings
const JSONB_FIELDS = new Set(['depends_on'])

/**
 * Sanitize depends_on field to ensure it's always null or a valid array.
 * Handles cases where Supabase returns JSONB as string.
 */
function sanitizeDependsOn(value: unknown): Array<{ id: string; type: 'hard' | 'soft' }> | null {
  // Handle null/undefined
  if (value == null) return null

  // If it's a string, try to parse it
  if (typeof value === 'string') {
    // Handle empty string
    if (value.trim() === '') return null

    try {
      const parsed = JSON.parse(value)
      return sanitizeDependsOn(parsed) // Recursive call with parsed value
    } catch {
      console.warn('[field-mapper] Failed to parse depends_on string:', value)
      return null
    }
  }

  // If it's an array, validate structure
  if (Array.isArray(value)) {
    // Empty array -> null for consistency
    if (value.length === 0) return null

    // Validate each dependency object
    const validated = value.filter((dep) => {
      if (!dep || typeof dep !== 'object') return false
      const { id, type } = dep as Record<string, unknown>
      if (typeof id !== 'string' || !id.trim()) return false
      if (type !== 'hard' && type !== 'soft') return false
      return true
    })

    return validated.length > 0 ? validated as Array<{ id: string; type: 'hard' | 'soft' }> : null
  }

  // Invalid type - log warning and return null
  console.warn('[field-mapper] Invalid depends_on type:', typeof value, value)
  return null
}

export function toCamelCase<T extends object>(row: T): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = SNAKE_TO_CAMEL[key] ?? key

    // Special handling for depends_on to ensure it's always valid
    if (key === 'depends_on') {
      result[camelKey] = sanitizeDependsOn(value)
    } else if (JSONB_FIELDS.has(key) && typeof value === 'string') {
      // Generic JSONB parsing for other fields
      try {
        result[camelKey] = JSON.parse(value)
      } catch {
        // If parse fails, pass through as-is (likely already null or undefined)
        result[camelKey] = value
      }
    } else {
      result[camelKey] = value
    }
  }
  return result
}

export function toSnakeCase<T extends object>(fields: T): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    const snakeKey = CAMEL_TO_SNAKE[key] ?? key

    // Ensure JSONB fields stay as objects/arrays, not stringified
    // (Supabase client handles JSONB serialization automatically)
    result[snakeKey] = value
  }
  return result
}

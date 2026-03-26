import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'

const CAMEL_TO_SNAKE: Record<string, string> = {
  agentRunId: 'agent_run_id',
  prUrl: 'pr_url',
  prNumber: 'pr_number',
  prStatus: 'pr_status',
  prMergeableState: 'pr_mergeable_state',
  retryCount: 'retry_count',
  fastFailCount: 'fast_fail_count',
  repoPath: 'repo_path',
  ghRepo: 'gh_repo',
  dependsOn: 'depends_on',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  claimedBy: 'claimed_by',
  templateName: 'template_name',
  playgroundEnabled: 'playground_enabled',
  maxRuntimeMs: 'max_runtime_ms',
  needsReview: 'needs_review'
}

const SNAKE_TO_CAMEL = Object.fromEntries(Object.entries(CAMEL_TO_SNAKE).map(([c, s]) => [s, c]))

// JSONB columns that need parsing if they come back as strings
const JSONB_FIELDS = new Set(['depends_on'])

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

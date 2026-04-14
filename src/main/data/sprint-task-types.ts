// --- Field allowlist for updates ---

export const UPDATE_ALLOWLIST = new Set([
  'title',
  'prompt',
  'repo',
  'status',
  'priority',
  'spec',
  'notes',
  'pr_url',
  'pr_number',
  'pr_status',
  'pr_mergeable_state',
  'agent_run_id',
  'retry_count',
  'fast_fail_count',
  'started_at',
  'completed_at',
  'template_name',
  'claimed_by',
  'depends_on',
  'playground_enabled',
  'needs_review',
  'max_runtime_ms',
  'spec_type',
  'worktree_path',
  'session_id',
  'next_eligible_at',
  'model',
  'tags',
  'retry_context',
  'failure_reason',
  'max_cost_usd',
  'partial_diff',
  'group_id',
  'duration_ms',
  'cross_repo_contract',
  'revision_feedback',
  'review_diff_snapshot'
])

// Whitelist Map for defense-in-depth column validation
export const COLUMN_MAP = new Map<string, string>(
  Array.from(UPDATE_ALLOWLIST).map((col) => [col, col])
)

// Module-load assertion: COLUMN_MAP must match UPDATE_ALLOWLIST exactly
if (COLUMN_MAP.size !== UPDATE_ALLOWLIST.size) {
  throw new Error('COLUMN_MAP/UPDATE_ALLOWLIST mismatch')
}

export interface QueueStats {
  [key: string]: number
  backlog: number
  queued: number
  active: number
  review: number
  done: number
  failed: number
  cancelled: number
  error: number
  blocked: number
}

export interface CreateTaskInput {
  title: string
  repo: string
  prompt?: string
  notes?: string
  spec?: string
  priority?: number
  status?: string
  template_name?: string
  depends_on?: Array<{ id: string; type: 'hard' | 'soft' }> | null
  playground_enabled?: boolean
  model?: string
  tags?: string[] | null
  group_id?: string | null
  cross_repo_contract?: string | null
}

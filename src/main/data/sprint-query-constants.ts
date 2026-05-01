/**
 * Shared constants for sprint task queries.
 * Extracted to eliminate duplication across query functions.
 *
 * WARNING: Do NOT use `SELECT *` against `sprint_tasks`. Always project columns
 * via `SPRINT_TASK_COLUMNS` (full row) or `SPRINT_TASK_LIST_COLUMNS` (excludes
 * the `review_diff_snapshot` blob). The snapshot blob can reach hundreds of
 * kilobytes; transferring it on list/poll paths dominates renderer poll cost.
 * `getGroupTasks` and `listTasksRecent` are list paths — use the LIST variant.
 */

/**
 * Complete column list for sprint_tasks table SELECT queries.
 * Used for single-row reads and audit-trail comparisons that need the full
 * task shape, including the heavy `review_diff_snapshot` JSON blob.
 */
export const SPRINT_TASK_COLUMNS = `id, title, prompt, repo, status, priority, depends_on, spec, notes,
  pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
  retry_count, fast_fail_count, started_at, completed_at, claimed_by,
  template_name, playground_enabled, needs_review, max_runtime_ms,
  spec_type, created_at, updated_at, worktree_path, session_id,
  next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
  partial_diff, assigned_reviewer, tags, sprint_id, group_id, duration_ms,
  revision_feedback, review_diff_snapshot, promoted_to_review_at,
  rebase_base_sha, rebased_at, orphan_recovery_count`

/**
 * Column list for list/poll-path SELECT queries.
 * Excludes `review_diff_snapshot` — a JSON blob that can reach hundreds of
 * kilobytes per row. Renderer polls (every 30s) and PR-poller cycles (every
 * 60s) read every active task; transferring the snapshot on every poll is the
 * dominant cost. Code Review Station fetches the snapshot on demand from the
 * task's worktree, so list paths never need it.
 */
export const SPRINT_TASK_LIST_COLUMNS = `id, title, prompt, repo, status, priority, depends_on, spec, notes,
  pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id,
  retry_count, fast_fail_count, started_at, completed_at, claimed_by,
  template_name, playground_enabled, needs_review, max_runtime_ms,
  spec_type, created_at, updated_at, worktree_path, session_id,
  next_eligible_at, model, retry_context, failure_reason, max_cost_usd,
  partial_diff, assigned_reviewer, tags, sprint_id, group_id, duration_ms,
  revision_feedback, promoted_to_review_at, rebase_base_sha, rebased_at, orphan_recovery_count`

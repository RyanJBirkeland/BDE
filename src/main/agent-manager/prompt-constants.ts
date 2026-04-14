/**
 * prompt-constants.ts — Shared truncation limits for all prompt builders.
 *
 * Single source of truth. Import from here rather than scattering magic numbers.
 */

/**
 * Maximum character counts for truncating user-supplied content before
 * injecting into agent prompts.
 *
 * TASK_SPEC_CHARS: 8000 chars (~2000 words) covers CLAUDE.md's "under 500 words"
 * guideline with headroom for Files to Change, How to Test, and Out of Scope sections.
 *
 * UPSTREAM_SPEC_CHARS: 2000 chars per upstream task spec summary. Upstream specs are
 * context only — the agent needs to know what was built, not every implementation detail.
 * 2000 chars captures the Overview + Files to Change sections of a well-formed spec
 * without bloating the prompt with the full implementation narrative of every dependency.
 *
 * UPSTREAM_DIFF_CHARS: 2000 chars per upstream diff. Diffs are partial context for
 * understanding what changed, not a complete code review. 2000 chars covers the most
 * relevant hunks without exceeding the prompt budget for tasks with multiple upstream
 * dependencies.
 */
export const PROMPT_TRUNCATION = {
  TASK_SPEC_CHARS: 8000,
  UPSTREAM_SPEC_CHARS: 2000,
  UPSTREAM_DIFF_CHARS: 2000,
} as const

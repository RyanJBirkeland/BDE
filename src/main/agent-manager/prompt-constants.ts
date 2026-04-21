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
 *
 * PRIOR_SCRATCHPAD_CHARS: 3000 chars — caps progress.md verbosity on retries.
 * A verbose agent writing stack traces across a failed run can produce 100KB+
 * of scratchpad; injected verbatim into the next attempt bloats the prompt.
 *
 * RETRY_NOTES_CHARS: 1500 chars — caps failure note verbosity in retry context.
 *
 * CROSS_REPO_CONTRACT_CHARS: 5000 chars — cross-repo contracts can be full
 * OpenAPI specs; cap prevents prompt inflation on complex integrations.
 *
 * SYNTHESIZER_CODEBASE_CONTEXT_CHARS: 4000 chars — file tree + code snippets
 * passed to synthesizer; enough for overview without overwhelming.
 *
 * ASSISTANT_TASK_CHARS: 5000 chars — task content for assistant/adhoc agents,
 * which currently have no truncation guard.
 */
export const PROMPT_TRUNCATION = {
  TASK_SPEC_CHARS: 8000,
  UPSTREAM_SPEC_CHARS: 2000,
  UPSTREAM_DIFF_CHARS: 2000,
  PRIOR_SCRATCHPAD_CHARS: 3000,
  RETRY_NOTES_CHARS: 1500,
  CROSS_REPO_CONTRACT_CHARS: 5000,
  SYNTHESIZER_CODEBASE_CONTEXT_CHARS: 4000,
  ASSISTANT_TASK_CHARS: 5000,
  REVISION_FEEDBACK_CHARS: 2000
} as const

/**
 * Maximum number of retries for the `no_commits` failure class.
 *
 * An agent that exits without committing (either because it misunderstood the
 * spec or got stuck in an exploration loop) is not a transient failure — more
 * retries rarely change the outcome. Cap to 3 attempts and then transition the
 * task to `failed` so a human can inspect `~/.bde/bde.log` and decide whether
 * to re-queue, revise the spec, or cancel.
 */
export const MAX_NO_COMMITS_RETRIES = 3

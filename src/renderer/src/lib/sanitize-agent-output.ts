/**
 * sanitize-agent-output.ts — Guards for agent-supplied text before it reaches
 * the UI or gets written to the database.
 *
 * These functions share a single concern: prevent malformed or oversized
 * strings from propagating through the planner assistant action pipeline.
 * They live here (not inside a component) so every action-apply path
 * across the planner can import from one place.
 */

/** Maximum characters for a task or epic title. */
export const MAX_TASK_TITLE_CHARS = 500

/**
 * Maximum characters for a task spec or epic goal.
 * Matches PROMPT_TRUNCATION.TASK_SPEC_CHARS in prompt-constants.ts (main process).
 * Defined here rather than imported from main — renderer must not import main-process modules.
 */
export const MAX_TASK_SPEC_CHARS = 8_000

/**
 * All FLEET prompt-boundary XML tags used across the main-process prompt builders.
 * Only these tags are stripped — legitimate HTML like <pre> and <code> is left intact.
 *
 * Source of truth: prompt-sections.ts, prompt-pipeline.ts, prompt-assistant.ts,
 * prompt-synthesizer.ts, prompt-composer-reviewer.ts, prompt-copilot.ts.
 */
const FLEET_BOUNDARY_TAGS = [
  'user_spec',
  'upstream_spec',
  'upstream_title',
  'upstream_diff',
  'failure_notes',
  'retry_context',
  'revision_feedback',
  'summary',
  'details',
  'cross_repo_contract',
  'prior_scratchpad',
  'chat_message',
  'files',
  'module',
  'name',
  'user_task',
  'user_context',
  'codebase_context',
  'generation_instructions',
  'opening_message',
  'review_context',
  'review_diff',
  'repo',
  'spec_draft',
  'task_title',
] as const

const FLEET_BOUNDARY_TAG_PATTERN = new RegExp(
  `</?(?:${FLEET_BOUNDARY_TAGS.join('|')})>`,
  'g'
)

/**
 * Truncates `value` to `maxLength` characters and strips FLEET XML boundary
 * tags (e.g. `<user_spec>`, `</upstream_spec>`) that agents may echo back.
 * Stripping prevents prompt-injection fragments from leaking into task records.
 *
 * Only the known FLEET boundary tags are removed — legitimate HTML tags
 * such as `<pre>` and `<code>` pass through unchanged.
 */
export function sanitizeAgentPayloadString(value: string | undefined, maxLength: number): string {
  const raw = (value ?? '').slice(0, maxLength)
  return raw.replace(FLEET_BOUNDARY_TAG_PATTERN, '')
}

/**
 * Removes `[ACTION:…]` and `[/ACTION]` markers from assistant message text
 * so they are not shown to the user in the chat bubble.
 */
export function stripActionMarkers(text: string): string {
  return text.replace(/\[ACTION:[^\]]*\]/g, '')
}

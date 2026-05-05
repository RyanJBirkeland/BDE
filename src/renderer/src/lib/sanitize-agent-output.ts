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
 * Truncates `value` to `maxLength` characters and strips FLEET XML boundary
 * tags (e.g. `<user_spec>`, `</upstream_spec>`) that agents may echo back.
 * Stripping prevents prompt-injection fragments from leaking into task records.
 */
export function sanitizeAgentPayloadString(value: string | undefined, maxLength: number): string {
  const raw = (value ?? '').slice(0, maxLength)
  return raw.replace(/<\/?[a-z_]+>/g, '')
}

/**
 * Removes `[ACTION:…]` and `[/ACTION]` markers from assistant message text
 * so they are not shown to the user in the chat bubble.
 */
export function stripActionMarkers(text: string): string {
  return text.replace(/\[ACTION:[^\]]*\]/g, '')
}

/**
 * Shared input validation helpers for main-process IPC handlers.
 */

export const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Returns true when `id` is a non-empty string containing only characters
 * that are safe to embed in a filesystem path segment (alphanumeric, hyphens,
 * and underscores). Rejects anything that could enable path traversal.
 * Length is constrained to 1-64 characters.
 */
export function isValidAgentId(id: unknown): id is string {
  return typeof id === 'string' && AGENT_ID_PATTERN.test(id)
}

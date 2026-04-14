/**
 * Shared input validation helpers for main-process IPC handlers.
 */

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Returns true when `id` is a non-empty string containing only characters
 * that are safe to embed in a filesystem path segment (alphanumeric, hyphens,
 * and underscores). Rejects anything that could enable path traversal.
 */
export function isValidAgentId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && AGENT_ID_PATTERN.test(id)
}

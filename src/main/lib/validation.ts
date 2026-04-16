/**
 * Shared input validation helpers for main-process IPC handlers.
 */

export const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/
export const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Returns true when `id` is a non-empty string containing only characters
 * that are safe to embed in a filesystem path segment (alphanumeric, hyphens,
 * and underscores). Rejects anything that could enable path traversal.
 * Length is constrained to 1-64 characters.
 */
export function isValidAgentId(id: unknown): id is string {
  return typeof id === 'string' && AGENT_ID_PATTERN.test(id)
}

/**
 * Returns true when `id` is a valid task ID — a non-empty alphanumeric string
 * (hyphens and underscores allowed) of at most 64 characters. Rejects anything
 * that could enable path traversal or shell injection when used in file
 * operations or logging.
 */
export function isValidTaskId(id: unknown): id is string {
  return typeof id === 'string' && TASK_ID_PATTERN.test(id)
}

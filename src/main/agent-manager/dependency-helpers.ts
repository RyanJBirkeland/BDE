/**
 * Shared utilities for task dependency management.
 * Used by index.ts drain loop, task-handlers.ts, sprint-local.ts, and resolve-dependents.ts.
 */

const BLOCK_PREFIX = '[auto-block] '

export function formatBlockedNote(blockedBy: string[]): string {
  return `${BLOCK_PREFIX}Blocked by: ${blockedBy.join(', ')}`
}

export function stripBlockedNote(notes: string | null): string {
  if (!notes) return ''
  return notes.replace(/^\[auto-block\] .*\n?/, '').trim()
}

export function buildBlockedNotes(blockedBy: string[], existingNotes?: string | null): string {
  const blockNote = formatBlockedNote(blockedBy)
  const userNotes = stripBlockedNote(existingNotes ?? null)
  return userNotes ? `${blockNote}\n${userNotes}` : blockNote
}

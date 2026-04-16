export { selectUserMemory } from './select-user-memory'

export interface GetAllMemoryOptions {
  /** Kept for call-site compatibility. No longer used — convention injection
   * has been removed entirely (Option A debranding decision). */
  repoName?: string | null
}

/**
 * Returns the shared memory/convention block for agents.
 *
 * BDE-specific codebase conventions (IPC patterns, Zustand architecture,
 * testing standards) were removed in the Option A debranding decision — those
 * modules were tightly coupled to BDE internals and mislead agents working on
 * other repos. The universal preamble in the prompt composer already covers
 * generic guidance (commit format, test discipline, branch hygiene).
 *
 * @returns Empty string — no convention injection for any repo.
 */
export function getAllMemory(_options: GetAllMemoryOptions = {}): string {
  return ''
}

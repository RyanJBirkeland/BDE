import { ipcConventions } from './ipc-conventions'
import { testingPatterns } from './testing-patterns'
import { architectureRules } from './architecture-rules'

/**
 * Returns true when the given repo name refers to the BDE repository.
 *
 * BDE-specific memory modules (IPC conventions, testing patterns, architecture
 * rules) only apply when the agent is working inside the BDE codebase. For
 * other repos, injecting them wastes tokens and can mislead the agent.
 *
 * Match is case-insensitive and accepts a few common forms ("bde",
 * "BDE", "ryan/bde", etc.). When `repoName` is null/undefined/empty we
 * default to `false` — unknown repo should not receive BDE-specific memory.
 */
export function isBdeRepo(repoName?: string | null): boolean {
  if (repoName == null) return false
  const normalized = repoName.trim().toLowerCase()
  if (!normalized) return false
  // Match exact "bde" or any path segment ending in "/bde"
  if (normalized === 'bde') return true
  if (normalized.endsWith('/bde')) return true
  return false
}

export interface GetAllMemoryOptions {
  /** Target repo for the agent. When provided and not BDE, BDE-specific
   * memory modules are skipped. */
  repoName?: string | null
}

/**
 * Consolidate all BDE convention modules into a single markdown string.
 *
 * Memory modules document patterns and conventions that BDE agents should
 * internalize: IPC handler patterns (safeHandle usage, registration), testing
 * standards, and architecture rules (process boundaries, Zustand patterns,
 * IPC surface minimalism).
 *
 * For agents working in non-BDE repos, BDE-specific guidance is omitted —
 * those modules are tightly coupled to the BDE codebase and only mislead
 * agents working elsewhere.
 *
 * @param options - Optional scoping options
 * @returns Markdown string with applicable memory modules concatenated, or
 *   an empty string when no modules apply.
 */
export function getAllMemory(options: GetAllMemoryOptions = {}): string {
  if (!isBdeRepo(options.repoName)) {
    // Non-BDE repo: skip all BDE-coupled modules. The universal preamble in
    // the prompt composer already covers generic guidance (commit format,
    // test discipline, branch hygiene), so there is nothing else to inject.
    return ''
  }
  return [ipcConventions, testingPatterns, architectureRules].join('\n\n---\n\n')
}

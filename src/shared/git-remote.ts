/**
 * Pure helpers for parsing GitHub remote URLs.
 * Shared by main-process git handlers and renderer tests.
 */

export interface ParsedGitHubRemote {
  owner: string
  repo: string
}

/**
 * Parse a GitHub remote URL into { owner, repo }.
 *
 * Supports:
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo
 *   - http://github.com/owner/repo
 *   - git@github.com:owner/repo.git
 *   - ssh://git@github.com/owner/repo.git
 *
 * Returns null for anything that doesn't look like a GitHub URL.
 */
export function parseGitHubRemote(url: string | null | undefined): ParsedGitHubRemote | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null

  // SSH form: git@github.com:owner/repo(.git)?
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] }
  }

  // HTTPS / HTTP / SSH-URL forms
  const httpMatch = trimmed.match(
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
  )
  if (httpMatch) {
    return { owner: httpMatch[1], repo: httpMatch[2] }
  }

  return null
}

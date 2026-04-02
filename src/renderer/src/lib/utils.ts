/**
 * Convert a working directory path to a short repo label for display.
 * Recognises ~/Documents/Repositories/<name> and .worktrees/<name> patterns.
 */
export function cwdToRepoLabel(cwd: string | null): string {
  if (!cwd) return 'unknown'
  const parts = cwd.split('/')
  const repoIdx = parts.indexOf('Repositories')
  if (repoIdx !== -1) return parts[repoIdx + 1] ?? parts[parts.length - 1]
  const worktreeIdx = parts.indexOf('worktrees')
  if (worktreeIdx !== -1) return parts.slice(worktreeIdx + 1).join('/')
  return parts[parts.length - 1]
}

/**
 * Convert a working directory path to a short repo label for display.
 * Returns the last path component, working on both Unix and Windows paths.
 */
export function cwdToRepoLabel(cwd: string | null): string {
  if (!cwd) return 'unknown'
  const parts = cwd.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

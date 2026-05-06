/**
 * Convert a working directory path to a short repo label for display.
 * Returns the last path component, working on both Unix and Windows paths.
 */
export function cwdToRepoLabel(cwd: string | null): string {
  if (!cwd) return 'unknown'
  const parts = cwd.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

/**
 * CSS color-mix() helper: blend `color` at `opacity` percent with transparent.
 * Works with any CSS color format (hex, rgb, hsl, named). Replaces the brittle
 * hex-only `${color}20` string-concatenation alpha hack.
 */
export function withAlpha(color: string, opacity: number): string {
  return `color-mix(in srgb, ${color} ${opacity}%, transparent)`
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * Validate that `url` is a well-formed https URL pointing at github.com.
 * Used to gate `href`/`window.open` targets against attacker-supplied PR URLs
 * that could otherwise smuggle `javascript:`, `data:`, or off-host redirects.
 *
 * Returns the original URL when safe, or `null` when validation fails.
 */
export function validateGitHubUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    if (!GITHUB_HOSTS.has(parsed.hostname)) return null
    return url
  } catch {
    return null
  }
}

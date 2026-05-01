/**
 * Resolves the default branch of a git repository by reading `origin/HEAD`.
 *
 * Why this exists: FLEET previously hardcoded `main` everywhere it talked to
 * git (rev-list, fetch, ff-merge, rebase). Repos using `master`, `develop`, or
 * any other default branch silently failed at the verification step
 * (`origin/main` doesn't exist → `git rev-list` errors out). This helper asks
 * the SCM what the default branch actually is and caches the result per-repo
 * for the lifetime of the process.
 */
import { execFileAsync } from './async-utils'

const cache = new Map<string, string>()

const FALLBACK_BRANCH = 'main'

export async function resolveDefaultBranch(repoPath: string): Promise<string> {
  const cached = cache.get(repoPath)
  if (cached) return cached

  const detected = await readOriginHead(repoPath)
  const branch = detected ?? FALLBACK_BRANCH
  cache.set(repoPath, branch)
  return branch
}

export function clearDefaultBranchCache(): void {
  cache.clear()
}

async function readOriginHead(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: repoPath }
    )
    return stripOriginPrefix(stdout.trim()) || null
  } catch {
    return null
  }
}

function stripOriginPrefix(ref: string): string {
  const prefix = 'origin/'
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref
}

import { resolve } from 'path'
import { getRepoPaths } from './git'

/**
 * Validates that a path is under a known configured repository root.
 * Returns the resolved absolute path.
 * Throws if the path is not under any configured repo.
 */
export function validateRepoPath(path: string, label = 'Path'): string {
  const resolved = resolve(path)
  const repoPaths = Object.values(getRepoPaths()).map(p => resolve(p))
  const allowed = repoPaths.some(
    root => resolved.startsWith(root + '/') || resolved === root
  )
  if (!allowed) {
    throw new Error(`${label} rejected: "${path}" is not under a known repository`)
  }
  return resolved
}

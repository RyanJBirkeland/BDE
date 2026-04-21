import { join, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import { realpathSync } from 'fs'

// ---------------------------------------------------------------------------
// Path safety validators
// ---------------------------------------------------------------------------

/**
 * Validates that a proposed worktreeBase path is inside the user's home
 * directory. Throws if the path resolves outside of `~`.
 *
 * Security: prevents the agentManager.worktreeBase setting from being pointed
 * at arbitrary system directories (e.g. /etc, /var/root).
 */
export function validateWorktreeBase(value: string): void {
  if (!value) {
    throw new Error(
      'agentManager.worktreeBase must not be empty — provide a path inside your home directory'
    )
  }
  const resolved = resolve(value)
  const home = homedir()
  if (!resolved.startsWith(home + '/') && resolved !== home) {
    throw new Error(
      `agentManager.worktreeBase must be inside your home directory (${home}). ` +
        `Rejected: ${resolved}`
    )
  }
}

/**
 * Validates that BDE_TEST_DB is either `:memory:` (SQLite in-memory) or a
 * path inside the system temp directory. Throws for any other location.
 *
 * Security: prevents a misconfigured test environment from writing the SQLite
 * database to an arbitrary system path.
 *
 * Pass `undefined` when the env var is not set — no validation is performed.
 *
 * macOS note: `/tmp` is a symlink to `/private/tmp`, and `os.tmpdir()` returns
 * the user-session temp dir (`/private/var/folders/...`). We resolve both the
 * input value and `/tmp` to their canonical paths for comparison.
 */
export function validateTestDbPath(value: string | undefined): void {
  if (value === undefined || value === ':memory:') return

  // Resolve symlinks in the input so we compare canonical paths
  let resolvedValue: string
  try {
    resolvedValue = realpathSync(resolve(value))
  } catch {
    // File doesn't exist yet — resolve without realpathSync
    resolvedValue = resolve(value)
  }

  // Build the set of allowed canonical tmp prefixes.
  // On macOS, /tmp → /private/tmp; os.tmpdir() → /private/var/folders/...
  const rawPrefixes = [tmpdir(), '/tmp']
  const allowedPrefixes = new Set<string>()
  for (const p of rawPrefixes) {
    allowedPrefixes.add(p + '/')
    try {
      allowedPrefixes.add(realpathSync(p) + '/')
    } catch {
      // skip if path doesn't exist on this platform
    }
  }

  const isAllowed = [...allowedPrefixes].some((prefix) => resolvedValue.startsWith(prefix))

  if (!isAllowed) {
    throw new Error(
      `BDE_TEST_DB must be ':memory:' or a path inside the system tmp directory. ` +
        `Rejected: ${resolvedValue}`
    )
  }
}

// --- BDE data directory ---
export const BDE_DIR = process.env.BDE_DATA_DIR ?? join(homedir(), '.bde')

// Allow tests to redirect the DB to an isolated path (prevents test artifact pollution).
// Validate the path to prevent pointing the database at arbitrary system files.
validateTestDbPath(process.env.BDE_TEST_DB)
export const BDE_DB_PATH =
  process.env.BDE_TEST_DB ?? process.env.BDE_DB_PATH ?? join(BDE_DIR, 'bde.db')
export const BDE_AGENTS_INDEX = join(BDE_DIR, 'agents.json')
export const BDE_AGENT_LOGS_DIR = join(BDE_DIR, 'agent-logs')
export const BDE_AGENT_TMP_DIR = join(tmpdir(), 'bde-agents')
export const BDE_AGENT_LOG_PATH = join(BDE_DIR, 'agent-manager.log')
export const BDE_MEMORY_DIR = join(BDE_DIR, 'memory')
export const BDE_TASK_MEMORY_DIR = join(BDE_MEMORY_DIR, 'tasks')

/**
 * Dedicated worktree base for adhoc agents. Kept separate from the pipeline
 * worktree base (`agentManager.worktreeBase`, default `~/worktrees/bde`) so the
 * pipeline pruner can't see adhoc worktrees and accidentally delete them.
 *
 * Exported here so any module that needs to recognize an adhoc worktree path
 * (e.g. the review handlers' worktree validator) shares the same constant.
 */
export const ADHOC_WORKTREE_BASE = join(homedir(), 'worktrees', 'bde-adhoc')

// --- Dynamic repo configuration (backed by settings table) ---

import { getSettingJson } from './settings'

export interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
  /**
   * Selects the pipeline prompt preamble:
   * - `'bde'` (default): full BDE-monorepo preamble — `npm run typecheck`,
   *   `docs/modules/` update rule, pre-push hook guidance.
   * - `'minimal'`: short preamble for non-BDE targets where the TypeScript /
   *   Node-monorepo guidance is noise (or actively harmful — see M8 dogfood
   *   findings). Keeps the spec + success criteria; drops the boilerplate.
   */
  promptProfile?: 'bde' | 'minimal'
}

export function getConfiguredRepos(): RepoConfig[] {
  return getSettingJson<RepoConfig[]>('repos') ?? []
}

/**
 * Look up the prompt profile for a configured repo. Returns `'bde'` (the
 * backward-compatible default) when the repo isn't configured or has no
 * explicit profile — existing BDE workflows keep the full preamble.
 */
export function getRepoPromptProfile(repoName: string | null | undefined): 'bde' | 'minimal' {
  if (!repoName) return 'bde'
  const repo = getConfiguredRepos().find((r) => r.name.toLowerCase() === repoName.toLowerCase())
  return repo?.promptProfile ?? 'bde'
}

export function getRepoPaths(): Record<string, string> {
  const repos = getConfiguredRepos()
  const result: Record<string, string> = {}
  for (const r of repos) {
    result[r.name.toLowerCase()] = r.localPath
  }
  return result
}

/**
 * Look up a configured repo's local path by name. Case-insensitive — callers
 * may pass `'BDE'`, `'bde'`, etc. Returns `undefined` if no repo is configured
 * with that name. Prefer this helper over `getRepoPaths()[name]`, which is
 * easy to use incorrectly because the underlying map is keyed by lowercased
 * name (and a mismatched-case lookup silently returns `undefined`).
 */
export function getRepoPath(name: string): string | undefined {
  if (!name) return undefined
  return getRepoPaths()[name.toLowerCase()]
}

export function getGhRepo(repoSlug: string): string | null {
  const repos = getConfiguredRepos()
  const repo = repos.find((r) => r.name.toLowerCase() === repoSlug.toLowerCase())
  if (!repo?.githubOwner || !repo?.githubRepo) return null
  return `${repo.githubOwner}/${repo.githubRepo}`
}

export function getSpecsRoot(): string | null {
  const repos = getConfiguredRepos()
  // TODO: Make spec root configurable via settings instead of hardcoding 'bde'.
  // Currently only BDE's own development workflow uses this feature.
  const bdeRepo = repos.find((r) => r.name.toLowerCase() === 'bde')
  if (!bdeRepo) return null
  return resolve(bdeRepo.localPath, 'docs', 'specs')
}

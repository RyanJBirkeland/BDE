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
 * Validates that FLEET_TEST_DB is either `:memory:` (SQLite in-memory) or a
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
      `FLEET_TEST_DB must be ':memory:' or a path inside the system tmp directory. ` +
        `Rejected: ${resolvedValue}`
    )
  }
}

// --- FLEET data directory ---
export const FLEET_DIR = process.env.FLEET_DATA_DIR ?? join(homedir(), '.fleet')

// Allow tests to redirect the DB to an isolated path (prevents test artifact pollution).
// Validate the path to prevent pointing the database at arbitrary system files.
validateTestDbPath(process.env.FLEET_TEST_DB)
export const FLEET_DB_PATH =
  process.env.FLEET_TEST_DB ?? process.env.FLEET_DB_PATH ?? join(FLEET_DIR, 'fleet.db')
export const FLEET_AGENTS_INDEX = join(FLEET_DIR, 'agents.json')
export const FLEET_AGENT_LOGS_DIR = join(FLEET_DIR, 'agent-logs')
export const FLEET_AGENT_TMP_DIR = join(tmpdir(), 'fleet-agents')
export const FLEET_AGENT_LOG_PATH = join(FLEET_DIR, 'agent-manager.log')
export const FLEET_MEMORY_DIR = join(FLEET_DIR, 'memory')
export const FLEET_TASK_MEMORY_DIR = join(FLEET_MEMORY_DIR, 'tasks')

/**
 * Default pipeline worktree base. Lives under `~/.fleet/` alongside the SQLite DB
 * and logs so all FLEET state consolidates in one dotfile directory — hidden from
 * Finder and typically skipped by employer file-indexers that scan visible home
 * subdirectories (Documents, Desktop, Downloads).
 *
 * Users can override via the `agentManager.worktreeBase` setting; the override
 * is still validated to stay inside `$HOME` by `validateWorktreeBase()`.
 */
export const DEFAULT_PIPELINE_WORKTREE_BASE = join(FLEET_DIR, 'worktrees')

/**
 * Dedicated worktree base for adhoc agents. Kept separate from the pipeline
 * worktree base so the pipeline pruner can't see adhoc worktrees and
 * accidentally delete them.
 *
 * Exported here so any module that needs to recognize an adhoc worktree path
 * (e.g. the review handlers' worktree validator) shares the same constant.
 */
export const ADHOC_WORKTREE_BASE = join(FLEET_DIR, 'worktrees-adhoc')

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
   * - `'fleet'` (default): full FLEET-monorepo preamble — `npm run typecheck`,
   *   `docs/modules/` update rule, pre-push hook guidance.
   * - `'minimal'`: short preamble for non-FLEET targets where the TypeScript /
   *   Node-monorepo guidance is noise (or actively harmful — see M8 dogfood
   *   findings). Keeps the spec + success criteria; drops the boilerplate.
   */
  promptProfile?: 'fleet' | 'minimal'
  /**
   * Per-repo environment variables injected into the agent's spawn environment.
   * Use for credentials not present in the shell env when FLEET launches
   * (e.g. NODE_AUTH_TOKEN for private npm registries). Stored in plain text in
   * the local SQLite settings table — not a secrets manager.
   */
  envVars?: Record<string, string>
}

function isRepoConfig(item: unknown): item is RepoConfig {
  if (typeof item !== 'object' || item === null) return false
  const r = item as Record<string, unknown>
  return typeof r.name === 'string' && r.name.trim() !== ''
}

function isRepoConfigArray(value: unknown): value is RepoConfig[] {
  return Array.isArray(value) && value.every(isRepoConfig)
}

export function getConfiguredRepos(): RepoConfig[] {
  return getSettingJson<RepoConfig[]>('repos', isRepoConfigArray) ?? []
}

export function getRepoConfig(name: string): RepoConfig | null {
  const target = name.toLowerCase()
  return getConfiguredRepos().find((r) => r.name.toLowerCase() === target) ?? null
}

/**
 * Look up the prompt profile for a configured repo. Returns `'fleet'` (the
 * backward-compatible default) when the repo isn't configured or has no
 * explicit profile — existing FLEET workflows keep the full preamble.
 */
export function getRepoPromptProfile(repoName: string | null | undefined): 'fleet' | 'minimal' {
  if (!repoName) return 'fleet'
  const repo = getConfiguredRepos().find((r) => r.name.toLowerCase() === repoName.toLowerCase())
  return repo?.promptProfile ?? 'fleet'
}

/**
 * Look up per-repo environment variables for a configured repo.
 * Case-insensitive — callers may pass 'FLEET', 'fleet', etc.
 * Returns an empty object if the repo is not configured or has no envVars field.
 */
export function getRepoEnvVars(repoSlug: string | null | undefined): Record<string, string> {
  if (!repoSlug) return {}
  return getRepoConfig(repoSlug)?.envVars ?? {}
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
 * may pass `'FLEET'`, `'fleet'`, etc. Returns `undefined` if no repo is configured
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
  const primary = repos[0]
  if (!primary) return null
  return resolve(primary.localPath, 'docs', 'specs')
}

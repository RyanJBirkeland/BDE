/**
 * already-done-check.ts — Detects tasks whose work has already landed on main.
 *
 * Pre-claim guard for the drain loop. Before spawning an agent, we search the
 * last N commits on origin/main for fingerprints of the task (task id, title,
 * or agent_run_id). A match means the work is done and re-executing would
 * waste tokens re-investigating already-merged code.
 *
 * The taxonomy of matches is intentionally broad (three OR'd criteria) because
 * commit messages vary across auto-merge, manual merge, and squash workflows:
 *
 *   1. `(T-<taskId>)` appears anywhere in the subject or body
 *   2. the subject line equals the task title exactly
 *   3. `agent-run-id: <runId>` trailer appears anywhere in the subject or body
 *      (only when runId is set)
 *
 * A positive match returns the full commit SHA so callers can record it in the
 * audit note.
 *
 * Scope notes:
 *  - The git log invocation passes `maxBuffer: 16 MiB` so verbose monorepo
 *    history can never silently overflow the default 1 MB cap and cause us to
 *    re-spawn an agent on a task that already merged.
 *  - Results are memoized per `repoPath` for `ALREADY_DONE_CACHE_TTL_MS` so the
 *    drain loop's per-task scan collapses to a single git invocation per tick.
 */
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { resolveDefaultBranch } from '../lib/default-branch'
import type { Logger } from '../logger'
import { GIT_FETCH_TIMEOUT_MS } from './types'

const COMMIT_SCAN_DEPTH = 200
const COMMIT_FIELD_SEPARATOR = '\x1e'
const COMMIT_RECORD_SEPARATOR = '\x1f'
const GIT_LOG_MAX_BUFFER_BYTES = 16 * 1024 * 1024

/**
 * How long a parsed commit list stays cached per `repoPath`.
 *
 * The drain loop calls `taskHasMatchingCommitOnMain` once per queued task; for
 * N tasks against the same repo within a single tick, we only want to shell
 * out to git once. 5 seconds covers a typical drain tick (~30 s polling
 * interval, with all per-task work bunched at the start) without holding stale
 * commits long enough to mask a freshly-merged PR.
 */
export const ALREADY_DONE_CACHE_TTL_MS = 5_000

interface CommitRecord {
  sha: string
  subject: string
  body: string
}

interface CachedCommitList {
  commits: CommitRecord[]
  expiresAt: number
}

const commitCacheByRepoPath = new Map<string, CachedCommitList>()

export interface AlreadyDoneTask {
  id: string
  title: string
  agent_run_id?: string | null
}

export interface AlreadyDoneMatch {
  sha: string
  matchedOn: 'task-id' | 'title' | 'agent-run-id'
}

/**
 * Returns the first commit on origin/main that fingerprints `task`, or null when
 * no commit matches. Intended as a drain-loop pre-claim guard.
 */
export async function taskHasMatchingCommitOnMain(
  task: AlreadyDoneTask,
  repoPath: string,
  logger: Logger
): Promise<AlreadyDoneMatch | null> {
  const commits = await loadRecentCommits(repoPath, logger)
  if (commits.length === 0) return null

  const taskIdMarker = `(T-${task.id})`
  const runIdMarker = task.agent_run_id ? `agent-run-id: ${task.agent_run_id}` : null

  for (const commit of commits) {
    if (commit.subject === task.title) {
      return { sha: commit.sha, matchedOn: 'title' }
    }
    if (commit.subject.includes(taskIdMarker) || commit.body.includes(taskIdMarker)) {
      return { sha: commit.sha, matchedOn: 'task-id' }
    }
    if (
      runIdMarker &&
      (commit.subject.includes(runIdMarker) || commit.body.includes(runIdMarker))
    ) {
      return { sha: commit.sha, matchedOn: 'agent-run-id' }
    }
  }

  return null
}

/**
 * Reads the last COMMIT_SCAN_DEPTH commits on the repo's default branch as
 * structured records. Results are cached per `repoPath` for
 * `ALREADY_DONE_CACHE_TTL_MS` to collapse back-to-back per-task lookups within
 * a single drain tick into one git call.
 *
 * Returns an empty list (not null) on any git failure so the drain loop can
 * proceed rather than block on a transient repo problem. Failures are not
 * cached — the next caller retries fresh.
 */
async function loadRecentCommits(repoPath: string, logger: Logger): Promise<CommitRecord[]> {
  const cached = readFromCache(repoPath)
  if (cached) return cached

  try {
    const defaultBranch = await resolveDefaultBranch(repoPath)
    const format = `%H${COMMIT_FIELD_SEPARATOR}%s${COMMIT_FIELD_SEPARATOR}%b${COMMIT_RECORD_SEPARATOR}`
    const { stdout } = await execFileAsync(
      'git',
      ['log', `origin/${defaultBranch}`, `--format=${format}`, '-n', String(COMMIT_SCAN_DEPTH)],
      {
        cwd: repoPath,
        env: buildAgentEnv(),
        maxBuffer: GIT_LOG_MAX_BUFFER_BYTES,
        timeout: GIT_FETCH_TIMEOUT_MS
      }
    )
    const commits = parseCommitRecords(stdout)
    writeToCache(repoPath, commits)
    return commits
  } catch (err) {
    logger.warn(`[already-done-check] git log failed in ${repoPath}: ${err}`)
    return []
  }
}

function readFromCache(repoPath: string): CommitRecord[] | null {
  const entry = commitCacheByRepoPath.get(repoPath)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    commitCacheByRepoPath.delete(repoPath)
    return null
  }
  return entry.commits
}

function writeToCache(repoPath: string, commits: CommitRecord[]): void {
  commitCacheByRepoPath.set(repoPath, {
    commits,
    expiresAt: Date.now() + ALREADY_DONE_CACHE_TTL_MS
  })
}

/** Test-only: clears the per-repoPath commit cache. */
export function __resetAlreadyDoneCache(): void {
  commitCacheByRepoPath.clear()
}

function parseCommitRecords(stdout: string): CommitRecord[] {
  if (!stdout.trim()) return []
  return stdout
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split(COMMIT_FIELD_SEPARATOR)
      return { sha: sha.trim(), subject: subject.trim(), body: body.trim() }
    })
    .filter((record) => record.sha.length > 0)
}

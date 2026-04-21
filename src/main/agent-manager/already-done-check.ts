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
 *   3. `agent-run-id: <runId>` trailer appears anywhere (only when runId is set)
 *
 * A positive match returns the full commit SHA so callers can record it in the
 * audit note.
 */
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import type { Logger } from '../logger'

const COMMIT_SCAN_DEPTH = 200
const COMMIT_FIELD_SEPARATOR = '\x1e'
const COMMIT_RECORD_SEPARATOR = '\x1f'

interface CommitRecord {
  sha: string
  subject: string
  body: string
}

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
 * Reads the last COMMIT_SCAN_DEPTH commits on origin/main as structured records.
 * Returns an empty list (not null) on any git failure so the drain loop can
 * proceed rather than block on a transient repo problem.
 */
async function loadRecentCommits(repoPath: string, logger: Logger): Promise<CommitRecord[]> {
  try {
    const format = `%H${COMMIT_FIELD_SEPARATOR}%s${COMMIT_FIELD_SEPARATOR}%b${COMMIT_RECORD_SEPARATOR}`
    const { stdout } = await execFileAsync(
      'git',
      ['log', 'origin/main', `--format=${format}`, '-n', String(COMMIT_SCAN_DEPTH)],
      { cwd: repoPath, env: buildAgentEnv() }
    )
    return parseCommitRecords(stdout)
  } catch (err) {
    logger.warn(`[already-done-check] git log failed in ${repoPath}: ${err}`)
    return []
  }
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

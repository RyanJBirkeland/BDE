/**
 * Branch-tip verification — validates that the agent's branch tip commit
 * legitimately belongs to the task being completed.
 *
 * Extracted from resolve-success-phases.ts so this focused concern has its
 * own module boundary. resolve-success-phases.ts re-exports everything here
 * for backward compatibility.
 */
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { GIT_EXEC_TIMEOUT_MS } from './worktree-lifecycle'

/**
 * Thrown when the agent's branch tip commit does not reference the expected
 * task identifiers. Signals that some other process — or a stale branch —
 * produced the tip, not the agent we just ran. Caller must transition the
 * task to `failed` rather than `review`.
 */
export class BranchTipMismatchError extends Error {
  constructor(
    public readonly expectedTokens: string[],
    public readonly actualSubject: string
  ) {
    super(
      `Branch tip mismatch — expected one of [${expectedTokens.join(', ')}] in subject, got: ${actualSubject}`
    )
    this.name = 'BranchTipMismatchError'
  }
}

/**
 * Extracts a `(T-N)` token (e.g. `(T-42)`) from a task title, if present.
 * FLEET convention: sprint task titles often carry a `(T-N)` suffix so that
 * commit messages written by the agent can reference the task number.
 */
function extractTaskNumberToken(title: string): string | null {
  const match = /\(T-\d+\)/i.exec(title)
  return match ? match[0] : null
}

/**
 * Builds the set of identifiers the branch tip commit MUST reference for the
 * agent's work to be accepted. Any one of these appearing in the commit body
 * or trailers is sufficient.
 */
function buildExpectedTipTokens(task: {
  id: string
  title: string
  agent_run_id?: string | null
}): string[] {
  const tokens: string[] = []
  if (task.agent_run_id) tokens.push(task.agent_run_id)
  const numberToken = extractTaskNumberToken(task.title)
  if (numberToken) tokens.push(numberToken)
  // Task title substring — first meaningful phrase, trimmed to keep the
  // match permissive without matching noise.
  const titleHead = task.title
    .replace(/\(T-\d+\)/gi, '')
    .trim()
    .slice(0, 40)
  if (titleHead) tokens.push(titleHead)
  tokens.push(task.id)
  return tokens
}

/**
 * Extract the task-id slug from a FLEET agent branch name.
 *
 * FLEET generates branches as `agent/t-<idSlug>-<titleSlug>-<groupHash>` where
 * `<groupHash>` is always 8 lowercase hex chars. Returns the `<idSlug>` part
 * (e.g. '11', 'abc123', '20260420') so callers can match it against the
 * task's full id by suffix.
 *
 * Returns null when the branch name does not match the expected shape —
 * callers should fall back to commit-subject matching or treat as
 * "no task linkage" per their policy.
 */
export function extractTaskIdFromBranch(branch: string): string | null {
  const match = /^agent\/t-([a-zA-Z0-9]+)-.+-[a-f0-9]{8}$/.exec(branch)
  return match?.[1] ?? null
}

/**
 * Check whether a branch name identifies a given task.
 *
 * Two signals checked in order:
 * 1. The 8-char hex hash at the end of the branch matches the task id prefix
 *    (UUID tasks) OR the group id prefix (epic-grouped tasks — branch is named
 *    from groupId.slice(0,8) when a task belongs to an epic).
 * 2. The `<idSlug>` segment (e.g. '13') matches the task id tail via
 *    `endsWith('t-13')` — covers legacy-style ids like 'audit-20260420-t-13'.
 */
export function branchMatchesTask(
  branch: string,
  taskId: string,
  groupId?: string | null
): boolean {
  const hashMatch = /-([a-f0-9]{8})$/.exec(branch)
  if (hashMatch?.[1]) {
    if (taskId.toLowerCase().startsWith(hashMatch[1])) return true
    // Epic-grouped tasks: branch suffix comes from groupId, not taskId.
    if (groupId && groupId.toLowerCase().startsWith(hashMatch[1])) return true
  }
  // Legacy T-N style task IDs: agent/t-<idSlug>-...-<8hex>
  const slug = extractTaskIdFromBranch(branch)
  if (!slug) return false
  return taskId.toLowerCase().endsWith(`t-${slug.toLowerCase()}`)
}

/**
 * Reads the tip commit message (subject + body) for a branch.
 *
 * Reads FROM the main repo — the branch ref lives there even when the
 * worktree is elsewhere. Using the same cwd keeps the check consistent
 * with how branches are actually created by git worktree add.
 */
export type ReadTipCommit = (branch: string, repoPath: string) => Promise<string>

const defaultReadTipCommit: ReadTipCommit = async (branch, repoPath) => {
  const env = buildAgentEnv()
  const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%B', branch], {
    cwd: repoPath,
    env,
    timeout: GIT_EXEC_TIMEOUT_MS
  })
  return stdout.trim()
}

/**
 * Verifies that the agent's branch tip legitimately belongs to this task.
 *
 * Primary signal: the branch name itself (e.g. `agent/t-11-...-<hash>`) —
 * FLEET generates branches deterministically from the task id, so a name match
 * is strong evidence of linkage and short-circuits before any subprocess.
 *
 * Fallback signal: the commit message references a task identifier
 * (agent_run_id, (T-N), title head, or task id). This covers non-standard
 * branch names and preserves forward compatibility with other tools.
 *
 * Throws BranchTipMismatchError when neither signal matches — defense against
 * a stale branch tip or a cross-task leak that survived worktree setup.
 */
export async function assertBranchTipMatches(
  task: { id: string; title: string; agent_run_id?: string | null; group_id?: string | null },
  agentBranch: string,
  repoPath: string,
  readTipCommit: ReadTipCommit = defaultReadTipCommit
): Promise<void> {
  if (branchMatchesTask(agentBranch, task.id, task.group_id)) return

  const commitMessage = await readTipCommit(agentBranch, repoPath)
  const expectedTokens = buildExpectedTipTokens(task)
  const hasMatch = expectedTokens.some((token) =>
    commitMessage.toLowerCase().includes(token.toLowerCase())
  )
  if (!hasMatch) {
    const firstLine = commitMessage.split('\n')[0] ?? ''
    throw new BranchTipMismatchError(expectedTokens, firstLine)
  }
}

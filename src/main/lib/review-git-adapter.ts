/**
 * Review git adapter — git operations for the AI Review Partner.
 *
 * Encapsulates the three per-worktree git operations that the review service
 * and chat-stream deps need: reading the current HEAD SHA, reading the current
 * branch name, and producing a diff against the repo's default branch. All
 * three call `buildAgentEnv()` at request time so callers always receive a
 * fresh environment snapshot.
 *
 * Use `createReviewGitAdapter()` at the composition root (inside
 * `buildReviewWiring`) and destructure the returned functions into the
 * `createReviewService` and `buildChatStreamDeps` call sites.
 */
import { execFileAsync } from './async-utils'
import { buildAgentEnv } from '../env-utils'
import { resolveGitExecutable } from '../agent-manager/resolve-git'
import { resolveDefaultBranch } from './default-branch'
import type { Logger } from '../logger'

export interface ReviewGitAdapter {
  getHeadCommitSha(worktreePath: string): Promise<string>
  getBranch(worktreePath: string): Promise<string>
  getDiff(worktreePath: string): Promise<string>
}

/**
 * Create the three git-operation helpers shared by ReviewService and the
 * review chat-stream deps. Each call is self-contained — no shared state.
 *
 * `logger` is accepted for future diagnostic use; currently unused so that
 * the functions remain pure helpers with no side effects on the happy path.
 */
export function createReviewGitAdapter(_logger?: Logger): ReviewGitAdapter {
  async function getHeadCommitSha(worktreePath: string): Promise<string> {
    const gitBin = resolveGitExecutable() ?? 'git'
    const { stdout } = await execFileAsync(gitBin, ['-C', worktreePath, 'rev-parse', 'HEAD'], {
      env: buildAgentEnv()
    })
    return stdout.trim()
  }

  async function getBranch(worktreePath: string): Promise<string> {
    const gitBin = resolveGitExecutable() ?? 'git'
    const { stdout } = await execFileAsync(
      gitBin,
      ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { env: buildAgentEnv() }
    )
    return stdout.trim()
  }

  async function getDiff(worktreePath: string): Promise<string> {
    const gitBin = resolveGitExecutable() ?? 'git'
    const defaultBranch = await resolveDefaultBranch(worktreePath)
    const { stdout } = await execFileAsync(
      gitBin,
      ['-C', worktreePath, 'diff', `origin/${defaultBranch}...HEAD`],
      { maxBuffer: 10 * 1024 * 1024, env: buildAgentEnv() }
    )
    return stdout
  }

  return { getHeadCommitSha, getBranch, getDiff }
}
